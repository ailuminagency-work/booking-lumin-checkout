-- 0092 single business per account.
--
-- PRODUCT INVARIANT, newly stated and previously unenforced: one Booking Lumin
-- account belongs to exactly ONE business. There is no business switcher and no
-- cross-business workspace. Even someone who owns two businesses must hold two
-- separate accounts.
--
-- Nothing enforced this. public.create_staging_business (declared 0044, re-declared
-- 0054) inserts a tenant_members row for the actor with no check that the actor
-- already belongs to a business, and no other guard exists anywhere in the chain
-- (no ALREADY_OWNS / one-business check in any migration). So a single account
-- could accumulate businesses by calling it repeatedly. Verified empirically: with
-- a candidate unique(user_id) imposed on a replayed chain, 7 of 62 CI suites fail,
-- every one of them because a production write path grants the same actor a second
-- business.
--
-- WHY A TRIGGER AND NOT A UNIQUE INDEX. A unique index on tenant_members(user_id)
-- is the obvious expression of the rule, but it cannot be applied here yet: the
-- isolated staging child already holds a pre-existing violating row (one account
-- with memberships in two businesses), so CREATE UNIQUE INDEX would fail outright
-- and the migration would be unappliable. A BEFORE trigger governs new writes and
-- leaves historical rows readable, which is what lets the rule start holding now
-- while remediation of existing data stays a separate, deliberate decision.
--   The index remains the right end state. public.accounts_in_multiple_businesses
-- below makes the remaining violations visible so they can be cleared first.
--
-- WHY ONE TRIGGER AND NOT A GUARD INSIDE THE RPC. The insert is what must be
-- refused, so refusing it at the table catches every path at once: the existing
-- create_staging_business, any direct service_role write, and any future RPC that
-- has not been written yet. Putting the check inside one function would protect
-- only that function, which is exactly how this gap arose.
--
-- PLATFORM ADMIN ISOLATION IS UNTOUCHED. Platform admins are public.platform_admins,
-- a separate table this migration does not read or write, and their reach comes from
-- lumin.is_platform_admin() rather than from membership. Nothing here grants an admin
-- anything, and nothing here requires an admin to hold a membership at all.
begin;

create or replace function lumin.enforce_single_business_membership()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $fn$
begin
  -- A membership in the SAME business is not a second business (and a duplicate is
  -- already refused by tenant_members_pkey). Only a DIFFERENT business is the breach.
  if exists (
    select 1 from public.tenant_members m
     where m.user_id = new.user_id
       and m.tenant_id <> new.tenant_id
  ) then
    raise exception 'ACCOUNT_ALREADY_HAS_BUSINESS'
      using errcode = '42501',
            detail  = format('account %s already belongs to a business; one Booking Lumin account belongs to exactly one business', new.user_id);
  end if;
  return new;
end
$fn$;

comment on function lumin.enforce_single_business_membership() is
 'Enforces the single-business account invariant: an account may hold at most one public.tenant_members row across all businesses. Refuses with ACCOUNT_ALREADY_HAS_BUSINESS (42501). Governs every write path, including create_staging_business and any direct service_role insert. Does not read or write public.platform_admins.';

-- BEFORE, so the breach is refused rather than recorded and rolled back. Fires on
-- the columns that can move an account between businesses; a role-only UPDATE is
-- untouched, so promoting or demoting a member still works.
drop trigger if exists tenant_members_single_business on public.tenant_members;
create trigger tenant_members_single_business
  before insert or update of user_id, tenant_id on public.tenant_members
  for each row execute function lumin.enforce_single_business_membership();

-- Remaining violations, for remediation before the unique index can be adopted.
-- Server-authoritative: no client role may read it (it names accounts and the
-- businesses they belong to across tenant boundaries, which is precisely what the
-- isolation rules forbid a tenant from seeing).
create or replace view public.accounts_in_multiple_businesses
  with (security_invoker = true) as
  select user_id, count(*) as business_count, array_agg(tenant_id order by tenant_id) as businesses
    from public.tenant_members
   group by user_id
  having count(*) > 1;

revoke all on public.accounts_in_multiple_businesses from public, anon, authenticated;
grant select on public.accounts_in_multiple_businesses to service_role;

comment on view public.accounts_in_multiple_businesses is
 'Accounts still holding memberships in more than one business -- pre-existing breaches of the single-business invariant that 0092 grandfathers rather than deletes. Must be empty before a unique index on tenant_members(user_id) can replace the trigger. security_invoker so it can never widen what the caller may read.';

commit;
