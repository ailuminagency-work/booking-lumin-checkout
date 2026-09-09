#!/usr/bin/env python3
"""Observed-lock races in an explicitly disposable local PostgreSQL database.
Cleanup disables only the policy immutability trigger in a transaction for exact
random fixture tenants, then restores it; never an application capability.
"""
import json,os,subprocess,time,uuid
if os.environ.get('PLANNING_POLICY_TEST_DISPOSABLE')!='1' or os.environ.get('PGHOST') not in ('localhost','127.0.0.1') or not os.environ.get('PGDATABASE'):
 raise SystemExit('Explicit disposable local PostgreSQL required')
BASE=[os.environ.get('PSQL_BIN','psql'),'-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 p=subprocess.run(BASE,input=sql,text=True,capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
def wait(query,processes):
 end=time.monotonic()+10
 while run(query)!='t':
  if any(p.poll() is not None for p in processes):raise AssertionError([p.communicate() for p in processes])
  if time.monotonic()>end:raise AssertionError('Observed lock barrier timeout')
  time.sleep(.025)
for case in ('reserve-first','policy-first-reserve','booking-first','policy-first-booking','inverted-booking'):
 actor,tenant,service,booking,newbooking=[str(uuid.uuid4()) for _ in range(5)]
 app1='planning-'+uuid.uuid4().hex;app2='planning-'+uuid.uuid4().hex
 first=second=None
 try:
  run(f"""begin;insert into auth.users(id,email) values('{actor}','{actor}@example.test');
  insert into public.tenants(id,name,slug,timezone,currency) values('{tenant}','Planning','{tenant}','UTC','USD');
  insert into public.tenant_members(tenant_id,user_id,role) values('{tenant}','{actor}','BUSINESS_OWNER');
  insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('{service}','{tenant}','simple','Planning','USD',0);
  insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,idempotency_key) values('{booking}','{tenant}','{booking}','draft','{{"serviceId":"{service}"}}','{{}}','2099-01-01T10:00Z','2099-01-01T11:00Z','{booking}');commit;""")
  policy=f"select public.save_allocation_policy('{actor}','{tenant}','{service}',0,0,0,120,'none');"
  reserve=f"select * from public.reserve_capacity('{tenant}','{service}','2099-01-01T10:00Z','2099-01-01T11:00Z','{booking}',1,interval '5 minutes');"
  consumer=f"insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,idempotency_key) values('{newbooking}','{tenant}','{newbooking}','confirmed','{{\"serviceId\":\"{{{service.upper()}}}\"}}','{{}}','2099-01-01T10:00Z','2099-01-01T11:00Z','{newbooking}');"
  if case=='reserve-first':a,b=reserve,policy
  elif case=='policy-first-reserve':a,b=policy,reserve
  elif case=='booking-first':a,b=consumer,policy
  elif case=='policy-first-booking':a,b=policy,consumer
  else:a,b='lock table public.bookings in row exclusive mode;',policy
  trailer=consumer if case=='inverted-booking' else ''
  first=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  first.stdin.write(f"set application_name='{app1}';begin;set local role service_role;{a}select pg_sleep(2);{trailer}commit;");first.stdin.close();first.stdin=None
  wait(f"select exists(select 1 from pg_stat_activity where application_name='{app1}' and wait_event='PgSleep')",[first])
  # Sentinel proves a losing transaction does not retain preceding writes.
  sentinel=f"insert into public.customers(tenant_id,name,email) values('{tenant}','Sentinel','{actor}@sentinel.test');"
  second=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  second.stdin.write(f"set application_name='{app2}';begin;set local role service_role;{sentinel}{b}commit;");second.stdin.close();second.stdin=None
  wait(f"select exists(select 1 from pg_stat_activity where application_name='{app2}' and wait_event_type='Lock')",[first,second])
  out1,err1=first.communicate(timeout=15);out2,err2=second.communicate(timeout=15)
  if case!='inverted-booking':assert first.returncode==0 and second.returncode!=0,(case,err1,err2)
  else:assert (first.returncode==0)!=(second.returncode==0),(err1,err2)
  counts=json.loads(run(f"select json_build_object('policies',(select count(*) from public.allocation_policies where tenant_id='{tenant}'),'holds',(select count(*) from public.capacity_holds where tenant_id='{tenant}' and status='active'),'consumers',(select count(*) from public.bookings where tenant_id='{tenant}' and state='confirmed'),'sentinel',(select count(*) from public.customers where tenant_id='{tenant}'))"))
  assert not(counts['policies'] and (counts['holds'] or counts['consumers'])),(case,counts)
  assert counts['sentinel']==(1 if second.returncode==0 else 0),(case,counts)
  assert counts['policies']+counts['holds']+counts['consumers']==1,(case,counts)
  print('PASS',case,'observed Lock, exclusive safe outcome and full loser rollback')
 finally:
  for p in (first,second):
   if p is not None and p.poll() is None:p.kill();p.communicate()
  run(f"""begin;alter table public.allocation_policies disable trigger allocation_policy_identity;
  delete from public.allocation_policies where tenant_id='{tenant}';
  alter table public.allocation_policies enable trigger allocation_policy_identity;
  delete from public.capacity_holds where tenant_id='{tenant}';delete from public.bookings where tenant_id='{tenant}';
  delete from public.customers where tenant_id='{tenant}';delete from public.services where tenant_id='{tenant}';
  delete from public.tenant_members where tenant_id='{tenant}';delete from public.tenants where id='{tenant}';delete from auth.users where id='{actor}';commit;""")
