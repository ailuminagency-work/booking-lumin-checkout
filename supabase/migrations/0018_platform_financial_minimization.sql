-- RISK-4: platform status alone must not grant raw merchant finance/audit access.
-- Additive policy correction; accepted migrations and all write authority stay intact.
-- Suspended/inactive tenants cannot read these raw rows even with membership.
-- Existing CC economics/booking definer aggregates retain their explicit admin gate.
-- Other platform metadata policies are out of scope and remain separately tracked.
begin;
drop policy "member_or_admin_select" on public.payments;
create policy "member_select" on public.payments for select to authenticated
 using (lumin.is_tenant_member(tenant_id) and lumin.tenant_is_active(tenant_id));
drop policy "member_or_admin_select" on public.refunds;
create policy "member_select" on public.refunds for select to authenticated
 using (lumin.is_tenant_member(tenant_id) and lumin.tenant_is_active(tenant_id));
drop policy "owner_or_admin_select" on public.audit_events;
create policy "owner_select" on public.audit_events for select to authenticated
 using (tenant_id is not null and lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER'
        and lumin.tenant_is_active(tenant_id));
commit;
