"""Fresh disposable SQL + race + HTTP tests. Inert on import.
Private logs are capped and never emitted/uploaded. Source digests observe changes
within this run, not provenance; CI must first install its reviewed lockfile.
"""
import argparse,hashlib,json,os,pathlib,re,shutil,signal,stat,subprocess,sys,tempfile,threading,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
LIMIT=1048576
CATEGORIES={'CONFIGURATION_FAILED','SOURCE_CHANGED','CUSTODY_REJECTED','PROCESS_BOUND','SQL_FAILED','DATABASE_EXISTS','CLEANUP_UNOBSERVED','RECEIPT_WRITE_FAILED','COMPLETE','INTERNAL_FAILED','NATIVE_FAILED','RECEIPT_REJECTED'}
class Failure(Exception):pass
def fail(category):raise Failure(category)
def canonical(path, directory=False):
    path = pathlib.Path(path).absolute()
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            fail('CUSTODY_REJECTED')
    if os.path.normcase(str(path.resolve(strict=True))) != os.path.normcase(str(path)):
        fail('CUSTODY_REJECTED')
    if directory and not path.is_dir():
        fail('CUSTODY_REJECTED')
    return path

def custody(path, handle=None):
    canonical(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        fail('CUSTODY_REJECTED')
    if handle is not None:
        opened = os.fstat(handle.fileno())
        if opened.st_nlink != 1 or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            fail('CUSTODY_REJECTED')
    return info

def snapshot(path, handle=None):
    info = custody(path,handle)
    if handle is not None and os.fstat(handle.fileno()).st_size != info.st_size:
        fail('CUSTODY_REJECTED')
    return (info.st_dev,info.st_ino,info.st_size)

def verify_evidence(private,evidence):
    canonical(private,True)
    if {item.name for item in private.iterdir()} != set(evidence):
        fail('CUSTODY_REJECTED')
    for name,expected in evidence.items():
        if snapshot(private/name) != expected:
            fail('CUSTODY_REJECTED')

def bounded_read(path, maximum):
    canonical(path)
    with path.open('rb') as source:
        if os.fstat(source.fileno()).st_size > maximum:
            fail('SOURCE_CHANGED')
        data = source.read(maximum + 1)
    if len(data) > maximum:
        fail('SOURCE_CHANGED')
    return data

def reap_owned(child, popen=subprocess.Popen, clock=time.monotonic):
    """Copied bounded tree-reap pattern: observe helper and child, never hide failure."""
    if os.name != 'nt':
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        except BaseException: fail('CLEANUP_UNOBSERVED')
        try: child.wait(timeout=10)
        except BaseException: fail('CLEANUP_UNOBSERVED')
        return
    end = clock() + 10
    if child.poll() is not None:
        child.wait(timeout=.001)
        return
    helper = None
    failed = False
    helper_closed = child_closed = False
    def remaining(cap):
        return min(cap, max(.001,end-clock()))
    try:
        try:
            helper = popen(['taskkill.exe','/PID',str(child.pid),'/T','/F'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except BaseException:
            failed = True
        if helper is not None:
            try:
                helper.wait(timeout=remaining(3)); helper_closed = True
            except BaseException:
                try:
                    helper.kill()
                except BaseException:
                    failed = True
                try:
                    helper.wait(timeout=remaining(2)); helper_closed = True
                except BaseException:
                    failed = True
    finally:
        try:
            child.wait(timeout=remaining(10)); child_closed = True
        except BaseException:
            failed = True
    if failed or not helper_closed or not child_closed or clock() >= end:
        fail('CLEANUP_UNOBSERVED')

def run_private(args, root, env, private, index, seconds, maximum=LIMIT,
                popen=subprocess.Popen, reap=reap_owned, clock=time.monotonic):
    """Bounded pipe chunks -> exclusive capped private files; no raw error escape."""
    canonical(private, True)
    out, err = private/(str(index)+'.stdout'), private/(str(index)+'.stderr')
    child = None
    threads = []
    stopped = threading.Event()
    overflow = threading.Event()
    reader_failed = threading.Event()
    failure = None
    deadline = clock() + seconds
    with out.open('xb',buffering=0) as stdout, err.open('xb',buffering=0) as stderr:
        custody(out,stdout); custody(err,stderr)
        def drain(pipe,target,cap):
            total = 0
            try:
                while not stopped.is_set():
                    chunk = pipe.read(65536)
                    if not chunk:
                        break
                    room = cap-total
                    if room:
                        target.write(chunk[:room]); total += min(len(chunk),room)
                    if len(chunk) > room:
                        overflow.set()
                        break
            except BaseException:
                reader_failed.set()
        try:
            child = popen(args,cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),start_new_session=os.name!='nt')
            for pipe,target,cap in ((child.stdout,stdout,maximum),(child.stderr,stderr,LIMIT)):
                if pipe is None:
                    fail('INTERNAL_FAILED')
                # Emergency unresolved cleanup cannot hold the supervisor alive;
                # success still requires observing both threads joined below.
                thread = threading.Thread(target=drain,args=(pipe,target,cap),daemon=True)
                threads.append(thread); thread.start()
            while child.poll() is None:
                custody(out,stdout); custody(err,stderr)
                if clock() >= deadline or overflow.is_set():
                    fail('PROCESS_BOUND')
                if reader_failed.is_set():
                    fail('CUSTODY_REJECTED')
                time.sleep(.02)
            child.wait(timeout=max(.001,deadline-clock()))
        except BaseException as error:
            failure = error
        finally:
            if child is not None and (child.poll() is None or os.name != 'nt'):
                try:
                    reap(child)
                except BaseException:
                    failure = Failure('CLEANUP_UNOBSERVED')
            join_deadline = clock()+2
            for thread in threads:
                thread.join(timeout=max(.001,join_deadline-clock()))
            if any(thread.is_alive() for thread in threads):
                stopped.set(); failure = Failure('CLEANUP_UNOBSERVED')
            else:
                if child is not None:
                    for pipe in (child.stdout,child.stderr):
                        if pipe is not None:
                            try: pipe.close()
                            except BaseException: failure = Failure('CLEANUP_UNOBSERVED')
            if failure is None:
                if overflow.is_set() or clock() >= deadline:
                    failure = Failure('PROCESS_BOUND')
                elif reader_failed.is_set():
                    failure = Failure('CUSTODY_REJECTED')
            try:
                custody(out,stdout); custody(err,stderr)
            except BaseException:
                if not isinstance(failure,Failure) or failure.args != ('CLEANUP_UNOBSERVED',):
                    failure = Failure('CUSTODY_REJECTED')
        # A bounded/failed child can still produce owned, fully observed files.
        # Retain these snapshots before raising so finalization does not mistake
        # legitimate failed output for an unexplained artifact.
        evidence = None
        if child is not None and child.poll() is not None and not any(thread.is_alive() for thread in threads):
            try:
                evidence = {out.name:snapshot(out,stdout),err.name:snapshot(err,stderr)}
            except BaseException:
                if not isinstance(failure,Failure) or failure.args != ('CLEANUP_UNOBSERVED',):
                    failure = Failure('CUSTODY_REJECTED')
        if failure is not None:
            if type(failure) is Failure and evidence is not None:
                failure.artifacts = evidence
            raise failure
        if evidence is None:
            fail('CLEANUP_UNOBSERVED')
    for artifact in (out,err):
        if snapshot(artifact) != evidence[artifact.name]:
            fail('CUSTODY_REJECTED')
    if child is None:
        fail('INTERNAL_FAILED')
    return child.returncode,out,err,evidence

def configuration(profile,layout):
    if layout not in ('public','extensions') or os.environ.get('TEXT_DRAFT_RUNNER_APPROVED')!='1':fail('CONFIGURATION_FAILED')
    if profile=='local' and os.name=='nt':port,password='55439',''
    elif profile=='github-ci' and sys.platform=='linux' and os.environ.get('GITHUB_ACTIONS')=='true':port,password='5432','postgres'
    else:fail('CONFIGURATION_FAILED')
    tools={name:shutil.which(name) for name in ('node','psql')}
    if any(not path for path in tools.values()):fail('CONFIGURATION_FAILED')
    env={k:os.environ[k] for k in ('SystemRoot','WINDIR','TEMP','TMP') if k in os.environ}
    env.update(PGHOST='127.0.0.1',PGPORT=port,PGUSER='postgres',PGPASSWORD=password,PGCONNECT_TIMEOUT='5',PGDATABASE='postgres',PGSSLMODE='disable',PGPASSFILE=os.devnull)
    return tools,env

def sources():
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    if len(migrations)!=32 or [int(p.name[:4]) for p in migrations]!=list(range(1,33)):fail('SOURCE_CHANGED')
    files=set(migrations)|{ROOT/'supabase/tests/local_harness.sql',ROOT/'supabase/tests/text_field_drafts_tests.sql',ROOT/'package-lock.json',ROOT/'package.json',ROOT/'tsconfig.base.json',pathlib.Path(__file__).resolve()}
    for p in (ROOT/'packages').rglob('*'):
        if 'node_modules' not in p.relative_to(ROOT).parts and p.is_file() and p.suffix in ('.ts','.tsx','.json'):files.add(p)
    for name in ('text-field-drafts.integration.ts','text-field-drafts-concurrency.integration.ts'):
        if ROOT/'packages/action-api/server'/name not in files:fail('SOURCE_CHANGED')
    return migrations,{p.relative_to(ROOT).as_posix():hashlib.sha256(bounded_read(p,4194304)).hexdigest() for p in sorted(files)}

def receipt(raw,kind):
    try:value=json.loads(raw.decode('ascii'))
    except BaseException:fail('RECEIPT_REJECTED')
    common={'schemaVersion':1,'kind':kind,'status':'passed','category':'COMPLETE','connectionsClosed':True}
    counts=set()
    if kind=='TEXT_DRAFT_CONCURRENCY':common.update(cases=6,parityCases=45)
    elif kind=='TEXT_DRAFT_NATIVE_HTTP':common.update(groups=8,serverClosed=True);counts={'httpRequests','textCalls','legacyCalls'}
    else:fail('RECEIPT_REJECTED')
    if type(value) is not dict or set(value)!=set(common)|counts or any(type(value[k]) is not type(v) or value[k]!=v for k,v in common.items()):fail('RECEIPT_REJECTED')
    if any(type(value[k]) is not int or not 1<=value[k]<=1000 for k in counts):fail('RECEIPT_REJECTED')
    if counts and value['textCalls']+value['legacyCalls']>value['httpRequests']:fail('RECEIPT_REJECTED')
    if raw!=(json.dumps(value,separators=(',',':'))+'\n').encode('ascii'):fail('RECEIPT_REJECTED')
    return value

def execute(profile,layout,private,result,tools,env,runner=run_private,clock=time.monotonic,source_check=sources,evidence=None):
    migrations,pins=source_check();end=clock()+210;name='lumin_text_draft_'+uuid.UUID(result['runId']).hex
    if evidence is None:evidence={}
    def check():
        if clock()>=end:fail('PROCESS_BOUND')
        if source_check()[1]!=pins:fail('SOURCE_CHANGED')
    def invoke(args,cwd,childenv,seconds=30,maximum=LIMIT):
        if clock()>=end:fail('PROCESS_BOUND')
        result['steps']+=1;index=result['steps']
        def retain(completed):
            if type(completed) is not dict or set(completed)!={str(index)+'.stdout',str(index)+'.stderr'} or set(completed)&set(evidence):fail('CUSTODY_REJECTED')
            evidence.update(completed);verify_evidence(private,evidence)
        try:code,out,err,completed=runner(args,cwd,childenv,private,index,min(seconds,end-clock()),maximum)
        except Failure as error:
            if getattr(error,'artifacts',None) is not None:retain(error.artifacts)
            raise
        retain(completed)
        if code!=0:fail('SQL_FAILED' if index<=37 else 'NATIVE_FAILED')
        return out,err
    def sql(database,*args,maximum=LIMIT):return invoke([tools['psql'],'-X','-w','-v','ON_ERROR_STOP=1','-d',database,*args],ROOT,env,maximum=maximum)
    out,_=sql('postgres','-qAt','-c',"select exists(select 1 from pg_database where datname='"+name+"')",maximum=128)
    if bounded_read(out,128) not in (b'f\n',b'f\r\n'):fail('DATABASE_EXISTS')
    sql('postgres','-c','create database '+name)
    crypto='create extension pgcrypto with schema public' if layout=='public' else 'create schema extensions; create extension pgcrypto with schema extensions'
    sql(name,'-c',crypto);sql(name,'-f',str(ROOT/'supabase/tests/local_harness.sql'))
    for migration in migrations:sql(name,'-f',str(migration))
    sql(name,'-f',str(ROOT/'supabase/tests/text_field_drafts_tests.sql'));check()
    childenv={k:v for k,v in env.items() if not k.startswith('PG')}
    childenv.update(PGPASSWORD=env['PGPASSWORD'],PGPASSFILE=os.devnull,TEXT_DRAFT_TEST_PROFILE=profile,TEXT_DRAFT_TEST_DISPOSABLE='1',TEXT_DRAFT_TEST_LAYOUT=layout,TSX_DISABLE_CACHE='1')
    if profile=='github-ci':childenv['GITHUB_ACTIONS']='true'
    for prefix,file,kind in [('CONCURRENCY','text-field-drafts-concurrency.integration.ts','TEXT_DRAFT_CONCURRENCY'),('HTTP','text-field-drafts.integration.ts','TEXT_DRAFT_NATIVE_HTTP')]:
        check();current={**childenv,'TEXT_DRAFT_'+prefix+'_APPROVED':'1','TEXT_DRAFT_'+prefix+'_DATABASE':name}
        out,err=invoke([tools['node'],'--import','tsx','server/'+file],ROOT/'packages/action-api',current,65,1024)
        if err.stat().st_size:fail('RECEIPT_REJECTED')
        receipt(bounded_read(out,1024),kind)
    check();verify_evidence(private,evidence)
    result['sourceDigest']=hashlib.sha256(json.dumps(pins,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def main(argv=None):
    result={'schemaVersion':1,'kind':'TEXT_DRAFT_TEST_RUNNER','status':'failed','category':'CONFIGURATION_FAILED','runId':None,'profile':None,'layout':None,'steps':0,'sourceDigest':None}
    private=None;evidence={}
    try:
        args=list(sys.argv[1:] if argv is None else argv)
        if len(args)!=4 or args[0]!='--profile' or args[2]!='--layout':fail('CONFIGURATION_FAILED')
        profile,layout=args[1],args[3];tools,env=configuration(profile,layout)
        result.update(runId=str(uuid.uuid4()),profile=profile,layout=layout)
        parent=canonical(pathlib.Path(tempfile.gettempdir()).resolve(),True)
        private=parent/('lumin-text-draft-tests-'+result['runId']);private.mkdir(mode=0o700,exist_ok=False);canonical(private,True)
        if private.is_relative_to(ROOT.resolve()):fail('CUSTODY_REJECTED')
        execute(profile,layout,private,result,tools,env,evidence=evidence)
        result.update(status='passed',category='COMPLETE')
    except BaseException as error:
        category=error.args[0] if type(error) is Failure and len(error.args)==1 else 'INTERNAL_FAILED'
        result['category']=category if category in CATEGORIES else 'INTERNAL_FAILED'
    if private is not None:
        try:
            verify_evidence(private,evidence)
            fixed=private/'receipt.json'
            with fixed.open('xb') as target:
                custody(fixed,target);target.write(json.dumps(result,separators=(',',':')).encode('ascii'));target.flush();evidence[fixed.name]=snapshot(fixed,target)
            verify_evidence(private,evidence)
        except BaseException:
            # A custody failure cannot erase an earlier execution failure.
            if result['status']=='passed':result.update(status='failed',category='RECEIPT_WRITE_FAILED')
    print(json.dumps(result,separators=(',',':')),flush=True)
    return 0 if result['status']=='passed' else 1
if __name__=='__main__':sys.exit(main())
