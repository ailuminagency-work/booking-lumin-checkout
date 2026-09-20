"""Eight observed mutation orderings after unchanged duplicate race qualification."""
import importlib.util,hashlib,json,os,pathlib,sys,tempfile,time,uuid
spec=importlib.util.spec_from_file_location('publication_duplicates',pathlib.Path(__file__).with_name('run-field-publication-duplicate-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
legacy=base.legacy
ROOT=base.ROOT
Failure=base.Failure
fail=base.fail
NATIVE='packages/action-api/server/field-publication-mutations.integration.ts'
NATIVE_TEST='packages/action-api/server/field-publication-mutations.integration.test.ts'
def configuration(profile,layout):
    if os.environ.get('FIELD_PUBLICATION_MUTATION_RUNNER_APPROVED')!='1':fail('CONFIGURATION_FAILED')
    return base.configuration(profile,layout)
def sources():
    migrations,pins=base.sources()
    for name in (NATIVE,NATIVE_TEST,'scripts/run-field-publication-mutation-tests.py','scripts/run-field-publication-mutation-tests-test.py'):
        p=ROOT/name
        pins[name]=hashlib.sha256(legacy.bounded_read(p,4194304)).hexdigest()
    return migrations,pins
def receipt(raw):
    expected={'schemaVersion':1,'kind':'FIELD_PUBLICATION_MUTATIONS','status':'passed','category':'COMPLETE','cases':8,'connectionsClosed':True}
    try:value=json.loads(raw.decode('ascii'))
    except BaseException:fail('RECEIPT_REJECTED')
    if type(value)is not dict or set(value)!=set(expected) or any(type(value[k])is not type(v) or value[k]!=v for k,v in expected.items()):fail('RECEIPT_REJECTED')
    if raw!=(json.dumps(value,separators=(',',':'))+'\n').encode('ascii'):fail('RECEIPT_REJECTED')
    return value

def execute(profile,layout,private,result,tools,env,runner=legacy.run_private,clock=time.monotonic,source_check=sources,evidence=None):
    if evidence is None:evidence={}
    _,pins=source_check();end=clock()+850
    base.execute(profile,layout,private,result,tools,env,runner=runner,clock=clock,source_check=source_check,evidence=evidence)
    if result['steps']!=58:fail('RECEIPT_REJECTED')
    database='lumin_text_draft_'+uuid.UUID(result['runId']).hex
    childenv={k:v for k,v in env.items() if not k.startswith('PG')}
    childenv.update(PGPASSWORD=env['PGPASSWORD'],PGPASSFILE=os.devnull,TEXT_DRAFT_TEST_PROFILE=profile,TEXT_DRAFT_TEST_LAYOUT=layout,TEXT_DRAFT_TEST_DISPOSABLE='1',TEXT_DRAFT_CONCURRENCY_DATABASE=database,TEXT_DRAFT_CONCURRENCY_APPROVED='1',FIELD_PUBLICATION_MUTATIONS_APPROVED='1',TSX_DISABLE_CACHE='1')
    if profile=='github-ci':childenv['GITHUB_ACTIONS']='true'
    invocations=[(59,[tools['node'],'--import','tsx',str(ROOT/NATIVE)],childenv,100,2048),(60,[tools['psql'],'-X','-w','-v','ON_ERROR_STOP=1','-d','postgres','-qAt','-c',"select count(*) from pg_stat_activity where datname='"+database+"'"],env,15,128)]
    for index,args,current,seconds,maximum in invocations:
        if source_check()[1]!=pins:fail('SOURCE_CHANGED')
        if clock()>=end:fail('PROCESS_BOUND')
        result['steps']=index
        def retain(completed):
            if type(completed)is not dict or set(completed)!={str(index)+'.stdout',str(index)+'.stderr'} or set(completed)&set(evidence):fail('CUSTODY_REJECTED')
            evidence.update(completed);legacy.verify_evidence(private,evidence)
        try:code,out,err,completed=runner(args,ROOT,current,private,index,min(seconds,end-clock()),maximum)
        except Failure as error:
            if getattr(error,'artifacts',None)is not None:retain(error.artifacts)
            raise
        retain(completed)
        if code!=0:fail('NATIVE_FAILED' if index==59 else 'SQL_FAILED')
        if err.stat().st_size:fail('RECEIPT_REJECTED')
        if index==59:receipt(legacy.bounded_read(out,2048))
        elif legacy.bounded_read(out,128) not in (b'0\n',b'0\r\n'):fail('CLEANUP_UNOBSERVED')
    if clock()>=end:fail('PROCESS_BOUND')
    if source_check()[1]!=pins:fail('SOURCE_CHANGED')
    legacy.verify_evidence(private,evidence)
    result['sourceDigest']=hashlib.sha256(json.dumps(pins,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def main(argv=None):
    result={'schemaVersion':1,'kind':'FIELD_PUBLICATION_MUTATION_TEST_RUNNER','status':'failed','category':'CONFIGURATION_FAILED','runId':None,'profile':None,'layout':None,'steps':0,'sourceDigest':None}
    private=None;evidence={}
    try:
        args=list(sys.argv[1:] if argv is None else argv)
        if len(args)!=4 or args[0]!='--profile' or args[2]!='--layout':fail('CONFIGURATION_FAILED')
        profile,layout=args[1],args[3];tools,env=configuration(profile,layout)
        result.update(runId=str(uuid.uuid4()),profile=profile,layout=layout)
        parent=legacy.canonical(pathlib.Path(tempfile.gettempdir()).resolve(),True)
        private=parent/('lumin-field-publication-mutation-'+result['runId']);private.mkdir(mode=0o700,exist_ok=False);legacy.canonical(private,True)
        if private.is_relative_to(ROOT.resolve()):fail('CUSTODY_REJECTED')
        execute(profile,layout,private,result,tools,env,evidence=evidence)
        result.update(status='passed',category='COMPLETE')
    except BaseException as error:
        category=error.args[0] if type(error)is Failure and len(error.args)==1 else 'INTERNAL_FAILED'
        result['category']=category if category in legacy.CATEGORIES else 'INTERNAL_FAILED'
    if private is not None:
        try:
            legacy.verify_evidence(private,evidence);fixed=private/'receipt.json'
            with fixed.open('xb') as target:
                legacy.custody(fixed,target);target.write(json.dumps(result,separators=(',',':')).encode('ascii'));target.flush();evidence[fixed.name]=legacy.snapshot(fixed,target)
            legacy.verify_evidence(private,evidence)
        except BaseException:
            if result['status']=='passed':result.update(status='failed',category='RECEIPT_WRITE_FAILED')
    print(json.dumps(result,separators=(',',':')),flush=True)
    return 0 if result['status']=='passed' else 1
if __name__=='__main__':sys.exit(main())
