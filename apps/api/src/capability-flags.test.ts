import {it, expect} from 'vitest';
import {capabilityEnabled, paidPublicationEnabled} from './capability-flags';
import {mockPaymentsEnabled} from './mock-payment';

it('capability flags are default-closed and require the exact string 1', () => {
  expect(capabilityEnabled({}, 'BOOKING_LUMIN_X')).toBe(false);
  for (const v of ['', '0', 'true', 'TRUE', 'yes', ' 1', '1 ', '11']) {
    expect(capabilityEnabled({BOOKING_LUMIN_X: v}, 'BOOKING_LUMIN_X')).toBe(false);
  }
  expect(capabilityEnabled({BOOKING_LUMIN_X: '1'}, 'BOOKING_LUMIN_X')).toBe(true);
});

it('capability flags are legal in production, unlike the fake-payment gate', () => {
  const prod = {BOOKING_LUMIN_ENV: 'production', BOOKING_LUMIN_PAID_PUBLICATION: '1'};
  // The whole point of G1: a capability may be enabled in production.
  expect(paidPublicationEnabled(prod)).toBe(true);
  // ...while simulated money may not be, and says so loudly.
  expect(() => mockPaymentsEnabled({...prod, BOOKING_LUMIN_FAKE_PAYMENTS: '1'})).toThrow();
});

it('a capability flag never enables fake payments, in any environment', () => {
  // No capability flag is a substitute for the payment gate.
  for (const env of ['production', 'staging', 'demo', undefined]) {
    const base = {
      ...(env === undefined ? {} : {BOOKING_LUMIN_ENV: env}),
      BOOKING_LUMIN_PAID_PUBLICATION: '1',
      BOOKING_LUMIN_BUSINESS_ONBOARDING: '1',
      BOOKING_LUMIN_CATALOG_AUTHORING: '1',
      BOOKING_LUMIN_SCHEDULING_AUTHORING: '1',
      BOOKING_LUMIN_DETAILING_PUBLICATION: '1',
    };
    // FAKE_PAYMENTS absent => off everywhere, regardless of capability flags.
    expect(mockPaymentsEnabled(base)).toBe(false);
  }
  // And staging still needs the explicit payment flag.
  expect(mockPaymentsEnabled({BOOKING_LUMIN_ENV: 'staging'})).toBe(false);
  expect(mockPaymentsEnabled({BOOKING_LUMIN_ENV: 'staging', BOOKING_LUMIN_FAKE_PAYMENTS: '1'})).toBe(true);
});
