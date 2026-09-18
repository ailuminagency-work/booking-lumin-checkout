"""Inert runner verification: no database or child process."""
import importlib.util,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('v2runner',pathlib.Path(__file__).with_name('run-field-draft-v2-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V2_CONCURRENCY','status':'passed','category':'COMPLETE','cases':14,'parityCases':32,'connectionsClosed':True}
def raw(v):return (json.dumps(v,separators=(',',':'))+'\n').encode()
class Tests(unittest.TestCase):
 def test_exact_receipt(self):
  self.assertEqual(m.receipt(raw(value())),value())
  for key,bad in [('cases',True),('cases',13),('parityCases',31),('connectionsClosed',False),('category','FAILED')]:
   with self.assertRaises(m.Failure):m.receipt(raw({**value(),key:bad}))
  with self.assertRaises(m.Failure):m.receipt(raw({**value(),'extra':'private'}))
  with self.assertRaises(m.Failure):m.receipt(json.dumps(value()).encode())
 def test_approval(self):
  with patch.dict(m.os.environ,{},clear=True),patch.object(m.base,'configuration') as call:
   with self.assertRaises(m.Failure):m.configuration('local','public')
   call.assert_not_called()
 def run_fixture(self,code=0,stderr=b'',mutate=False):
  with tempfile.TemporaryDirectory() as folder:
   private=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};calls=[];pin={'fixed':'pin'}
   def prior(*args,**kwargs):
    seed=[];kwargs['before_migration'](pathlib.Path('0033_text_field_prompts.sql'),lambda *a:seed.append(a));self.assertEqual(seed,[])
    kwargs['before_migration'](pathlib.Path('0034_field_drafts_v2.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),1);self.assertTrue(seed[0][-1].endswith('field_drafts_v2_upgrade_fixture.sql'))
    kwargs['after_migration'](pathlib.Path('0033_text_field_prompts.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),1)
    kwargs['after_migration'](pathlib.Path('0034_field_drafts_v2.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),2);self.assertTrue(seed[1][-1].endswith('field_drafts_v2_tests.sql'));args[3]['steps']=44
   def runner(args,cwd,env,where,index,seconds,maximum):
    calls.append((args,env,index,seconds,maximum));out=where/(str(index)+'.stdout');err=where/(str(index)+'.stderr')
    out.write_bytes(raw(value()) if index==45 else b'');err.write_bytes(stderr if index==45 else b'')
    if mutate and index==45:pin['fixed']='changed'
    return code if index==45 else 0,out,err,{out.name:m.base.snapshot(out),err.name:m.base.snapshot(err)}
   with patch.object(m.base,'execute',prior):
    m.execute('local','extensions',private,result,{'node':'node','psql':'psql'},{'PGPASSWORD':'','PGHOST':'wrong'},runner=runner,source_check=lambda:([],dict(pin)),evidence=evidence)
   self.assertEqual(result['steps'],45);self.assertEqual(len(evidence),2)
   env=calls[0][1];self.assertNotIn('PGHOST',env);self.assertEqual(env['FIELD_DRAFT_V2_CONCURRENCY_APPROVED'],'1');self.assertEqual(env['TEXT_DRAFT_TEST_LAYOUT'],'extensions')
   self.assertEqual(env['TEXT_DRAFT_CONCURRENCY_DATABASE'],'lumin_text_draft_'+uuid.UUID(result['runId']).hex);self.assertLessEqual(calls[0][3],95)
 def test_bound_order_and_environment(self):self.run_fixture()
 def test_nonzero_and_stderr_rejected(self):
  for kwargs in [{'code':1},{'stderr':b'private'}]:
   with self.assertRaises(m.Failure):self.run_fixture(**kwargs)
 def test_source_change_rejected(self):
  with self.assertRaises(m.Failure):self.run_fixture(mutate=True)
if __name__=='__main__':unittest.main()
