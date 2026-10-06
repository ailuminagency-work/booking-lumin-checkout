/**
 * @lumin/contracts — versioned shared contracts for Booking Lumin Checkout.
 *
 * Contract versions in this package:
 *   MoneyContract v1, TenantContextContract v1, ServiceConfigContract v1,
 *   PricingContract v1, AvailabilityContract v1, BookingContract v1,
 *   PaymentProviderContract v1, IntegrationAdapterContract v1,
 *   ErrorContract v1, EventContract v1, WebhookContract v1.
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
export * from "./notifications";

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

export * from "./webhooks";

export * from "./business-profile";

export * from "./owner-catalog";

export * from "./owner-scheduling";

export * from './paid-install-health';
export * from './customer-draft-fields';

export * from './customer-field-install-health';
export * from './conditional-customer-fields';

export * from './detailing-catalog';

export * from "./detailing-scheduling";

export * from "./detailing-publication";
export * from './detailing-availability';
export * from './detailing-reservation';

export * from './notification-planner';

export * from './confirmation-receipts';

export * from './confirmation-receipt-history';


// Saved informational answers are separate from priced booking selections.
import {z} from 'zod';
import {TenantId} from './tenant';
import {CustomerDraftTextField} from './customer-draft-fields';
const bookingFormAnswer=z.object({fieldId:CustomerDraftTextField.shape.id,label:CustomerDraftTextField.shape.label,value:z.string().max(1000).refine(value=>!/[\u0000-\u001f\u007f-\u009f]/.test(value)&&!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value),'Invalid saved text')}).strict();
const bookingFormAnswerBase={schemaVersion:z.literal(1),tenantId:TenantId,bookingId:TenantId};
export const OwnerBookingFormAnswers=z.discriminatedUnion('status',[
 z.object({...bookingFormAnswerBase,status:z.literal('recorded'),provenance:z.object({flowId:TenantId,versionId:TenantId,renderSchemaVersion:z.union([z.literal(5),z.literal(6)]),draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict(),answers:z.array(bookingFormAnswer).max(10).refine(values=>new Set(values.map(value=>value.fieldId)).size===values.length,'Duplicate saved field')}).strict(),
 z.object({...bookingFormAnswerBase,status:z.literal('not_recorded'),provenance:z.null(),answers:z.tuple([])}).strict(),
 z.object({...bookingFormAnswerBase,status:z.literal('unsupported'),provenance:z.null(),answers:z.tuple([])}).strict(),
]);
export type OwnerBookingFormAnswers=z.infer<typeof OwnerBookingFormAnswers>;
