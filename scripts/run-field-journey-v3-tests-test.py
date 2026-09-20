"""Inert supervisor contract tests; no process or database is launched."""
import hashlib,importlib.util,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('journey',pathlib.Path(__file__).with_name('run-field-journey-v3-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def receipt(self):return {'schemaVersion':1,'kind':'FIELD_V3_SQL_BROWSER','status':'passed','category':'COMPLETE','cases':8,'browserClosed':True,'serversClosed':True,'connectionsClosed':True}
 def test_receipt_exact(self):
  value=self.receipt();raw=lambda x:(json.dumps(x,separators=(',',':'))+'\n').encode()
  self.assertEqual(m.journey_receipt(raw(value)),value)
  for key,bad in [('cases',True),('cases',6),('cases',7),('cases',9),('kind','FIELD_V2_SQL_BROWSER'),('browserClosed',False),('serversClosed',False),('connectionsClosed',False),('category','FAILED'),('status','failed')]:
   with self.assertRaises(m.Failure):m.journey_receipt(raw({**value,key:bad}))
  with self.assertRaises(m.Failure):m.journey_receipt(raw({**value,'extra':1}))
  for malformed in [raw(value)+b'\n',json.dumps(value).encode(),raw(value).replace(b'"cases":8',b'"cases":8.0'),raw(value).replace(b'"cases":8',b'"cases":7,"cases":8')]:
   with self.assertRaises(m.Failure):m.journey_receipt(malformed)
 def test_approval_before_base(self):
  with patch.dict(m.os.environ,{},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('local','public')
   call.assert_not_called()
 def test_v2_approval_cannot_authorize_v3(self):
  with patch.dict(m.os.environ,{'FIELD_JOURNEY_V2_RUNNER_APPROVED':'1'},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('local','public')
   call.assert_not_called()
 def test_fresh_database_and_bounded_step(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};seen=[]
   def prior(*args,**kwargs):args[3]['steps']=53
   def runner(args,cwd,env,private,index,seconds,maximum):
    seen.append((args,env,index,seconds,maximum));out=private/'54.stdout';err=private/'54.stderr';out.write_bytes((json.dumps(self.receipt(),separators=(',',':'))+'\n').encode());err.write_bytes(b'')
    return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior):m.execute('local','public',root,result,{'node':'node'},{'PGPASSWORD':'','PGHOST':'wrong'},runner=runner,source_check=lambda:([],{'pin':'fixed'}),evidence=evidence)
   self.assertEqual(result['steps'],54);env=seen[0][1];self.assertEqual(env['TEXT_DRAFT_HTTP_DATABASE'],'lumin_text_draft_'+uuid.UUID(result['runId']).hex);self.assertNotIn('PGHOST',env);self.assertEqual(env['FIELD_JOURNEY_V3_APPROVED'],'1');self.assertLessEqual(seen[0][3],240);self.assertEqual(len(evidence),2)
 def test_rejects_unknown_profile_before_base(self):
  with patch.dict(m.os.environ,{'FIELD_JOURNEY_V3_RUNNER_APPROVED':'1'},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('other','public')
   call.assert_not_called()
 def test_valid_profiles_delegate_without_changing_layout(self):
  for profile in ('local','github-ci'):
   for layout in ('public','extensions'):
    with patch.dict(m.os.environ,{'FIELD_JOURNEY_V3_RUNNER_APPROVED':'1'},clear=True),patch.object(m.base,'configuration',return_value=('tools','env')) as call:
     self.assertEqual(m.configuration(profile,layout),('tools','env'));call.assert_called_once_with(profile,layout)
 def test_base_platform_actions_and_approval_guards(self):
  approved={'FIELD_JOURNEY_V3_RUNNER_APPROVED':'1','FIELD_DRAFT_V3_RUNNER_APPROVED':'1','TEXT_DRAFT_RUNNER_APPROVED':'1','GITHUB_ACTIONS':'true'}
  for missing in ('FIELD_JOURNEY_V3_RUNNER_APPROVED','FIELD_DRAFT_V3_RUNNER_APPROVED','TEXT_DRAFT_RUNNER_APPROVED'):
   values={k:v for k,v in approved.items() if k!=missing}
   with patch.dict(m.os.environ,values,clear=True):
    with self.assertRaises(m.Failure):m.configuration('github-ci','public')
  for profile,platform,osname,actions in [('github-ci','win32','nt','true'),('github-ci','linux','posix','false'),('local','linux','posix','true')]:
   with patch.dict(m.os.environ,{**approved,'GITHUB_ACTIONS':actions},clear=True),patch.object(m.legacy.sys,'platform',platform),patch.object(m.legacy.os,'name',osname):
    with self.assertRaises(m.Failure):m.configuration(profile,'public')
  with patch.dict(m.os.environ,approved,clear=True),patch.object(m.base,'configuration',side_effect=m.Failure('CONFIGURATION_FAILED')):
   with self.assertRaises(m.Failure):m.configuration('github-ci','public')
 def test_ci_step54_environment_is_narrow(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};seen=[]
   def prior(*args,**kwargs):args[3]['steps']=53
   def runner(args,cwd,env,private,index,seconds,maximum):
    seen.append(env);out=private/'54.stdout';err=private/'54.stderr';out.write_bytes((json.dumps(self.receipt(),separators=(',',':'))+'\n').encode());err.write_bytes(b'')
    return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior):m.execute('github-ci','extensions',root,result,{'node':'node'},{'PGPASSWORD':'postgres','PGHOST':'hostile','PGSERVICE':'hostile'},runner=runner,source_check=lambda:([],{'pin':'fixed'}))
   env=seen[0];self.assertEqual(env['GITHUB_ACTIONS'],'true');self.assertEqual(env['TEXT_DRAFT_TEST_PROFILE'],'github-ci');self.assertEqual(env['TEXT_DRAFT_TEST_LAYOUT'],'extensions');self.assertEqual(env['TEXT_DRAFT_TEST_DISPOSABLE'],'1');self.assertEqual(env['PGPASSWORD'],'postgres');self.assertEqual(env['PGPASSFILE'],m.os.devnull);self.assertNotIn('PGHOST',env);self.assertNotIn('PGSERVICE',env);self.assertEqual(result['steps'],54)
 def test_missing_browser_helper_or_test_rejects_source_inventory(self):
  pins={'packages/action-api/server/'+name:'fixed' for name in ('field-journey-v3-environment.ts','field-journey-v3-environment.test.ts')}
  required=['tsconfig.field-journey-v3.json','scripts/run-field-journey-v3.mjs','scripts/run-field-journey-v3-tests.py','scripts/run-field-journey-v3-tests-test.py','scripts/run-field-journey-v3-browser.mjs','scripts/run-field-journey-v3-browser.test.mjs','tests/field-journey-v3/fixture.tsx','tests/field-journey-v3/fixture.html','tests/field-journey-v3/browser-cases.ts','apps/portal/src/flows/LocalFieldDraftV3Host.tsx','apps/portal/src/flows/FieldDraftV3Editor.tsx']
  for absent in ('run-field-journey-v3-browser.mjs','run-field-journey-v3-browser.test.mjs'):
   with tempfile.TemporaryDirectory() as folder:
    root=pathlib.Path(folder)
    for name in required:
     path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'controlled fixture')
    with patch.object(m,'ROOT',root),patch.object(m,'__file__',str(root/'scripts/run-field-journey-v3-tests.py')),patch.object(m.base,'sources',side_effect=lambda:([],pins.copy())):
     baseline=m.sources()[1];self.assertIn('scripts/'+absent,baseline);(root/'scripts'/absent).unlink()
     with self.assertRaises(m.Failure):m.sources()
 def test_valid_base_profiles_keep_fixed_endpoints(self):
  approved={'FIELD_JOURNEY_V3_RUNNER_APPROVED':'1','FIELD_DRAFT_V3_RUNNER_APPROVED':'1','TEXT_DRAFT_RUNNER_APPROVED':'1','GITHUB_ACTIONS':'true','PGHOST':'hostile','PGPASSWORD':'hostile'}
  for profile,platform,osname,port,password in [('local','win32','nt','55439',''),('github-ci','linux','posix','5432','postgres')]:
   with patch.dict(m.os.environ,approved,clear=True),patch.object(m.legacy.sys,'platform',platform),patch.object(m.legacy.os,'name',osname),patch.object(m.legacy.shutil,'which',side_effect=lambda name:'/fixed/'+name):
    tools,env=m.configuration(profile,'public');self.assertEqual(env['PGHOST'],'127.0.0.1');self.assertEqual(env['PGPORT'],port);self.assertEqual(env['PGPASSWORD'],password);self.assertEqual(env['PGSSLMODE'],'disable');self.assertEqual(env['PGPASSFILE'],m.os.devnull)
 def test_requires_all_53_prior_steps(self):
  with tempfile.TemporaryDirectory() as folder:
   result={'steps':0,'runId':str(uuid.uuid4())}
   def prior(*args,**kwargs):args[3]['steps']=52
   with patch.object(m.base,'execute',prior),patch.object(m,'sources') as unused:
    with self.assertRaises(m.Failure):m.execute('local','public',pathlib.Path(folder),result,{'node':'node'},{'PGPASSWORD':''},runner=lambda *a:self.fail('must not launch'),source_check=lambda:([],{'pin':'fixed'}))
 def test_source_change_and_expired_deadline_prevent_launch(self):
  with tempfile.TemporaryDirectory() as folder:
   def prior(*args,**kwargs):args[3]['steps']=53
   for changed in [True,False]:
    count=0
    def source():
     nonlocal count
     count+=1
     return ([],{'pin':'new' if changed and count>1 else 'fixed'})
    ticks=iter([0,781])
    with patch.object(m.base,'execute',prior),self.assertRaises(m.Failure):
     m.execute('local','public',pathlib.Path(folder),{'steps':0,'runId':str(uuid.uuid4())},{'node':'node'},{'PGPASSWORD':''},runner=lambda *a:self.fail('must not launch'),source_check=source,clock=lambda:next(ticks))
 def test_failed_child_keeps_evidence(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);evidence={}
   def prior(*args,**kwargs):args[3]['steps']=53
   def runner(args,cwd,env,private,index,seconds,maximum):
    out=private/'54.stdout';err=private/'54.stderr';out.write_bytes(b'');err.write_bytes(b'finite failure')
    return 1,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior),self.assertRaises(m.Failure):m.execute('local','public',root,{'steps':0,'runId':str(uuid.uuid4())},{'node':'node'},{'PGPASSWORD':''},runner=runner,source_check=lambda:([],{'pin':'fixed'}),evidence=evidence)
   self.assertEqual(set(evidence),{'54.stdout','54.stderr'})
 def test_pins_root_config_and_all_journey_surfaces(self):
  required=['tsconfig.field-journey-v3.json','scripts/run-field-journey-v3.mjs','scripts/run-field-journey-v3-browser.mjs','scripts/run-field-journey-v3-browser.test.mjs','scripts/run-field-journey-v3-tests.py','scripts/run-field-journey-v3-tests-test.py','tests/field-journey-v3/fixture.tsx','tests/field-journey-v3/fixture.html','tests/field-journey-v3/browser-cases.ts','apps/portal/src/flows/LocalFieldDraftV3Host.tsx','apps/portal/src/flows/FieldDraftV3Editor.tsx']
  environment=['packages/action-api/server/field-journey-v3-environment.ts','packages/action-api/server/field-journey-v3-environment.test.ts']
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder)
   for name in required:
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'controlled fixture')
   basepins={name:'base-pinned' for name in environment}
   with patch.object(m,'ROOT',root),patch.object(m,'__file__',str(root/'scripts/run-field-journey-v3-tests.py')),patch.object(m.base,'sources',side_effect=lambda:([],basepins.copy())):
    _,pins=m.sources()
    for name in required:self.assertIn(name,pins)
    for name in environment:self.assertEqual(pins[name],'base-pinned')
    config=root/'tsconfig.field-journey-v3.json';self.assertEqual(pins[config.name],hashlib.sha256(config.read_bytes()).hexdigest());config.write_bytes(b'changed fixture');self.assertNotEqual(m.sources()[1][config.name],pins[config.name]);config.unlink()
    with self.assertRaises(m.Failure):m.sources()
 def test_prior_evidence_survives_and_exact_54_pairs_are_collected(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={}
   def prior(*args,**kwargs):
    args[3]['steps']=53
    for index in range(1,54):
     for suffix in ('stdout','stderr'):
      path=root/f'{index}.{suffix}';path.write_bytes(b'');kwargs['evidence'][path.name]=m.snapshot(path)
   def runner(args,cwd,env,private,index,seconds,maximum):
    self.assertEqual(index,54);self.assertEqual(maximum,2048);self.assertEqual(seconds,240);self.assertEqual(args,['node','--import','tsx','scripts/run-field-journey-v3.mjs'])
    out=private/'54.stdout';err=private/'54.stderr';out.write_bytes((json.dumps(self.receipt(),separators=(',',':'))+'\n').encode());err.write_bytes(b'');return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior):m.execute('local','public',root,result,{'node':'node'},{'PGPASSWORD':''},runner=runner,source_check=lambda:([],{'pin':'fixed'}),evidence=evidence,clock=lambda:0)
   self.assertEqual(len(evidence),108);self.assertEqual(result['steps'],54)
   # main owns the separate receipt.json: 108 captured streams plus one receipt.
   self.assertEqual(len(evidence)+1,109)
if __name__=='__main__':unittest.main()
