/**
 * @lumin/i18n — internationalization PRIMITIVES for Booking Lumin Checkout.
 *
 * These are foundational, additive helpers. They hold NO US-only assumptions:
 * money is integer minor units + an explicit ISO-4217 currency (reusing the
 * @lumin/contracts money rules), timezones are explicit IANA zones, dates are
 * UTC in / zoned out via Intl, addresses format per destination country, and
 * phones are country-aware. Locale, currency, timezone and country are all
 * INDEPENDENT inputs — none is ever inferred from another.
 *
 * Other workstreams (checkout UX, templates, command center) consume these
 * primitives; nothing here assumes USD, ZIP codes, US phone shapes, or US
 * address ordering.
 */

export * from "./locale";
export * from "./currency";
export * from "./datetime";
export * from "./address";
export * from "./phone";

export const I18N_VERSION = "0.1.0";
