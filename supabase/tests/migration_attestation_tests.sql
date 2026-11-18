-- Disposable PostgreSQL contract checks for migration 0100.
-- The authenticated HTTP reader has additional forged/stale-row coverage in
-- apps/api/src/migration-attestation.test.ts; this SQL suite proves the
-- checked-in migration ran against the complete disposable chain and that
-- its core schema contract is present.
do $$
declare
 actual_head text;
 actual_evidence text;
 missing text[];
begin
 select migration_head,evidence
   into actual_head,actual_evidence
   from public.booking_lumin_schema_attestation
  where id=true;
 if actual_head is distinct from '0100_security_advisor_hardening' then
  raise exception 'MIGRATION_ATTESTATION_HEAD_MISMATCH';
 end if;
 if actual_evidence is distinct from 'core_schema_contract' then
  raise exception 'MIGRATION_ATTESTATION_EVIDENCE_MISMATCH';
 end if;
 select array_agg(name order by name) into missing
 from (values
  ('public.tenants',to_regclass('public.tenants') is not null),
  ('public.services',to_regclass('public.services') is not null),
  ('public.bookings',to_regclass('public.bookings') is not null),
  ('public.payments',to_regclass('public.payments') is not null),
  ('public.availability_rules',to_regclass('public.availability_rules') is not null),
  ('public.availability_overrides',to_regclass('public.availability_overrides') is not null),
  ('public.capacity_holds',to_regclass('public.capacity_holds') is not null),
  ('public.resources',to_regclass('public.resources') is not null),
  ('public.resource_reservations',to_regclass('public.resource_reservations') is not null),
  ('public.confirm_succeeded_payment(uuid)',to_regprocedure('public.confirm_succeeded_payment(uuid)') is not null)
 ) required(name,present)
 where not present;
 if missing is not null then
  raise exception 'MIGRATION_ATTESTATION_SCHEMA_MISMATCH: %',array_to_string(missing,',');
 end if;
end
$$;

\echo PASS migration attestation head, evidence contract, and core schema contract
