# @lumin/i18n

Internationalization **primitives** for Booking Lumin Checkout.

This package is intentionally small and foundational. It provides the building
blocks other workstreams (checkout UX, templates, command center, portal) use to
present money, dates, addresses, and phone numbers correctly for any locale and
country — with **no US-only assumptions baked in anywhere**.

## The one rule

Locale, currency, timezone, and country are **independent inputs**. None is ever
inferred from another:

- a customer whose locale is `nl-NL` may pay in `USD`;
- a tenant in `America/Chicago` may serve customers reading `ja-JP`;
- an address in `JP` formats the Japanese way regardless of the viewer's locale.

Money is **always** integer minor units plus an explicit ISO-4217 currency
(`@lumin/contracts` `Money`). Floating-point money is forbidden. Timezones are
explicit IANA zones; instants are stored as UTC ISO strings and rendered in a
given zone via `Intl` (no hand-rolled DST math).

## What's here

| Module         | Provides                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------- |
| `locale.ts`    | `Locale` type, supported-locale registry (direction + display name), `isSupportedLocale`, `resolveLocale` |
| `currency.ts`  | `formatMoneyLocalized`, `toMinorUnits`, `parseMinorUnits` (integer-safe; reuse contracts money helpers)   |
| `datetime.ts`  | `formatDateTime`, `formatDateOnly`, `formatTimeOnly`, `zonedParts` — `timeZone` is always required        |
| `address.ts`   | `formatAddressLines` / `formatAddressBlock` — per-country ordered lines; optional fields omitted           |
| `phone.ts`     | `normalizePhone` (E.164-ish), `isPlausiblePhone`, `CALLING_CODES` — country-aware, no heavy dependency      |

## Consuming it

```ts
import {
  formatMoneyLocalized,
  formatDateTime,
  formatAddressLines,
  normalizePhone,
} from "@lumin/i18n";
import { money } from "@lumin/contracts";

formatMoneyLocalized(money(1999, "USD"), "en-US"); // "$19.99"
formatMoneyLocalized(money(1999, "USD"), "nl-NL"); // "US$ 19,99"
formatMoneyLocalized(money(1500, "JPY"), "ja-JP"); // "￥1,500"

formatDateTime("2025-03-09T07:30:00Z", "America/Chicago", "en-US"); // "Mar 9, 2025, 01:30 AM"
formatDateTime("2025-03-09T07:30:00Z", "Asia/Tokyo", "ja-JP"); // "2025年3月9日 16:30"

formatAddressLines(
  { line1: "1600 Amphitheatre Pkwy", city: "Mountain View", region: "CA", postalCode: "94043", country: "US" },
  "en-US",
); // ["1600 Amphitheatre Pkwy", "Mountain View, CA 94043", "United States"]

normalizePhone("(55) 5555-1234", "MX"); // "+525555551234"
```

## Design notes / limitations

- **Currency:** `toMinorUnits` refuses to round — a value with more fractional
  digits than the currency supports (e.g. `"1.005"` USD, or any fraction for a
  zero-decimal currency like JPY) throws rather than losing precision.
- **Dates:** all timezone/DST behavior comes from `Intl.DateTimeFormat` (the
  runtime's ICU data). `timeZone` is a required argument everywhere — the host
  machine's zone is never assumed.
- **Phone:** helpers are dependency-free and **not** a substitute for
  libphonenumber. `normalizePhone` normalizes shape and attaches a calling code;
  `isPlausiblePhone` is a coarse length/charset gate, not real validation.
- **Addresses:** layout is chosen from the country code; `region` and
  `postalCode` are optional and omitted gracefully when absent.

Everything is additive: this package adds primitives and depends only on
`@lumin/contracts`. It changes no core, adapter, contract, or app code.
