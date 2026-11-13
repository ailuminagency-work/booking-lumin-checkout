-- P1 step 6: a TEST-MODE Stripe connection is recorded under its own provider label.
--
-- The live label 'stripe_connect' is seeded everywhere by 0088, and a live connection
-- will carry it. A connection made with a TEST key must not carry it: a stored row has
-- to say which mode produced it, and a production database must not be able to record
-- a test-mode connection at all.
--
-- So the test label is declared the way 0088 declares the simulated labels: confirmable
-- only where the database name marks it disposable. Every hosted Supabase database --
-- staging and production alike -- is named 'postgres', so none declares it here. The
-- first live test-mode connection needs the deliberate bootstrap insert documented at
-- the foot of this file, which a person runs on hosted staging.
--
-- It is simulated in the sense SIMULATED_PROVIDERS means -- non-real money -- so it is
-- listed there (apps/api/src/simulated-payment-readiness.ts): a database that declares it
-- is one this service refuses to serve outside staging.

do $seed$
begin
  if current_database() ~ '^lumin_' then
    insert into public.confirmable_payment_providers (provider, note)
    values ('stripe_connect_test', 'Stripe Connect TEST-MODE connections; confirmable only on a disposable database')
    on conflict (provider) do nothing;
  end if;
end
$seed$;

-- HOSTED STAGING BOOTSTRAP. Not run by this migration. A person runs it once, on the
-- hosted STAGING database, before the first live test-mode connection. Until then a
-- hosted database refuses test-mode connections, which is the intended posture. It is
-- never run on production:
--
--   insert into public.confirmable_payment_providers (provider, note)
--   values ('stripe_connect_test', 'Stripe test-mode connections: staging bootstrap')
--   on conflict (provider) do nothing;
