"""Fresh disposable SQL/native gates followed by browser journey. Inert on import.
Evidence remains capped, private and preserved on failure. No live database selection.
"""
import importlib.util,hashlib,json,os,pathlib,sys,tempfile,time,uuid
spec=importlib.util.spec_from_file_location('field_v2_supervisor',pathlib.Path(__file__).with_name('run-field-draft-v2-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
legacy=base.base
ROOT=base.ROOT
Failure=base.Failure
fail=base.fail
canonical=legacy.canonical
custody=legacy.custody
snapshot=legacy.snapshot
verify_evidence=legacy.verify_evidence
CATEGORIES=legacy.CATEGORIES

def configuration(profile,layout):
    if os.environ.get('FIELD_JOURNEY_V2_RUNNER_APPROVED')!='1':fail('CONFIGURATION_FAILED')
    if profile!='local':fail('CONFIGURATION_FAILED')
    return base.configuration(profile,layout)

def sources():
    migrations,pins=base.sources()
    files={pathlib.Path(__file__).resolve(),ROOT/'scripts/run-field-journey-v2.mjs'}
    for name in ('field-journey-v2-environment.ts','field-journey-v2-environment.test.ts'):
        if 'packages/action-api/server/'+name not in pins:fail('SOURCE_CHANGED')
    files.update(p for p in (ROOT/'scripts').glob('run-field-journey-v2*') if p.is_file())
    for directory in (ROOT/'apps/portal/src',ROOT/'tests/field-journey-v2'):
        if not directory.is_dir():fail('SOURCE_CHANGED')
        files.update(p for p in directory.rglob('*') if p.is_file() and 'node_modules' not in p.parts)
    for p in sorted(files):
        pins[p.relative_to(ROOT).as_posix()]=hashlib.sha256(legacy.bounded_read(p,4194304)).hexdigest()
    return migrations,pins

def journey_receipt(raw):
    expected={'schemaVersion':1,'kind':'FIELD_V2_SQL_BROWSER','status':'passed','category':'COMPLETE','cases':6,'browserClosed':True,'serversClosed':True,'connectionsClosed':True}
    try:value=json.loads(raw.decode('ascii'))
    except BaseException:fail('RECEIPT_REJECTED')
    if type(value)is not dict or set(value)!=set(expected) or any(type(value[k])is not type(v) or value[k]!=v for k,v in expected.items()):fail('RECEIPT_REJECTED')
    if raw!=(json.dumps(value,separators=(',',':'))+'\n').encode('ascii'):fail('RECEIPT_REJECTED')
    return value

def execute(profile,layout,private,result,tools,env,runner=legacy.run_private,clock=time.monotonic,source_check=sources,evidence=None):
    if evidence is None:evidence={}
    _,pins=source_check();deadline=clock()+780
    base.execute(profile,layout,private,result,tools,env,runner=runner,clock=clock,source_check=source_check,evidence=evidence)
    if result['steps']!=47:fail('RECEIPT_REJECTED')
    if source_check()[1]!=pins:fail('SOURCE_CHANGED')
    if clock()>=deadline:fail('PROCESS_BOUND')
    database='lumin_text_draft_'+uuid.UUID(result['runId']).hex
    childenv={k:v for k,v in env.items() if not k.startswith('PG')}
    childenv.update(PGPASSWORD=env['PGPASSWORD'],PGPASSFILE=os.devnull,TEXT_DRAFT_TEST_PROFILE=profile,TEXT_DRAFT_TEST_LAYOUT=layout,TEXT_DRAFT_TEST_DISPOSABLE='1',TEXT_DRAFT_HTTP_DATABASE=database,FIELD_JOURNEY_V2_APPROVED='1',TSX_DISABLE_CACHE='1')
    if profile=='github-ci':childenv['GITHUB_ACTIONS']='true'
    result['steps']+=1
    def retain(completed):
        if type(completed)is not dict or set(completed)!={'48.stdout','48.stderr'} or set(completed)&set(evidence):fail('CUSTODY_REJECTED')
        evidence.update(completed);verify_evidence(private,evidence)
    try:code,out,err,completed=runner([tools['node'],'--import','tsx','scripts/run-field-journey-v2.mjs'],ROOT,childenv,private,48,min(240,deadline-clock()),2048)
    except Failure as error:
        if getattr(error,'artifacts',None)is not None:retain(error.artifacts)
        raise
    retain(completed)
    if code!=0:fail('NATIVE_FAILED')
    if err.stat().st_size:fail('RECEIPT_REJECTED')
    journey_receipt(legacy.bounded_read(out,2048))
    if clock()>=deadline:fail('PROCESS_BOUND')
    if source_check()[1]!=pins:fail('SOURCE_CHANGED')
    verify_evidence(private,evidence)
    result['sourceDigest']=hashlib.sha256(json.dumps(pins,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def main(argv=None):
    result={'schemaVersion':1,'kind':'FIELD_JOURNEY_V2_TEST_RUNNER','status':'failed','category':'CONFIGURATION_FAILED','runId':None,'profile':None,'layout':None,'steps':0,'sourceDigest':None}
    private=None;evidence={}
    try:
        args=list(sys.argv[1:] if argv is None else argv)
        if len(args)!=4 or args[0]!='--profile' or args[2]!='--layout':fail('CONFIGURATION_FAILED')
        profile,layout=args[1],args[3];tools,env=configuration(profile,layout)
        result.update(runId=str(uuid.uuid4()),profile=profile,layout=layout)
        parent=canonical(pathlib.Path(tempfile.gettempdir()).resolve(),True)
        private=parent/('lumin-field-journey-v2-tests-'+result['runId']);private.mkdir(mode=0o700,exist_ok=False);canonical(private,True)
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
