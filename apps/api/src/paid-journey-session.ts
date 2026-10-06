import {z} from 'zod';
import {PaidJourneyRender} from '@lumin/workflow';
/** Internal receipt includes only the public installation binding, never hash/tenant/actor. */
export const PaidJourneySessionResult=z.object({schemaVersion:z.literal(1),installationId:z.string().uuid().refine(v=>v===v.toLowerCase()),expiresAt:z.string().datetime({offset:true}),render:PaidJourneyRender}).strict();
export function paidJourneySessionExpiryValid(value:{expiresAt:string},now:number){const expiry=Date.parse(value.expiresAt);return Number.isFinite(expiry)&&expiry>now&&expiry<=now+15*60000+1000;}
