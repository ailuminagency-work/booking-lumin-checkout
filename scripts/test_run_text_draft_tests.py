import contextlib,importlib.util,io,json,os,pathlib,subprocess,tempfile,unittest
from unittest.mock import patch
p=pathlib.Path(__file__).with_name('run-text-draft-tests.py');spec=importlib.util.spec_from_file_location('runner',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RACE={'schemaVersion':1,'kind':'TEXT_DRAFT_CONCURRENCY','status':'passed','category':'COMPLETE','cases':6,'parityCases':45,'connectionsClosed':True}
HTTP={'schemaVersion':1,'kind':'TEXT_DRAFT_NATIVE_HTTP','status':'passed','category':'COMPLETE','groups':9,'httpRequests':30,'textCalls':20,'legacyCalls':4,'serverClosed':True,'connectionsClosed':True}
class Tests(unittest.TestCase):
 def folder(self):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);return pathlib.Path(temp.name)
 def test_configuration_failclosed_and_sanitized(self):
  with patch.object(m.sys,'platform','linux'),patch.dict(os.environ,{'GITHUB_ACTIONS':'true','TEXT_DRAFT_RUNNER_APPROVED':'1','PGHOST':'bad','PGSERVICE':'bad','NODE_OPTIONS':'bad'}),patch.object(m.shutil,'which',side_effect=lambda n:'/usr/bin/'+n):
   tools,env=m.configuration('github-ci','extensions');self.assertEqual(env['PGHOST'],'127.0.0.1');self.assertEqual(env['PGPORT'],'5432');self.assertEqual(env['PGPASSWORD'],'postgres');self.assertNotIn('PGSERVICE',env);self.assertNotIn('NODE_OPTIONS',env)
   with self.assertRaises(m.Failure):m.configuration('production','public')
   with self.assertRaises(m.Failure):m.configuration('github-ci','other')
 def test_fresh_order_and_profiles(self):
  for layout in ('public','extensions'):
   private=self.folder();calls=[];result={'runId':'12345678-1234-4234-8234-123456789abc','steps':0}
   def run(args,cwd,env,folder,index,seconds,maximum):
    calls.append((args,env));self.assertLessEqual(seconds,65)
    out=folder/(str(index)+'.stdout');err=folder/(str(index)+'.stderr');out.write_bytes(b'f\n' if index==1 else (json.dumps(RACE if index==42 else HTTP,separators=(',',':'))+'\n').encode() if index>=42 else b'');err.write_bytes(b'')
    return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   m.execute('github-ci',layout,private,result,{'node':'node','psql':'psql'},{'PGPASSWORD':'postgres'},runner=run,source_check=lambda:([pathlib.Path(str(n)) for n in range(35)],{'test':'pin'}))
   self.assertTrue(calls[39][0][-1].endswith('text_field_drafts_tests.sql'));self.assertTrue(calls[40][0][-1].endswith('text_field_prompts_tests.sql'))
   self.assertEqual(len(calls),43);self.assertIn('create database lumin_text_draft_12345678123442348234123456789abc',calls[1][0]);self.assertIn('schema '+layout,calls[2][0][-1]);self.assertEqual(calls[41][1]['TEXT_DRAFT_TEST_LAYOUT'],layout);self.assertEqual(calls[42][1]['TEXT_DRAFT_HTTP_DATABASE'],'lumin_text_draft_12345678123442348234123456789abc');self.assertNotIn('PGHOST',calls[42][1])
 def test_existing_db_stops_before_create(self):
  private=self.folder();calls=[]
  def run(args,cwd,env,folder,index,seconds,maximum):
   calls.append(args);out=folder/'1.stdout';err=folder/'1.stderr';out.write_bytes(b't\n');err.write_bytes(b'');return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
  with self.assertRaises(m.Failure):m.execute('local','public',private,{'runId':'12345678-1234-4234-8234-123456789abc','steps':0},{'node':'node','psql':'psql'},{'PGPASSWORD':''},runner=run,source_check=lambda:([],{}))
  self.assertEqual(len(calls),1)
 def test_upgrade_hooks_precede_legacy_suites_and_failure_stops(self):
  for reject_serial in (False,True):
   private=self.folder();calls=[];result={'runId':'12345678-1234-4234-8234-123456789abc','steps':0}
   def before(migration,sql):
    if migration.name=='0034.sql':sql('-f','upgrade_fixture.sql')
   def after(migration,sql):
    if migration.name=='0034.sql':sql('-f','upgrade_assert_and_cleanup.sql')
   def run(args,cwd,env,folder,index,seconds,maximum):
    calls.append(args);out=folder/(str(index)+'.stdout');err=folder/(str(index)+'.stderr')
    out.write_bytes(b'f\n' if index==1 else raw_receipt(index));err.write_bytes(b'')
    return (1 if reject_serial and args[-1]=='upgrade_assert_and_cleanup.sql' else 0),out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   def raw_receipt(index):return (json.dumps(RACE if index==44 else HTTP,separators=(',',':'))+'\n').encode() if index>=44 else b''
   def execute():m.execute('local','public',private,result,{'node':'node','psql':'psql'},{'PGPASSWORD':''},runner=run,source_check=lambda:([pathlib.Path(f'{n:04}.sql') for n in range(1,36)],{'pin':'fixed'}),before_migration=before,after_migration=after)
   if reject_serial:
    with self.assertRaisesRegex(m.Failure,'SQL_FAILED'):execute()
    self.assertEqual(calls[-1][-1],'upgrade_assert_and_cleanup.sql');self.assertEqual(len(calls),40)
   else:
    execute();self.assertEqual(len(calls),45)
    self.assertEqual([call[-1] for call in calls[37:40]],['upgrade_fixture.sql','0034.sql','upgrade_assert_and_cleanup.sql'])
    self.assertTrue(calls[41][-1].endswith('text_field_drafts_tests.sql'));self.assertTrue(calls[42][-1].endswith('text_field_prompts_tests.sql'))
 def test_receipts_strict(self):
  for value in (RACE,HTTP):
   raw=(json.dumps(value,separators=(',',':'))+'\n').encode();self.assertEqual(m.receipt(raw,value['kind']),value)
   for change in ({'connectionsClosed':False},{'schemaVersion':True},{'extra':'private'}):
    with self.assertRaises(m.Failure):m.receipt((json.dumps({**value,**change},separators=(',',':'))+'\n').encode(),value['kind'])
 def test_posix_cleanup_signals_owned_group_and_observes_child(self):
  child=type('Child',(),{'pid':12345,'wait':lambda self,timeout:0})()
  with patch.object(m.os,'name','posix'),patch.object(m.signal,'SIGKILL',9,create=True),patch.object(m.os,'killpg',create=True) as kill:m.reap_owned(child)
  kill.assert_called_once_with(12345,9)
 def test_failed_cleanup_is_not_success(self):
  child=type('Child',(),{'pid':12345,'wait':lambda self,timeout:(_ for _ in ()).throw(subprocess.TimeoutExpired('child',timeout))})()
  with patch.object(m.os,'name','posix'),patch.object(m.signal,'SIGKILL',9,create=True),patch.object(m.os,'killpg',create=True):
   with self.assertRaises(m.Failure):m.reap_owned(child)
 def test_failed_run_keeps_correlated_receipt_and_completed_artifacts(self):
  parent=self.folder();identifier='12345678-1234-4234-8234-123456789abc';out=io.StringIO()
  def failed(profile,layout,private,result,tools,env,evidence):
   for name in ('1.stdout','1.stderr'):
    file=private/name;file.write_bytes(b'');evidence[name]=m.snapshot(file)
   result['steps']=1;raise m.Failure('SQL_FAILED')
  with patch.object(m.tempfile,'gettempdir',return_value=str(parent)),patch.object(m.uuid,'uuid4',return_value=m.uuid.UUID(identifier)),patch.object(m,'configuration',return_value=({'node':'node','psql':'psql'},{})),patch.object(m,'execute',side_effect=failed),contextlib.redirect_stdout(out):status=m.main(['--profile','github-ci','--layout','public'])
  self.assertEqual(status,1);directory=parent/('lumin-text-draft-tests-'+identifier)
  value=json.loads((directory/'receipt.json').read_text());self.assertEqual(value,json.loads(out.getvalue()));self.assertEqual(value['category'],'SQL_FAILED');self.assertEqual({p.name for p in directory.iterdir()},{'1.stdout','1.stderr','receipt.json'})
 def test_execution_failure_retains_snapshot_dictionary(self):
  private=self.folder();evidence={}
  def run(args,cwd,env,folder,index,seconds,maximum):
   out=folder/'1.stdout';err=folder/'1.stderr';out.write_bytes(b'');err.write_bytes(b'')
   error=m.Failure('PROCESS_BOUND');error.artifacts={out.name:m.snapshot(out),err.name:m.snapshot(err)};raise error
  with self.assertRaises(m.Failure):m.execute('local','public',private,{'runId':'12345678-1234-4234-8234-123456789abc','steps':0},{'node':'node','psql':'psql'},{'PGPASSWORD':''},runner=run,source_check=lambda:([],{}),evidence=evidence)
  self.assertEqual(set(evidence),{'1.stdout','1.stderr'});m.verify_evidence(private,evidence)
 def test_no_traceback_or_private_error_from_main(self):
  out=io.StringIO()
  with patch.object(m,'configuration',side_effect=RuntimeError('PRIVATE')),contextlib.redirect_stdout(out):result=m.main(['--profile','github-ci','--layout','public'])
  self.assertEqual(result,1);self.assertNotIn('PRIVATE',out.getvalue());self.assertEqual(json.loads(out.getvalue())['category'],'INTERNAL_FAILED')
if __name__=='__main__':unittest.main()
