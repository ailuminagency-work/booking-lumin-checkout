"""Inert runner verification: no database or child process."""
import importlib.util,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('v2runner',pathlib.Path(__file__).with_name('run-field-draft-v3-tests.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V2_CONCURRENCY','status':'passed','category':'COMPLETE','cases':14,'parityCases':32,'connectionsClosed':True}
def repository_value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V2_REPOSITORY','status':'passed','category':'COMPLETE','cases':6,'connectionsClosed':True}
def http_value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V2_HTTP','status':'passed','category':'COMPLETE','cases':7,'httpRequests':27,'clientCases':4,'clientRequests':13,'serverClosed':True,'connectionsClosed':True}
def v3_value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V3_CONCURRENCY','status':'passed','category':'COMPLETE','cases':30,'parityCases':37,'connectionsClosed':True}

def v3_repository_value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V3_REPOSITORY','status':'passed','category':'COMPLETE','cases':7,'connectionsClosed':True}

def v3_http_value():return {'schemaVersion':1,'kind':'FIELD_DRAFT_V3_HTTP','status':'passed','category':'COMPLETE','cases':8,'httpRequests':29,'clientCases':4,'clientRequests':13,'serverClosed':True,'connectionsClosed':True}

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
 def test_repository_receipt(self):
  good=repository_value();kind=good['kind']
  self.assertEqual(m.receipt(raw(good),kind),good)
  bad=[b'',b'null',raw(value()),raw({**good,'cases':True}),raw({**good,'cases':5}),raw({**good,'connectionsClosed':False}),raw({**good,'extra':1}),raw(good).replace(b'"cases":6',b'"cases":6,"cases":6')]
  for payload in bad:
   with self.assertRaises(m.Failure):m.receipt(payload,kind)
 def test_http_receipt(self):
  good=http_value();kind=good['kind'];self.assertEqual(m.receipt(raw(good),kind),good)
  for key,bad in [('cases',True),('cases',6),('httpRequests',True),('httpRequests',0),('httpRequests',26),('httpRequests',28),('httpRequests',101),('httpRequests',1.5),('serverClosed',False),('connectionsClosed',False),('extra',1)]:
   with self.assertRaises(m.Failure):m.receipt(raw({**good,key:bad}),kind)
  for payload in [b'',raw(repository_value()),raw(good).replace(b'"cases":7',b'"cases":7,"cases":7')]:
   with self.assertRaises(m.Failure):m.receipt(payload,kind)
 def run_fixture(self,code=0,stderr=b'',mutate=False,target=48,payload=None,prior_steps=47,elapsed=0):
  with tempfile.TemporaryDirectory() as folder:
   private=pathlib.Path(folder);result={'steps':0,'runId':str(uuid.uuid4())};evidence={};calls=[];pin={'fixed':'pin'}
   def prior(*args,**kwargs):
    seed=[];kwargs['before_migration'](pathlib.Path('0033_text_field_prompts.sql'),lambda *a:seed.append(a));self.assertEqual(seed,[])
    kwargs['before_migration'](pathlib.Path('0034_field_drafts_v2.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),1);self.assertTrue(seed[0][-1].endswith('field_drafts_v2_upgrade_fixture.sql'))
    kwargs['after_migration'](pathlib.Path('0033_text_field_prompts.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),1)
    kwargs['after_migration'](pathlib.Path('0034_field_drafts_v2.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),2);self.assertTrue(seed[1][-1].endswith('field_drafts_v2_tests.sql'));kwargs['before_migration'](pathlib.Path('0035_field_drafts_v3.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),3);self.assertTrue(seed[2][-1].endswith('field_drafts_v3_upgrade_fixture.sql'));kwargs['after_migration'](pathlib.Path('0035_field_drafts_v3.sql'),lambda *a:seed.append(a));self.assertEqual(len(seed),4);self.assertTrue(seed[3][-1].endswith('field_drafts_v3_tests.sql'));args[3]['steps']=prior_steps
   def runner(args,cwd,env,where,index,seconds,maximum):
    calls.append((args,env,index,seconds,maximum));out=where/(str(index)+'.stdout');err=where/(str(index)+'.stderr')
    out.write_bytes(payload if payload is not None and index==target else raw(value() if index==48 else repository_value() if index==49 else http_value() if index==50 else v3_value() if index==51 else v3_repository_value() if index==52 else v3_http_value()));err.write_bytes(stderr if index==target else b'')
    if mutate and index==target:pin['fixed']='changed'
    return code if index==target else 0,out,err,{out.name:m.base.snapshot(out),err.name:m.base.snapshot(err)}
   with patch.object(m.base,'execute',prior):
    try:m.execute('local','extensions',private,result,{'node':'node','psql':'psql'},{'PGPASSWORD':'','PGHOST':'wrong'},runner=runner,clock=lambda:elapsed if len(calls)>=2 else 0,source_check=lambda:([],dict(pin)),evidence=evidence)
    except m.Failure:
     self.assertEqual(len(evidence),2*len(calls));m.base.verify_evidence(private,evidence)
     self.assertNotIn('sourceDigest',result)
     raise
   self.assertEqual(result['steps'],53);self.assertEqual(len(evidence),12)
   self.assertEqual([c[2] for c in calls],[48,49,50,51,52,53]);self.assertTrue(calls[1][0][-1].endswith('field-drafts-v2-repository.integration.ts'));self.assertTrue(calls[2][0][-1].endswith('field-drafts-v2-http.integration.ts'))
   env=calls[0][1];self.assertNotIn('PGHOST',env);self.assertEqual(env['FIELD_DRAFT_V2_CONCURRENCY_APPROVED'],'1');self.assertEqual(env['TEXT_DRAFT_TEST_LAYOUT'],'extensions')
   self.assertEqual(env['TEXT_DRAFT_CONCURRENCY_DATABASE'],'lumin_text_draft_'+uuid.UUID(result['runId']).hex);self.assertLessEqual(calls[0][3],95)
   self.assertNotIn('FIELD_DRAFT_V2_REPOSITORY_APPROVED',env)
   native=calls[1][1];self.assertEqual(native['FIELD_DRAFT_V2_REPOSITORY_APPROVED'],'1');self.assertEqual(native['TEXT_DRAFT_HTTP_DATABASE'],env['TEXT_DRAFT_CONCURRENCY_DATABASE']);self.assertLessEqual(calls[1][3],60)
   self.assertNotIn('FIELD_DRAFT_V2_HTTP_APPROVED',native)
   native_v3=calls[3][1];self.assertEqual(native_v3['FIELD_DRAFT_V3_CONCURRENCY_APPROVED'],'1');self.assertLessEqual(calls[3][3],min(95,510-elapsed));self.assertTrue(calls[3][0][-1].endswith('field-drafts-v3-concurrency.integration.ts'))
   repository_v3=calls[4][1];self.assertEqual(repository_v3['FIELD_DRAFT_V3_REPOSITORY_APPROVED'],'1');self.assertEqual(repository_v3['TEXT_DRAFT_HTTP_DATABASE'],native['TEXT_DRAFT_HTTP_DATABASE']);self.assertLessEqual(calls[4][3],min(60,510-elapsed));self.assertTrue(calls[4][0][-1].endswith('field-drafts-v3-repository.integration.ts'));self.assertNotIn('FIELD_DRAFT_V3_REPOSITORY_APPROVED',native_v3)
   http=calls[2][1];self.assertEqual(http['FIELD_DRAFT_V2_HTTP_APPROVED'],'1');self.assertEqual(http['TEXT_DRAFT_HTTP_DATABASE'],native['TEXT_DRAFT_HTTP_DATABASE']);self.assertLessEqual(calls[2][3],min(80,510-elapsed))
   http_v3=calls[5][1];self.assertEqual(http_v3['FIELD_DRAFT_V3_HTTP_APPROVED'],'1');self.assertNotIn('FIELD_DRAFT_V3_HTTP_APPROVED',repository_v3);self.assertEqual(http_v3['TEXT_DRAFT_HTTP_DATABASE'],native['TEXT_DRAFT_HTTP_DATABASE']);self.assertLessEqual(calls[5][3],min(80,510-elapsed));self.assertTrue(calls[5][0][-1].endswith('field-drafts-v3-http.integration.ts'))
 def test_bound_order_and_environment(self):self.run_fixture()
 def test_nonzero_and_stderr_rejected(self):
  for kwargs in [{'code':1},{'stderr':b'private'}]:
   with self.assertRaises(m.Failure):self.run_fixture(**kwargs)
 def test_source_change_rejected(self):
  with self.assertRaises(m.Failure):self.run_fixture(mutate=True)
 def test_repository_failures_retain_private_evidence(self):
  for kwargs in [{'code':1},{'stderr':b'private'},{'payload':b''},{'payload':raw({**repository_value(),'connectionsClosed':False})},{'mutate':True}]:
   with self.assertRaises(m.Failure):self.run_fixture(target=49,**kwargs)
 def test_missing_legacy_gate_rejected(self):
  with self.assertRaises(m.Failure):self.run_fixture(prior_steps=46)
 def test_http_failure_retains_evidence(self):
  for kwargs in [{'code':1},{'stderr':b'private'},{'payload':b''},{'payload':raw({**http_value(),'serverClosed':False})},{'mutate':True}]:
   with self.assertRaises(m.Failure):self.run_fixture(target=50,**kwargs)
 def test_total_deadline_constrains_http(self):
  self.run_fixture(elapsed=500)
  with self.assertRaises(m.Failure):self.run_fixture(elapsed=510)
 def test_exact_client_counts_and_legacy_receipt_rejection(self):
  good=http_value();kind=good['kind']
  for key in ['clientCases','clientRequests']:
   for bad in [True,0,good[key]-1,good[key]+1,float(good[key])]:
    with self.assertRaises(m.Failure):m.receipt(raw({**good,key:bad}),kind)
   with self.assertRaises(m.Failure):m.receipt(raw({k:v for k,v in good.items() if k!=key}),kind)
  legacy={k:v for k,v in good.items() if k not in ['clientCases','clientRequests']}
  with self.assertRaises(m.Failure):self.run_fixture(target=50,payload=raw(legacy))
  with self.assertRaises(m.Failure):self.run_fixture(target=50,payload=raw({**good,'clientRequests':12}))
  with self.assertRaises(m.Failure):self.run_fixture(target=50,payload=raw({**good,'connectionsClosed':False}))
 def test_v3_receipt_and_failures(self):
  good=v3_value();kind=good['kind'];self.assertEqual(m.receipt(raw(good),kind),good)
  for key,bad in [('cases',29),('cases',True),('parityCases',36),('connectionsClosed',False),('extra',1)]:
   with self.assertRaises(m.Failure):m.receipt(raw({**good,key:bad}),kind)
  for kwargs in [{'code':1},{'stderr':b'private'},{'payload':b''},{'payload':raw({**good,'connectionsClosed':False})},{'mutate':True}]:
   with self.assertRaises(m.Failure):self.run_fixture(target=51,**kwargs)
 def test_v3_repository_receipt_and_failures(self):
  good=v3_repository_value();kind=good['kind'];self.assertEqual(m.receipt(raw(good),kind),good)
  for key,bad in [('cases',6),('cases',8),('cases',True),('connectionsClosed',False),('extra',1)]:
   with self.assertRaises(m.Failure):m.receipt(raw({**good,key:bad}),kind)
  for payload in [b'',raw(repository_value()),raw(good).replace(b'"cases":7',b'"cases":7,"cases":7')]:
   with self.assertRaises(m.Failure):m.receipt(payload,kind)
  for kwargs in [{'code':1},{'stderr':b'private'},{'payload':b''},{'payload':raw({**good,'connectionsClosed':False})},{'mutate':True}]:
   with self.assertRaises(m.Failure):self.run_fixture(target=52,**kwargs)
 def test_v3_http_receipt_and_failures(self):
  good=v3_http_value();kind=good['kind'];self.assertEqual(m.receipt(raw(good),kind),good)
  for key,bad in [('cases',7),('cases',9),('cases',True),('httpRequests',28),('httpRequests',30),('httpRequests',True),('httpRequests',29.0),('serverClosed',False),('connectionsClosed',False),('serverClosed',1),('connectionsClosed',1),('extra',1)]:
   with self.assertRaises(m.Failure):m.receipt(raw({**good,key:bad}),kind)
  for payload in [b'',raw(http_value()),raw(good).replace(b'"cases":8',b'"cases":8,"cases":8')]:
   with self.assertRaises(m.Failure):m.receipt(payload,kind)
  for kwargs in [{'code':1},{'stderr':b'private'},{'payload':b''},{'payload':raw({**good,'connectionsClosed':False})},{'mutate':True}]:
   with self.assertRaises(m.Failure):self.run_fixture(target=53,**kwargs)
 def test_v3_exact_client_counts_and_closed_wire_schema(self):
  good=v3_http_value();kind=good['kind']
  self.assertEqual(m.receipt(raw(good),kind),good)
  for key in ['clientCases','clientRequests']:
   for bad in [True,False,0,good[key]-1,good[key]+1,float(good[key]),str(good[key]),None]:
    with self.subTest(key=key,bad=bad),self.assertRaises(m.Failure):m.receipt(raw({**good,key:bad}),kind)
   with self.assertRaises(m.Failure):m.receipt(raw({k:v for k,v in good.items() if k!=key}),kind)
  legacy={k:v for k,v in good.items() if k not in ['clientCases','clientRequests']}
  payloads=[raw(legacy),raw({**good,'clientCases':3}),raw({**good,'clientRequests':12}),raw({**good,'serverClosed':False}),raw({**good,'connectionsClosed':False}),raw({**good,'extra':None}),json.dumps(good).encode(),raw(good).rstrip(b'\n'),raw(good)+b'\n',raw(good).replace(b'"clientCases":4',b'"clientCases":4,"clientCases":4')]
  for payload in payloads:
   with self.subTest(payload_index=payloads.index(payload)),self.assertRaises(m.Failure):m.receipt(payload,kind)
   with self.assertRaises(m.Failure):self.run_fixture(target=53,payload=payload)
if __name__=='__main__':unittest.main()
