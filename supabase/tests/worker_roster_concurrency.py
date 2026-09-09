"""Synthetic local database: two actual transactions contend on roster CAS."""
import os,subprocess,time,uuid
if os.environ.get('WORKER_ROSTER_TEST_DISPOSABLE')!='1' or os.environ.get('PGHOST') not in ('127.0.0.1','localhost') or not os.environ.get('PGDATABASE','').startswith('lumin_'):
 raise SystemExit('Explicit disposable local lumin_ database required')
args=[os.environ.get('PSQL_BIN','psql'),'-X','-qAt','-v','ON_ERROR_STOP=1']
def sql(q):
 r=subprocess.run(args+['-c',q],text=True,capture_output=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
a,t,w1,w2=[str(uuid.uuid4()) for _ in range(4)];app='roster-cas-'+uuid.uuid4().hex;processes=[];created=False
try:
 sql(f"begin;insert into auth.users(id,email) values('{a}','{a}@test.invalid');insert into public.tenants(id,name,slug,timezone,currency) values('{t}','Synthetic','{t}','UTC','USD');insert into public.tenant_members values('{t}','{a}','BUSINESS_OWNER',now());commit;")
 created=True
 sql(f"set role service_role;select public.roster_provision('{a}','{t}');")
 first=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(first)
 first.stdin.write(f"begin;set application_name='{app}';set local role service_role;select public.roster_worker_put('{a}','{t}',1,'{w1}','Winner',true,true);select pg_sleep(2);\n");first.stdin.flush()
 def wait(q,label):
  end=time.monotonic()+10
  while sql(q)!='1':
   if any(p.poll() is not None for p in processes):raise AssertionError('Early process exit '+label)
   if time.monotonic()>end:raise AssertionError('Observation timeout '+label)
   time.sleep(.025)
 wait(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event='PgSleep'",'holder')
 second=subprocess.Popen(args+['-c',f"begin;set application_name='{app}-wait';set local role service_role;select public.roster_worker_put('{a}','{t}',1,'{w2}','Loser',true,true);commit;"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(second)
 wait(f"select count(*) from pg_stat_activity where application_name='{app}-wait' and wait_event='transactionid'",'CAS waiter')
 first.stdin.write('commit;\n\\q\n');first.stdin.flush();_,e=first.communicate(timeout=10);assert first.returncode==0,e
 _,e=second.communicate(timeout=10);assert second.returncode!=0 and 'ROSTER_CONFLICT' in e,e
 assert sql(f"select version=2 and (select count(*) from public.workers where tenant_id='{t}')=1 from public.worker_roster_state where tenant_id='{t}'")=='t'
finally:
 errors=[]
 for p in processes:
  try:
   if p.poll() is None:p.kill()
   p.communicate(timeout=5)
  except (OSError,subprocess.TimeoutExpired) as e:errors.append(type(e).__name__)
 if created:
  try:sql(f"begin;delete from public.tenants where id='{t}' and slug='{t}';delete from auth.users where id='{a}';commit;")
  except Exception as e:errors.append(type(e).__name__)
 if errors:raise RuntimeError('Cleanup failed: '+','.join(errors))
print('WORKER ROSTER CONCURRENCY PASS: observed row-lock CAS conflict, one committed mutation')
