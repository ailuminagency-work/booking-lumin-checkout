import {z} from 'zod';
import {PaidJourney,validatePaidJourney} from './paidJourney';
import {PaidSimpleService,PaidSimplePresentation} from './paidPublication';
import {validCustomerFieldText} from './paidCustomerFieldPublication';

type Immutable<T>=T extends readonly (infer Item)[]?readonly Immutable<Item>[]:T extends object?{readonly [Key in keyof T]:Immutable<T[Key]>}:T;
function immutable<T>(value:T):Immutable<T>{if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value as Immutable<T>;}
const canonicalUuid=z.string().uuid().refine(value=>value===value.toLowerCase(),'Expected a canonical published identity.');
const Service=PaidSimpleService.refine(service=>service.id===service.id.toLowerCase()&&service.name.trim().length>0&&validCustomerFieldText(service.name),'Invalid pinned service identity or name.');
const Form=z.object({
 name:z.string().min(1).max(200).refine(value=>value===value.trim()&&value.length>0&&validCustomerFieldText(value),'Invalid published form name.'),
 presentation:PaidSimplePresentation,
 // V8 initially has no immutable definitions to bind additional information or consent.
 // Fail closed until an explicit future schema adds real bindings, not just stage labels.
 journey:PaidJourney.refine(journey=>journey.stages.every(stage=>stage.kind!=='informational'),'Informational stages are not supported by this publication capability.'),
}).strict();
const shape={renderSchemaVersion:z.literal(8),submissionMode:z.literal('paid_journey_request'),paymentMode:z.literal('staging_mock'),simulated:z.literal(true),service:Service,form:Form};
const bounded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length<=12288;

/** Stored immutable V8 snapshot. It contains no tenant, actor, flow or draft metadata.
 * Parsing proves structure only, never catalog provenance or booking/payment authority. */
export const PaidJourneyPublicationSnapshot=z.object(shape).strict().refine(bounded,'Publication JSON exceeds its bounded size.').transform(immutable);
export type PaidJourneyPublicationSnapshot=z.infer<typeof PaidJourneyPublicationSnapshot>;
/** The dedicated public reader adds the immutable version identity. No legacy reader is widened. */
export const PaidJourneyRender=z.object({...shape,versionId:canonicalUuid}).strict().refine(bounded,'Render JSON exceeds its bounded size.').transform(immutable);
export type PaidJourneyRender=z.infer<typeof PaidJourneyRender>;
export const isPaidJourneyRender=(value:unknown):value is PaidJourneyRender=>PaidJourneyRender.safeParse(value).success;
export function parsePaidJourneyRender(value:unknown):PaidJourneyRender{return PaidJourneyRender.parse(value);}

/** Explicit server-only provenance comparison against an independently loaded, pinned
 * compatible simple catalog. The caller must obtain it on the server; owner input is
 * never a trusted source. No defaults and no request, hold or payment capability here. */
export function validatePaidJourneySnapshotAgainstServerCatalog(value:unknown,trustedServerService:unknown):PaidJourneyPublicationSnapshot{
 const trusted=Service.parse(trustedServerService),snapshot=PaidJourneyPublicationSnapshot.parse(value),service=snapshot.service;
 if(service.id!==trusted.id||service.name!==trusted.name||service.durationMinutes!==trusted.durationMinutes||service.price.amount!==trusted.price.amount||service.price.currency!==trusted.price.currency)throw Error('Published service does not match the trusted server catalog.');
 // The matching V8 SQL capability excludes questions, add-ons and resources; thus
 // options are optional and there are no supported additional informational bindings.
 validatePaidJourney(snapshot.form.journey,{optionsRequired:false,requiredInformationalStageIds:[]});
 return snapshot;
}
