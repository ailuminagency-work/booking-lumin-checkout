"""Independent inert orchestration tests. No subprocess or database invocation."""
import hashlib, importlib.util, json, pathlib, tempfile, unittest, uuid
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('publication_candidate',pathlib.Path(__file__).with_name('run-field-publication-candidate-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_own_approval_precedes_base_configuration(self):
  for values in ({},{'FIELD_JOURNEY_V3_RUNNER_APPROVED':'1'},{'FIELD_PUBLICATION_CANDIDATE_APPROVED':'true'}):
   with patch.dict(m.os.environ,values,clear=True),patch.object(m.base,'configuration') as delegate:
    with self.assertRaises(m.Failure):m.configuration('local','public')
    delegate.assert_not_called()
  with patch.dict(m.os.environ,{'FIELD_PUBLICATION_CANDIDATE_APPROVED':'1'},clear=True),patch.object(m.base,'configuration',return_value=('tools','env')) as delegate:
   self.assertEqual(m.configuration('local','extensions'),('tools','env'));delegate.assert_called_once_with('local','extensions')

 def test_base_approval_cannot_be_skipped(self):
  with patch.dict(m.os.environ,{'FIELD_PUBLICATION_CANDIDATE_APPROVED':'1'},clear=True):
   with self.assertRaises(m.Failure):m.configuration('local','public')

 def fixture(self,private,result,evidence,prior_steps=53):
  def prior(*args,**kwargs):
   args[3]['steps']=prior_steps
   for index in range(1,prior_steps+1):
    for suffix in ('stdout','stderr'):
     path=private/f'{index}.{suffix}';path.write_bytes(b'');kwargs['evidence'][path.name]=m.legacy.snapshot(path)
  return prior

 def run_fixture(self,*,mutate=None,prior_steps=53,source=None,clock=lambda:0):
  with tempfile.TemporaryDirectory() as folder:
   private=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};calls=[]
   def runner(args,cwd,env,target,index,seconds,maximum):
    calls.append((args,index,seconds,maximum))
    out=target/f'{index}.stdout';err=target/f'{index}.stderr';out.write_bytes(b'0\n' if index==56 else b'fixture completed\n');err.write_bytes(b'')
    completed={out.name:m.legacy.snapshot(out),err.name:m.legacy.snapshot(err)}
    if mutate:return mutate(index,out,err,completed,evidence)
    return 0,out,err,completed
   try:
    with patch.object(m.base,'execute',self.fixture(private,result,evidence,prior_steps)):
     m.execute('local','public',private,result,{'psql':'fixed-psql'},{'PGHOST':'127.0.0.1','PGPASSWORD':''},runner=runner,clock=clock,source_check=source or (lambda:([],{'pin':'fixed'})),evidence=evidence)
   except m.Failure as error:
    return result,evidence,calls,error.args[0]
   return result,evidence,calls,None

 def test_exact_56_steps_fresh_database_and_bounded_commands(self):
  result,evidence,calls,error=self.run_fixture();self.assertIsNone(error)
  self.assertEqual(result['steps'],56);self.assertEqual(len(evidence),112);self.assertEqual(len(evidence)+1,113)
  database='lumin_text_draft_'+uuid.UUID(result['runId']).hex
  self.assertEqual([call[1] for call in calls],[54,55,56])
  for args,index,seconds,maximum in calls:
   self.assertEqual(args[:6],['fixed-psql','-X','-w','-v','ON_ERROR_STOP=1','-d']);self.assertEqual(args[6],'postgres' if index==56 else database)
   self.assertGreater(seconds,0);self.assertLessEqual(seconds,30);self.assertEqual(maximum,128 if index==56 else m.legacy.LIMIT)
  self.assertEqual(calls[0][0][-2:],['-f',str(m.ROOT/m.CANDIDATE)]);self.assertEqual(calls[1][0][-2:],['-f',str(m.ROOT/m.FIXTURE)])
  self.assertIn(database,calls[2][0][-1]);self.assertEqual(result['sourceDigest'],hashlib.sha256(json.dumps({'pin':'fixed'},sort_keys=True,separators=(',',':')).encode()).hexdigest())

 def test_all_prior_steps_required_before_candidate(self):
  for steps in (0,52,54):
   result,evidence,calls,error=self.run_fixture(prior_steps=steps);self.assertEqual(error,'RECEIPT_REJECTED');self.assertEqual(calls,[])

 def test_sql_failure_retains_current_and_prior_evidence(self):
  def fail(index,out,err,completed,evidence):return 1,out,err,completed
  result,evidence,calls,error=self.run_fixture(mutate=fail);self.assertEqual(error,'SQL_FAILED');self.assertEqual(len(evidence),108);self.assertEqual(len(calls),1)

 def test_process_failure_attaches_captured_evidence(self):
  def fail(index,out,err,completed,evidence):
   error=m.Failure('PROCESS_BOUND');error.artifacts=completed;raise error
  result,evidence,calls,error=self.run_fixture(mutate=fail);self.assertEqual(error,'PROCESS_BOUND');self.assertIn('54.stderr',evidence);self.assertEqual(len(calls),1)

 def test_nonempty_stderr_rejected_even_with_zero_exit(self):
  def fail(index,out,err,completed,evidence):
   err.write_bytes(b'warning');completed[err.name]=m.legacy.snapshot(err);return 0,out,err,completed
  self.assertEqual(self.run_fixture(mutate=fail)[3],'RECEIPT_REJECTED')

 def test_zero_session_result_must_be_exact(self):
  for output in (b'1\n',b'',b'00\n',b' 0\n',b'0\nextra',b'0'):
   def fail(index,out,err,completed,evidence):
    if index==56:out.write_bytes(output);completed[out.name]=m.legacy.snapshot(out)
    return 0,out,err,completed
   self.assertEqual(self.run_fixture(mutate=fail)[3],'CLEANUP_UNOBSERVED')
  def crlf(index,out,err,completed,evidence):
   if index==56:out.write_bytes(b'0\r\n');completed[out.name]=m.legacy.snapshot(out)
   return 0,out,err,completed
  self.assertIsNone(self.run_fixture(mutate=crlf)[3])

 def test_wrong_artifact_names_or_changed_prior_stream_reject(self):
  def wrong(index,out,err,completed,evidence):return 0,out,err,{'other.stdout':completed[out.name],err.name:completed[err.name]}
  self.assertEqual(self.run_fixture(mutate=wrong)[3],'CUSTODY_REJECTED')
  def tamper(index,out,err,completed,evidence):
   (out.parent/'1.stdout').write_bytes(b'changed');return 0,out,err,completed
  self.assertEqual(self.run_fixture(mutate=tamper)[3],'CUSTODY_REJECTED')

 def test_source_changes_before_and_after_candidate_are_rejected(self):
  for threshold in (2,3,5):
   count=0
   def source():
    nonlocal count
    count+=1;return [],{'pin':'changed' if count>=threshold else 'fixed'}
   result,evidence,calls,error=self.run_fixture(source=source);self.assertEqual(error,'SOURCE_CHANGED');self.assertEqual(len(calls),threshold-2)

 def test_total_deadline_prevents_launch_and_bounds_remaining_time(self):
  ticks=iter([0,611]);self.assertEqual(self.run_fixture(clock=lambda:next(ticks))[3],'PROCESS_BOUND')
  ticks=iter([0,600,600,611]);result,evidence,calls,error=self.run_fixture(clock=lambda:next(ticks));self.assertEqual(error,'PROCESS_BOUND');self.assertEqual(calls[0][2],10)

 def test_inventory_pins_candidate_fixture_runner_and_inert_tests(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);names=(m.CANDIDATE,m.FIXTURE,'scripts/run-field-publication-candidate-tests.py','scripts/run-field-publication-candidate-tests-test.py')
   for name in names:
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
   with patch.object(m,'ROOT',root),patch.object(m.base,'sources',side_effect=lambda:([],{'base':'pin'})):
    _,pins=m.sources();self.assertEqual(set(pins),{'base',*names})
    for name in names:
     path=root/name;path.write_bytes(b'changed');self.assertNotEqual(m.sources()[1][name],pins[name]);path.write_bytes(b'fixture')
    (root/m.CANDIDATE).unlink()
    with self.assertRaises((m.Failure,OSError)):m.sources()

if __name__=='__main__':unittest.main()
