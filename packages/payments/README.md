# @lumin/payments

Provider-**neutral** merchant payment collection for Booking Lumin Checkout —
how a **tenant** collects money from **their** customers, abstracted over any
concrete payment provider.

## Strictly additive — it does not touch the existing contract

This package does **not** replace or modify the minimal `PaymentProvider`
contract in `@lumin/contracts` (`createIntent` / `getIntent` / `cancelIntent` /
`refund` / `parseWebhook`), which the RC-3 Stripe path implements today. It is a
**richer, additive superset** for the merchant-collection domain:

| Concern | `@lumin/contracts` `PaymentProvider` (unchanged) | `@lumin/payments` `MerchantPaymentProvider` (new) |
| --- | --- | --- |
| Scope | minimal charge / refund / webhook | full merchant collection |
| Flows | createIntent, getIntent, cancelIntent, refund, parseWebhook | createCharge, authorize/capture, refund/partialRefund, saveMethod/chargeSavedMethod, listSupportedMethods, marketplace onboarding |
| Today | the RC-3 Stripe adapter implements this | a future `StripeMerchantAdapter` would implement this |
| State | `PaymentState` | normalized `MerchantPaymentState` (adds `authorized`) |

A future `StripeMerchantAdapter` implements `MerchantPaymentProvider`; the
existing minimal adapter keeps working, untouched.

## Capability-driven routing

No single provider is ever assumed globally sufficient. Each provider ships a
**capability record** (plain data): the countries and currencies it settles, the
payment methods it presents, and which optional flows it supports
(auth/capture, partial refund, saved methods, marketplace/connect).

`selectProvider(request, capabilities)` is a **pure, deterministic** function
that reads those records and returns the best match — or an explicit
`NO_PROVIDER` result with a machine-readable reason (`NO_COUNTRY`,
`NO_CURRENCY`, `NO_GEOGRAPHY`, `NO_METHOD`). "We cannot collect this" is a
first-class outcome, not a thrown exception.

Hard requirements: `country`, `currency`, and `transactionGeography` (when set).
Soft rank: `methodPreference`. Deterministic tie-break: `tenantPreference` →
presents preferred method → more specialized provider (fewer countries, then
fewer currencies) → provider id.

## Add providers without core changes

Adding a provider is: one capability record + one adapter implementing
`MerchantPaymentProvider`. The routing and contract core never change — that is
the whole point of the abstraction.

## Mock-first

Two mock providers ship with **intentionally different** capabilities, proving
the same routing + contract code works across non-overlapping feature sets:

| | `mock-merchant-a` | `mock-merchant-b` |
| --- | --- | --- |
| Countries | US, DE, FR, IE, NL | MX, BR |
| Currencies | USD, EUR | MXN, BRL |
| Methods | card, wallet | card, bank_transfer, local_scheme |
| Auth/capture | ✅ | ❌ |
| Partial refund | ❌ | ✅ |
| Saved methods | ✅ | ✅ |
| Marketplace | ❌ | ✅ |

Provider A rejects a marketplace op and partial refunds; Provider B rejects
auth/capture and wallet. Both are in-memory, deterministic, and expose
inspection getters (`listCharges`, `listSavedMethods`, `listMarketplaceAccounts`)
for hand-assertion in tests. Dev mocks only — zero external credentials.

## Money

All amounts are integer minor units + an explicit ISO-4217 currency
(`@lumin/contracts` `Money`). Floating-point money is forbidden.
