import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {businessOnboardingEnabled} from './business';
import {catalogAuthoringEnabled} from './owner-catalog';
import {schedulingAuthoringEnabled} from './owner-scheduling';
import {detailingPublicationEnabled} from './detailing-publication';
import {paidPublicationEnabled, ownerBookingOperationsEnabled, paymentConnectionVisibilityEnabled, paymentConnectionWriteEnabled} from './capability-flags';
import {mockPaymentsEnabled} from './mock-payment';

/**
 * Gap G1's safety net. The refactor made product capabilities production-legal;
 * these assertions are what stops that from also making simulated money
 * reachable outside staging.
 */

const CAPABILITIES: Array<[string, string, (e: Record<string, string | undefined>) => boolean]> = [
  ['BOOKING_LUMIN_BUSINESS_ONBOARDING', 'businessOnboarding', businessOnboardingEnabled],
  ['BOOKING_LUMIN_CATALOG_AUTHORING', 'catalogAuthoring', catalogAuthoringEnabled],
  ['BOOKING_LUMIN_SCHEDULING_AUTHORING', 'schedulingAuthoring', schedulingAuthoringEnabled],
  ['BOOKING_LUMIN_DETAILING_PUBLICATION', 'detailingPublication', detailingPublicationEnabled],
  ['BOOKING_LUMIN_PAID_PUBLICATION', 'paidPublication', paidPublicationEnabled],
  // P2: owner booking list, detail, answers and cancellation. Previously gated on
  // BOOKING_LUMIN_ENV==='staging' with no flag, so the owner half of the loop could
  // not run in production at all.
  ['BOOKING_LUMIN_OWNER_BOOKING_OPS', 'ownerBookingOperations', ownerBookingOperationsEnabled],
  // P1 step 3: the read-only payment connection view. Reading only -- it opens
  // no path to begin a handoff, bind an account or record an observation.
  ['BOOKING_LUMIN_PAYMENT_CONNECTION_VISIBILITY', 'paymentConnectionVisibility', paymentConnectionVisibilityEnabled],
  // P1 step 5: begin a handoff and record the verified connection. Moves no
  // money; separate from the read flag because reading which account a tenant is
  // connected to and CHANGING it are different authorities.
  ['BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE', 'paymentConnectionWrite', paymentConnectionWriteEnabled],
];
const everyFlagOn = Object.fromEntries(CAPABILITIES.map(([flag]) => [flag, '1']));

it('every capability is reachable in production, and only via its own flag', () => {
  for (const [flag, name, enabled] of CAPABILITIES) {
    const prod = {BOOKING_LUMIN_ENV: 'production'};
    expect(enabled(prod), `${name} must be closed without ${flag}`).toBe(false);
    expect(enabled({...prod, [flag]: '1'}), `${name} must be enableable in production`).toBe(true);
    // One flag must not open another capability.
    for (const [other, otherName, otherEnabled] of CAPABILITIES) {
      if (other === flag) continue;
      expect(otherEnabled({...prod, [flag]: '1'}), `${flag} must not enable ${otherName}`).toBe(false);
    }
  }
});

it('THE INVARIANT: production with every capability flag on still refuses simulated money', () => {
  const prod = {BOOKING_LUMIN_ENV: 'production', ...everyFlagOn};
  // No capability flag turns fake payments on.
  expect(mockPaymentsEnabled(prod)).toBe(false);
  // Asking for them in production is a hard, loud refusal, not a silent false.
  expect(() => mockPaymentsEnabled({...prod, BOOKING_LUMIN_FAKE_PAYMENTS: '1'})).toThrow();
  // Same for any non-staging environment, including an absent one.
  for (const env of [undefined, 'demo', 'prod', '', 'Staging', 'STAGING']) {
    const e = {...everyFlagOn, BOOKING_LUMIN_FAKE_PAYMENTS: '1', ...(env === undefined ? {} : {BOOKING_LUMIN_ENV: env})};
    expect(() => mockPaymentsEnabled(e), `fake payments must refuse env=${String(env)}`).toThrow();
  }
  // Only exact 'staging' may have them, and only when explicitly asked.
  expect(mockPaymentsEnabled({...everyFlagOn, BOOKING_LUMIN_ENV: 'staging'})).toBe(false);
  expect(mockPaymentsEnabled({...everyFlagOn, BOOKING_LUMIN_ENV: 'staging', BOOKING_LUMIN_FAKE_PAYMENTS: '1'})).toBe(true);
});

it('capabilities do not depend on the fake-payment flag', () => {
  // The G1 defect was publication surfaces riding the payment gate. Setting
  // only the payment flag must never open a product capability.
  for (const [, name, enabled] of CAPABILITIES) {
    expect(enabled({BOOKING_LUMIN_ENV: 'staging', BOOKING_LUMIN_FAKE_PAYMENTS: '1'}), `${name} must not ride the payment gate`).toBe(false);
  }
});

it('the committed blueprint declares the matrix and never enables fake payments', () => {
  const yaml = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  for (const [flag] of CAPABILITIES) expect(yaml, `render.yaml must declare ${flag}`).toContain(flag);
  expect(yaml).toContain('BOOKING_LUMIN_ENV');
  // Pinned off, and never committed as enabled.
  expect(yaml).toMatch(/BOOKING_LUMIN_FAKE_PAYMENTS\s*\n\s*value:\s*"0"/);
  expect(yaml).not.toMatch(/BOOKING_LUMIN_FAKE_PAYMENTS\s*\n\s*value:\s*"?1"?/);
  // No capability may be committed as pre-enabled; they are opt-in per deploy.
  for (const [flag] of CAPABILITIES) {
    expect(yaml, `${flag} must not be pre-enabled in the blueprint`).not.toMatch(new RegExp(flag + '\\s*\\n\\s*value:\\s*"?1"?'));
  }
});
