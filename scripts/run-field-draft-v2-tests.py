"""Bounded disposable V2 storage gates after unchanged legacy SQL/native gates."""
import importlib.util,hashlib,json,os,pathlib,sys,tempfile,time,uuid
spec=importlib.util.spec_from_file_location('legacy_draft_runner',pathlib.Path(__file__).with_name('run-text-draft-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
ROOT=base.ROOT
Failure=base.Failure
fail=base.fail
def configuration(profile,layout):
    if os.environ.get('FIELD_DRAFT_V2_RUNNER_APPROVED')!='1':fail('CONFIGURATION_FAILED')
    return base.configuration(profile,layout)
def sources():
    migrations,pins=base.sources()
    for name in ('field-drafts-v2-repository.integration.ts','field-drafts-v2-repository.integration.test.ts','field-drafts-v2-http.integration.ts','field-drafts-v2-http.integration.test.ts'):
        if 'packages/action-api/server/'+name not in pins:fail('SOURCE_CHANGED')
    for p in [pathlib.Path(__file__).resolve(),pathlib.Path(__file__).with_name('run-field-draft-v2-tests-test.py').resolve(),ROOT/'supabase/tests/field_drafts_v2_tests.sql',ROOT/'supabase/tests/field_drafts_v2_upgrade_fixture.sql']:
        pins[p.relative_to(ROOT).as_posix()]=hashlib.sha256(base.bounded_read(p,4194304)).hexdigest()
    return migrations,pins
def receipt(raw,kind='FIELD_DRAFT_V2_CONCURRENCY'):
    try:value=json.loads(raw.decode('ascii'))
    except BaseException:fail('RECEIPT_REJECTED')
    expected={'schemaVersion':1,'kind':'FIELD_DRAFT_V2_CONCURRENCY','status':'passed','category':'COMPLETE','cases':14,'parityCases':32,'connectionsClosed':True}
    if kind=='FIELD_DRAFT_V2_REPOSITORY':expected={'schemaVersion':1,'kind':kind,'status':'passed','category':'COMPLETE','cases':6,'connectionsClosed':True}
    elif kind=='FIELD_DRAFT_V2_HTTP':
        expected={'schemaVersion':1,'kind':kind,'status':'passed','category':'COMPLETE','cases':7,'httpRequests':27,'serverClosed':True,'connectionsClosed':True}
    elif kind!='FIELD_DRAFT_V2_CONCURRENCY':fail('RECEIPT_REJECTED')
    if type(value)is not dict or set(value)!=set(expected) or any(type(value[k])is not type(v) or value[k]!=v for k,v in expected.items()):fail('RECEIPT_REJECTED')
    if raw!=(json.dumps(value,separators=(',',':'))+'\n').encode('ascii'):fail('RECEIPT_REJECTED')
    return value
def execute(profile,layout,private,result,tools,env,runner=base.run_private,clock=time.monotonic,source_check=sources,evidence=None):
    if evidence is None:evidence={}
    _,pins=source_check();deadline=clock()+510
    def before_migration(migration,sql):
        if migration.name=='0034_field_drafts_v2.sql':sql('-f',str(ROOT/'supabase/tests/field_drafts_v2_upgrade_fixture.sql'))
    def after_migration(migration,sql):
        if migration.name=='0034_field_drafts_v2.sql':sql('-f',str(ROOT/'supabase/tests/field_drafts_v2_tests.sql'))
    base.execute(profile,layout,private,result,tools,env,runner=runner,clock=clock,source_check=source_check,evidence=evidence,before_migration=before_migration,after_migration=after_migration)
    if result['steps']!=44:fail('RECEIPT_REJECTED')
    database='lumin_text_draft_'+uuid.UUID(result['runId']).hex
    def invoke(args,cwd,childenv,seconds,maximum,category):
        if source_check()[1]!=pins:fail('SOURCE_CHANGED')
        if clock()>=deadline:fail('PROCESS_BOUND')
        result['steps']+=1;index=result['steps']
        def retain(completed):
            if type(completed)is not dict or set(completed)!={str(index)+'.stdout',str(index)+'.stderr'} or set(completed)&set(evidence):fail('CUSTODY_REJECTED')
            evidence.update(completed);base.verify_evidence(private,evidence)
        try:code,out,err,completed=runner(args,cwd,childenv,private,index,min(seconds,deadline-clock()),maximum)
        except Failure as error:
            if getattr(error,'artifacts',None)is not None:retain(error.artifacts)
            raise
        retain(completed)
        if code!=0:fail(category)
        return out,err
    childenv={k:v for k,v in env.items() if not k.startswith('PG')}
    childenv.update(PGPASSWORD=env['PGPASSWORD'],PGPASSFILE=os.devnull,TEXT_DRAFT_TEST_PROFILE=profile,TEXT_DRAFT_TEST_LAYOUT=layout,TEXT_DRAFT_TEST_DISPOSABLE='1',TEXT_DRAFT_CONCURRENCY_DATABASE=database,TEXT_DRAFT_CONCURRENCY_APPROVED='1',FIELD_DRAFT_V2_CONCURRENCY_APPROVED='1',TSX_DISABLE_CACHE='1')
    if profile=='github-ci':childenv['GITHUB_ACTIONS']='true'
    out,err=invoke([tools['node'],'--import','tsx','server/field-drafts-v2-concurrency.integration.ts'],ROOT/'packages/action-api',childenv,95,2048,'NATIVE_FAILED')
    if err.stat().st_size:fail('RECEIPT_REJECTED')
    receipt(base.bounded_read(out,2048))
    childenv={**childenv,'FIELD_DRAFT_V2_REPOSITORY_APPROVED':'1','TEXT_DRAFT_HTTP_DATABASE':database,'TEXT_DRAFT_HTTP_APPROVED':'1'}
    out,err=invoke([tools['node'],'--import','tsx','server/field-drafts-v2-repository.integration.ts'],ROOT/'packages/action-api',childenv,60,2048,'NATIVE_FAILED')
    if err.stat().st_size:fail('RECEIPT_REJECTED')
    receipt(base.bounded_read(out,2048),'FIELD_DRAFT_V2_REPOSITORY')
    childenv={**childenv,'FIELD_DRAFT_V2_HTTP_APPROVED':'1'}
    out,err=invoke([tools['node'],'--import','tsx','server/field-drafts-v2-http.integration.ts'],ROOT/'packages/action-api',childenv,80,2048,'NATIVE_FAILED')
    if err.stat().st_size:fail('RECEIPT_REJECTED')
    receipt(base.bounded_read(out,2048),'FIELD_DRAFT_V2_HTTP')
    if clock()>=deadline:fail('PROCESS_BOUND')
    if source_check()[1]!=pins:fail('SOURCE_CHANGED')
    base.verify_evidence(private,evidence)
    result['sourceDigest']=hashlib.sha256(json.dumps(pins,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def main(argv=None):
    result={'schemaVersion':1,'kind':'FIELD_DRAFT_V2_TEST_RUNNER','status':'failed','category':'CONFIGURATION_FAILED','runId':None,'profile':None,'layout':None,'steps':0,'sourceDigest':None}
    private=None;evidence={}
    try:
        args=list(sys.argv[1:] if argv is None else argv)
        if len(args)!=4 or args[0]!='--profile' or args[2]!='--layout':fail('CONFIGURATION_FAILED')
        profile,layout=args[1],args[3];tools,env=configuration(profile,layout)
        result.update(runId=str(uuid.uuid4()),profile=profile,layout=layout)
        parent=base.canonical(pathlib.Path(tempfile.gettempdir()).resolve(),True)
        private=parent/('lumin-field-draft-v2-tests-'+result['runId']);private.mkdir(mode=0o700,exist_ok=False);base.canonical(private,True)
        if private.is_relative_to(ROOT.resolve()):fail('CUSTODY_REJECTED')
        execute(profile,layout,private,result,tools,env,evidence=evidence)
        result.update(status='passed',category='COMPLETE')
    except BaseException as error:
        category=error.args[0] if type(error)is Failure and len(error.args)==1 else 'INTERNAL_FAILED'
        result['category']=category if category in base.CATEGORIES else 'INTERNAL_FAILED'
    if private is not None:
        try:
            base.verify_evidence(private,evidence);fixed=private/'receipt.json'
            with fixed.open('xb') as target:
                base.custody(fixed,target);target.write(json.dumps(result,separators=(',',':')).encode('ascii'));target.flush();evidence[fixed.name]=base.snapshot(fixed,target)
            base.verify_evidence(private,evidence)
        except BaseException:
            if result['status']=='passed':result.update(status='failed',category='RECEIPT_WRITE_FAILED')
    print(json.dumps(result,separators=(',',':')),flush=True)
    return 0 if result['status']=='passed' else 1
if __name__=='__main__':sys.exit(main())
