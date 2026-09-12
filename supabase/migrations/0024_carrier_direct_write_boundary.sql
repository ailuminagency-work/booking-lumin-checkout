-- Direct-DML prerequisite only. Existing definer RPCs and parent cascades remain;
-- this does not establish a group lifecycle, allocation, or confirmation boundary.
begin;
do $$
declare carrier regclass; api_role text; role_id oid;
begin
 foreach api_role in array array['anon','authenticated','service_role'] loop
  select oid into role_id from pg_roles where rolname=api_role;
  if role_id is null or exists(select 1 from pg_roles where oid=role_id and (rolsuper or rolcreaterole))
   or exists(select 1 from pg_auth_members where member=role_id) then
   -- Reject even NOINHERIT memberships: SET ROLE can still expose authority.
   raise exception 'CARRIER_UNSUPPORTED_ROLE_TOPOLOGY' using errcode='55000';
  end if;
 end loop;
 foreach carrier in array array['public.capacity_holds'::regclass,'public.resource_reservations'::regclass] loop
  if not exists(select 1 from pg_class where oid=carrier and relkind='r' and relrowsecurity and relforcerowsecurity)
   or exists(select 1 from pg_inherits where inhparent=carrier or inhrelid=carrier)
   or exists(select 1 from pg_class c join pg_roles r on r.oid=c.relowner where c.oid=carrier and r.rolname in ('anon','authenticated','service_role')) then
   raise exception 'CARRIER_UNSUPPORTED_TABLE_TOPOLOGY' using errcode='55000';
  end if;
  -- Column ACLs are separate from table ACLs. Do not silently leave a write path
  -- or alter custom grants. No CASCADE/global membership/default-ACL changes.
  if exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid=carrier and (x.grantee=0 or x.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role'))))
   or exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) x
   where c.oid=carrier and x.is_grantable and (x.grantee=0 or x.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))) then
   raise exception 'CARRIER_UNSUPPORTED_GRANT_TOPOLOGY' using errcode='55000';
  end if;
 end loop;
end $$;
-- ALL includes the server version's supported table verbs (including MAINTAIN
-- on newer PostgreSQL); no unsupported privilege literal is used on PG16.
revoke all on public.capacity_holds,public.resource_reservations from public,anon,authenticated,service_role;
grant select on public.capacity_holds,public.resource_reservations to service_role;
do $$
declare carrier regclass; api_role text; privilege_name text;
begin
 foreach carrier in array array['public.capacity_holds'::regclass,'public.resource_reservations'::regclass] loop
  foreach api_role in array array['anon','authenticated','service_role'] loop
   for privilege_name in select privilege_type from aclexplode(acldefault('r',(select oid from pg_roles where rolname=current_user))) loop
    if privilege_name='SELECT' then
     if has_table_privilege(api_role,carrier,'SELECT') is distinct from (api_role='service_role') then
      raise exception 'CARRIER_PRIVILEGE_POSTCONDITION' using errcode='55000';
     end if;
    elsif has_table_privilege(api_role,carrier,privilege_name) then
     raise exception 'CARRIER_PRIVILEGE_POSTCONDITION' using errcode='55000';
    end if;
    if has_table_privilege(api_role,carrier,privilege_name||' WITH GRANT OPTION') then
     raise exception 'CARRIER_PRIVILEGE_POSTCONDITION' using errcode='55000';
    end if;
   end loop;
   if has_any_column_privilege(api_role,carrier,'INSERT,UPDATE,REFERENCES')
    or (api_role<>'service_role' and has_any_column_privilege(api_role,carrier,'SELECT')) then
    raise exception 'CARRIER_PRIVILEGE_POSTCONDITION' using errcode='55000';
   end if;
  end loop;
 end loop;
end $$;
commit;
