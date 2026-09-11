/**
 * @lumin/contracts — versioned shared contracts for Booking Lumin Checkout.
 *
 * Contract versions in this package:
 *   MoneyContract v1, TenantContextContract v1, ServiceConfigContract v1,
 *   PricingContract v1, AvailabilityContract v1, BookingContract v1,
 *   PaymentProviderContract v1, IntegrationAdapterContract v1,
 *   ErrorContract v1, EventContract v1.
 *
 * Breaking changes require Architecture Governor review (see docs/DECISIONS.md).
 */

export * from "./money";
export * from "./tenant";
export * from "./service";
export * from "./pricing";
export * from "./availability";
export * from "./booking";
export * from "./payment";
export * from "./integrations";
export * from "./errors";
export * from "./events";

export const CONTRACTS_VERSION = "1.0.0";
export * from "./worker";
export * from "./roster";

// Pure installation representations; profile registry configuration is trusted composition.
export {
  INSTALLATION_LIMITS,
  InstallationContractError,
  createInstallationContracts,
  parseInstallationOrigin,
  parseInstallationProfile,
  parseInstallationRoute,
  parseInstallationMessage,
} from "./installation";
export type {
  InstallationMode,
  InstallationProfile,
  InstallationPolicy,
  InstallationMessage,
  InstallationOutput,
} from "./installation";
