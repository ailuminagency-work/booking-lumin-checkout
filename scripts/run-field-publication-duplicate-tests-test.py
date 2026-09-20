"""Independent inert duplicate-race supervisor tests; never launch a process or database."""
import importlib.util,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('duplicates',pathlib.Path(__file__).with_name('run-field-publication-duplicate-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def receipt(self):return {'schemaVersion':1,'kind':'FIELD_PUBLICATION_DUPLICATES','status':'passed','category':'COMPLETE','cases':4,'connectionsClosed':True}
 def raw(self,value):return (json.dumps(value,separators=(',',':'))+'\n').encode()
 def run_fixture(self,mutate=None,prior_steps=56,source=None,clock=lambda:0):
  with tempfile.TemporaryDirectory() as folder:
   private=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};calls=[]
   def prior(*args,**kwargs):
    args[3]['steps']=prior_steps
    for index in range(1,prior_steps+1):
     for suffix in ('stdout','stderr'):
      path=private/f'{index}.{suffix}';path.write_bytes(b'');kwargs['evidence'][path.name]=m.legacy.snapshot(path)
   def runner(args,cwd,env,target,index,seconds,maximum):
    calls.append((args,env,index,seconds,maximum));out=target/f'{index}.stdout';err=target/f'{index}.stderr';out.write_bytes(self.raw(self.receipt()) if index==57 else b'0\n');err.write_bytes(b'');completed={out.name:m.legacy.snapshot(out),err.name:m.legacy.snapshot(err)}
    return mutate(index,out,err,completed,evidence) if mutate else (0,out,err,completed)
   try:
    with patch.object(m.base,'execute',prior):m.execute('local','public',private,result,{'node':'fixed-node','psql':'fixed-psql'},{'PGPASSWORD':'','PGHOST':'127.0.0.1','PGSERVICE':'hostile'},runner=runner,source_check=source or (lambda:([],{'pin':'fixed'})),clock=clock,evidence=evidence)
   except m.Failure as error:return result,evidence,calls,error.args[0]
   return result,evidence,calls,None

 def test_own_approval_before_base_and_base_still_required(self):
  for env in ({},{'FIELD_PUBLICATION_CANDIDATE_APPROVED':'1'},{'FIELD_PUBLICATION_DUPLICATE_RUNNER_APPROVED':'true'}):
   with patch.dict(m.os.environ,env,clear=True),patch.object(m.base,'configuration') as delegate:
    with self.assertRaises(m.Failure):m.configuration('local','public')
    delegate.assert_not_called()
  with patch.dict(m.os.environ,{'FIELD_PUBLICATION_DUPLICATE_RUNNER_APPROVED':'1'},clear=True):
   with self.assertRaises(m.Failure):m.configuration('local','public')
  with patch.dict(m.os.environ,{'FIELD_PUBLICATION_DUPLICATE_RUNNER_APPROVED':'1'},clear=True),patch.object(m.base,'configuration',return_value=('tools','env')) as delegate:
   self.assertEqual(m.configuration('github-ci','extensions'),('tools','env'));delegate.assert_called_once_with('github-ci','extensions')

 def test_exact_steps_fresh_database_narrow_native_environment_and_custody(self):
  result,evidence,calls,error=self.run_fixture();self.assertIsNone(error);self.assertEqual(result['steps'],58);self.assertEqual(len(evidence),116);self.assertEqual(len(evidence)+1,117);self.assertEqual([c[2] for c in calls],[57,58])
  args,env,index,seconds,maximum=calls[0];self.assertEqual(args,['fixed-node','--import','tsx',str(m.ROOT/m.NATIVE)]);self.assertEqual(seconds,100);self.assertEqual(maximum,2048)
  self.assertEqual(env['TEXT_DRAFT_CONCURRENCY_DATABASE'],'lumin_text_draft_'+uuid.UUID(result['runId']).hex);self.assertEqual(env['FIELD_PUBLICATION_DUPLICATES_APPROVED'],'1');self.assertEqual(env['TEXT_DRAFT_CONCURRENCY_APPROVED'],'1');self.assertEqual(env['TEXT_DRAFT_TEST_DISPOSABLE'],'1');self.assertEqual(env['TEXT_DRAFT_TEST_LAYOUT'],'public');self.assertNotIn('PGHOST',env);self.assertNotIn('PGSERVICE',env);self.assertEqual(env['PGPASSFILE'],m.os.devnull)
  args,env,index,seconds,maximum=calls[1];self.assertEqual(args[:6],['fixed-psql','-X','-w','-v','ON_ERROR_STOP=1','-d']);self.assertEqual(args[6],'postgres');self.assertIn('lumin_text_draft_'+uuid.UUID(result['runId']).hex,args[-1]);self.assertEqual(seconds,15);self.assertEqual(maximum,128)

 def test_incomplete_or_extra_base_steps_cannot_launch(self):
  for count in (0,55,57):
   result,evidence,calls,error=self.run_fixture(prior_steps=count);self.assertEqual(error,'RECEIPT_REJECTED');self.assertEqual(calls,[])

 def test_native_receipt_exact_values_keys_types_and_encoding(self):
  invalid=[self.raw({**self.receipt(),key:value}) for key,value in [('cases',True),('cases',3),('cases',5),('connectionsClosed',False),('status','failed'),('category','CASE_FAILED'),('kind','FIELD_DRAFT_V3_CONCURRENCY'),('extra',1)]]
  invalid += [json.dumps(self.receipt()).encode(),self.raw(self.receipt())+b'\n',self.raw(self.receipt()).replace(b'"cases":4',b'"cases":3,"cases":4')]
  for raw in invalid:
   def change(index,out,err,completed,evidence):
    if index==57:out.write_bytes(raw);completed[out.name]=m.legacy.snapshot(out)
    return 0,out,err,completed
   result,evidence,calls,error=self.run_fixture(mutate=change);self.assertEqual(error,'RECEIPT_REJECTED');self.assertEqual(len(calls),1);self.assertIn('57.stdout',evidence)

 def test_nonzero_exit_stderr_and_process_failure_preserve_evidence(self):
  def nonzero(index,out,err,completed,evidence):return 1,out,err,completed
  self.assertEqual(self.run_fixture(mutate=nonzero)[3],'NATIVE_FAILED')
  def stderr(index,out,err,completed,evidence):err.write_bytes(b'warning');completed[err.name]=m.legacy.snapshot(err);return 0,out,err,completed
  self.assertEqual(self.run_fixture(mutate=stderr)[3],'RECEIPT_REJECTED')
  def failure(index,out,err,completed,evidence):
   error=m.Failure('PROCESS_BOUND');error.artifacts=completed;raise error
  result,evidence,calls,error=self.run_fixture(mutate=failure);self.assertEqual(error,'PROCESS_BOUND');self.assertEqual(len(evidence),114);self.assertEqual(len(calls),1)

 def test_zero_sessions_exact_and_all_stream_custody(self):
  for raw in [b'1\n',b'',b'00\n',b' 0\n',b'0',b'0\nextra']:
   def change(index,out,err,completed,evidence):
    if index==58:out.write_bytes(raw);completed[out.name]=m.legacy.snapshot(out)
    return 0,out,err,completed
   self.assertEqual(self.run_fixture(mutate=change)[3],'CLEANUP_UNOBSERVED')
  def wrong(index,out,err,completed,evidence):return 0,out,err,{'other.stdout':completed[out.name],err.name:completed[err.name]}
  self.assertEqual(self.run_fixture(mutate=wrong)[3],'CUSTODY_REJECTED')
  def changed(index,out,err,completed,evidence):(out.parent/'1.stdout').write_bytes(b'changed');return 0,out,err,completed
  self.assertEqual(self.run_fixture(mutate=changed)[3],'CUSTODY_REJECTED')

 def test_source_changes_and_expired_deadline_prevent_launch(self):
  count=0
  def source():
   nonlocal count
   count+=1;return [],{'pin':'fixed' if count==1 else 'changed'}
  result,evidence,calls,error=self.run_fixture(source=source);self.assertEqual(error,'SOURCE_CHANGED');self.assertEqual(calls,[])
  ticks=iter([0,731]);result,evidence,calls,error=self.run_fixture(clock=lambda:next(ticks));self.assertEqual(error,'PROCESS_BOUND');self.assertEqual(calls,[])

 def test_source_checks_after_native_and_zero_session_steps(self):
  for threshold in (3,4):
   count=0
   def source():
    nonlocal count
    count+=1;return [],{'pin':'changed' if count>=threshold else 'fixed'}
   result,evidence,calls,error=self.run_fixture(source=source);self.assertEqual(error,'SOURCE_CHANGED');self.assertEqual(len(calls),threshold-2)

 def test_remaining_outer_budget_bounds_native_and_rejects_late_finish(self):
  ticks=iter([0,725,725,731]);result,evidence,calls,error=self.run_fixture(clock=lambda:next(ticks));self.assertEqual(error,'PROCESS_BOUND');self.assertEqual(calls[0][3],5);self.assertEqual(len(calls),1)

 def test_exact_source_inventory_and_each_missing_leaf_file(self):
  names=(m.NATIVE,m.NATIVE_TEST,'scripts/run-field-publication-duplicate-tests.py','scripts/run-field-publication-duplicate-tests-test.py')
  for absent in names:
   with tempfile.TemporaryDirectory() as folder:
    root=pathlib.Path(folder)
    for name in names:
     path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
    with patch.object(m,'ROOT',root),patch.object(m.base,'sources',side_effect=lambda:([],{'candidate':'unchanged-pin'})):
     _,pins=m.sources();self.assertEqual(set(pins),{'candidate',*names});self.assertEqual(pins['candidate'],'unchanged-pin')
     path=root/absent;path.write_bytes(b'changed');self.assertNotEqual(m.sources()[1][absent],pins[absent]);path.unlink()
     with self.assertRaises((m.Failure,OSError)):m.sources()

if __name__=='__main__':unittest.main()
