"""Unregistered SQL candidate: disposable sequential qualification, not race certification."""
import importlib.util,hashlib,json,os,pathlib,sys,tempfile,time,uuid
spec=importlib.util.spec_from_file_location('draft_v3',pathlib.Path(__file__).with_name('run-field-draft-v3-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
legacy=base.base
ROOT=base.ROOT
Failure=base.Failure
fail=base.fail
CANDIDATE='supabase/candidates/field_publication_storage_v1.sql'
FIXTURE='supabase/tests/field_publication_storage_v1_tests.sql'
def configuration(profile,layout):
    if os.environ.get('FIELD_PUBLICATION_CANDIDATE_APPROVED')!='1':fail('CONFIGURATION_FAILED')
    return base.configuration(profile,layout)
def sources():
    migrations,pins=base.sources()
    for name in (CANDIDATE,FIXTURE,'scripts/run-field-publication-candidate-tests.py','scripts/run-field-publication-candidate-tests-test.py'):
        p=ROOT/name
        pins[name]=hashlib.sha256(legacy.bounded_read(p,4194304)).hexdigest()
    return migrations,pins
def execute(profile,layout,private,result,tools,env,runner=legacy.run_private,clock=time.monotonic,source_check=sources,evidence=None):
    if evidence is None:evidence={}
    _,pins=source_check();end=clock()+610
    base.execute(profile,layout,private,result,tools,env,runner=runner,clock=clock,source_check=source_check,evidence=evidence)
    if result['steps']!=53:fail('RECEIPT_REJECTED')
    database='lumin_text_draft_'+uuid.UUID(result['runId']).hex
    for index,tail in [(54,['-f',str(ROOT/CANDIDATE)]),(55,['-f',str(ROOT/FIXTURE)]),(56,['-qAt','-c',"select count(*) from pg_stat_activity where datname='"+database+"'"])]:
        if source_check()[1]!=pins:fail('SOURCE_CHANGED')
        if clock()>=end:fail('PROCESS_BOUND')
        result['steps']=index
        def retain(completed):
            if type(completed)is not dict or set(completed)!={str(index)+'.stdout',str(index)+'.stderr'} or set(completed)&set(evidence):fail('CUSTODY_REJECTED')
            evidence.update(completed);legacy.verify_evidence(private,evidence)
        args=[tools['psql'],'-X','-w','-v','ON_ERROR_STOP=1','-d','postgres' if index==56 else database,*tail]
        try:code,out,err,completed=runner(args,ROOT,env,private,index,min(30,end-clock()),legacy.LIMIT if index<56 else 128)
        except Failure as error:
            if getattr(error,'artifacts',None)is not None:retain(error.artifacts)
            raise
        retain(completed)
        if code!=0:fail('SQL_FAILED')
        if err.stat().st_size:fail('RECEIPT_REJECTED')
        if index==56 and legacy.bounded_read(out,128) not in (b'0\n',b'0\r\n'):fail('CLEANUP_UNOBSERVED')
    if clock()>=end:fail('PROCESS_BOUND')
    if source_check()[1]!=pins:fail('SOURCE_CHANGED')
    legacy.verify_evidence(private,evidence)
    result['sourceDigest']=hashlib.sha256(json.dumps(pins,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def main(argv=None):
    result={'schemaVersion':1,'kind':'FIELD_PUBLICATION_CANDIDATE_TEST_RUNNER','status':'failed','category':'CONFIGURATION_FAILED','runId':None,'profile':None,'layout':None,'steps':0,'sourceDigest':None}
    private=None;evidence={}
    try:
        args=list(sys.argv[1:] if argv is None else argv)
        if len(args)!=4 or args[0]!='--profile' or args[2]!='--layout':fail('CONFIGURATION_FAILED')
        profile,layout=args[1],args[3];tools,env=configuration(profile,layout)
        result.update(runId=str(uuid.uuid4()),profile=profile,layout=layout)
        parent=legacy.canonical(pathlib.Path(tempfile.gettempdir()).resolve(),True)
        private=parent/('lumin-field-publication-candidate-'+result['runId']);private.mkdir(mode=0o700,exist_ok=False);legacy.canonical(private,True)
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
