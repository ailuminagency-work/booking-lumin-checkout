"""Inert supervisor contract tests; no process or database is launched."""
import importlib.util,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('journey',pathlib.Path(__file__).with_name('run-text-journey-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def receipt(self):return {'schemaVersion':1,'kind':'TEXT_SQL_BROWSER','status':'passed','category':'COMPLETE','cases':6,'browserClosed':True,'serversClosed':True,'connectionsClosed':True}
 def test_receipt_exact(self):
  value=self.receipt();raw=lambda x:(json.dumps(x,separators=(',',':'))+'\n').encode()
  self.assertEqual(m.journey_receipt(raw(value)),value)
  for key,bad in [('cases',True),('cases',5),('browserClosed',False),('category','FAILED')]:
   with self.assertRaises(m.Failure):m.journey_receipt(raw({**value,key:bad}))
  with self.assertRaises(m.Failure):m.journey_receipt(raw({**value,'extra':1}))
 def test_approval_before_base(self):
  with patch.dict(m.os.environ,{},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('local','public')
   call.assert_not_called()
 def test_fresh_database_and_bounded_step(self):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};seen=[]
   def prior(*args,**kwargs):args[3]['steps']=42
   def runner(args,cwd,env,private,index,seconds,maximum):
    seen.append((args,env,index,seconds,maximum));out=private/'43.stdout';err=private/'43.stderr';out.write_bytes((json.dumps(self.receipt(),separators=(',',':'))+'\n').encode());err.write_bytes(b'')
    return 0,out,err,{out.name:m.snapshot(out),err.name:m.snapshot(err)}
   with patch.object(m.base,'execute',prior):m.execute('local','public',root,result,{'node':'node'},{'PGPASSWORD':'','PGHOST':'wrong'},runner=runner,source_check=lambda:([],{'pin':'fixed'}),evidence=evidence)
   self.assertEqual(result['steps'],43);env=seen[0][1];self.assertEqual(env['TEXT_DRAFT_HTTP_DATABASE'],'lumin_text_draft_'+uuid.UUID(result['runId']).hex);self.assertNotIn('PGHOST',env);self.assertEqual(env['TEXT_JOURNEY_APPROVED'],'1');self.assertLessEqual(seen[0][3],120);self.assertEqual(len(evidence),2)
if __name__=='__main__':unittest.main()
