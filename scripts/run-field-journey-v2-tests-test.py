"""Inert supervisor contract tests; no process or database is launched."""
import importlib.util,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('journey',pathlib.Path(__file__).with_name('run-field-journey-v2-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def receipt(self):return {'schemaVersion':1,'kind':'FIELD_V2_SQL_BROWSER','status':'passed','category':'COMPLETE','cases':6,'browserClosed':True,'serversClosed':True,'connectionsClosed':True}
 def test_receipt_exact(self):
  value=self.receipt();raw=lambda x:(json.dumps(x,separators=(',',':'))+'\n').encode()
  self.assertEqual(m.journey_receipt(raw(value)),value)
  for key,bad in [('cases',True),('cases',5),('browserClosed',False),('serversClosed',False),('connectionsClosed',False),('category','FAILED'),('status','failed')]:
   with self.assertRaises(m.Failure):m.journey_receipt(raw({**value,key:bad}))
  with self.assertRaises(m.Failure):m.journey_receipt(raw({**value,'extra':1}))
 def test_approval_before_base(self):
  with patch.dict(m.os.environ,{},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('local','public')
   call.assert_not_called()
 def test_fresh_database_and_bounded_step(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};seen=[]
   def prior(*args,**kwargs):args[3]['steps']=47
   def runner(args,cwd,env,private,index,seconds,maximum):
    seen.append((args,env,index,seconds,maximum));out=private/'48.stdout';err=private/'48.stderr';out.write_bytes((json.dumps(self.receipt(),separators=(',',':'))+'\n').encode());err.write_bytes(b'')
    return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior):m.execute('local','public',root,result,{'node':'node'},{'PGPASSWORD':'','PGHOST':'wrong'},runner=runner,source_check=lambda:([],{'pin':'fixed'}),evidence=evidence)
   self.assertEqual(result['steps'],48);env=seen[0][1];self.assertEqual(env['TEXT_DRAFT_HTTP_DATABASE'],'lumin_text_draft_'+uuid.UUID(result['runId']).hex);self.assertNotIn('PGHOST',env);self.assertEqual(env['FIELD_JOURNEY_V2_APPROVED'],'1');self.assertLessEqual(seen[0][3],240);self.assertEqual(len(evidence),2)
 def test_rejects_nonlocal_before_base(self):
  with patch.dict(m.os.environ,{'FIELD_JOURNEY_V2_RUNNER_APPROVED':'1'},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('github-ci','public')
   call.assert_not_called()
 def test_requires_all_47_prior_steps(self):
  with tempfile.TemporaryDirectory() as folder:
   result={'steps':0,'runId':str(uuid.uuid4())}
   def prior(*args,**kwargs):args[3]['steps']=46
   with patch.object(m.base,'execute',prior),patch.object(m,'sources') as unused:
    with self.assertRaises(m.Failure):m.execute('local','public',pathlib.Path(folder),result,{'node':'node'},{'PGPASSWORD':''},runner=lambda *a:self.fail('must not launch'),source_check=lambda:([],{'pin':'fixed'}))
 def test_source_change_and_expired_deadline_prevent_launch(self):
  with tempfile.TemporaryDirectory() as folder:
   def prior(*args,**kwargs):args[3]['steps']=47
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
   def prior(*args,**kwargs):args[3]['steps']=47
   def runner(args,cwd,env,private,index,seconds,maximum):
    out=private/'48.stdout';err=private/'48.stderr';out.write_bytes(b'');err.write_bytes(b'finite failure')
    return 1,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior),self.assertRaises(m.Failure):m.execute('local','public',root,{'steps':0,'runId':str(uuid.uuid4())},{'node':'node'},{'PGPASSWORD':''},runner=runner,source_check=lambda:([],{'pin':'fixed'}),evidence=evidence)
   self.assertEqual(set(evidence),{'48.stdout','48.stderr'})
if __name__=='__main__':unittest.main()
