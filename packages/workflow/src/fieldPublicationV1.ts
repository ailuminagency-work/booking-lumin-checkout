import { z } from 'zod';
import { recordV2 } from './fieldDocumentV2';
import { parseFieldDocumentV3, type FieldDocumentV3 } from './fieldDocumentV3';

/** Pure envelope parser, not publication execution or authorization. Supplied identities
 * are syntax-checked only. A caller must authorize and load tenant-bound rows and verify
 * both source revisions atomically before publication. Enforce raw byte limits before
 * JSON decoding. This envelope grants no booking, payment or capacity authority.
 */
export interface FieldPublicationV1 {
  readonly fieldPublicationVersion: 1;
  readonly tenantId: string; readonly flowId: string; readonly versionId: string;
  readonly parentAuthoringVersion: 2;
  readonly sourceParentRevision: number; readonly sourceFieldDraftRevision: number;
  readonly definition: FieldDocumentV3;
  readonly submissionMode: 'unconfirmed_request';
}
const identity = z.string().uuid();
const reject = (): never => { throw new Error('INVALID_FIELD_PUBLICATION_V1_CONTRACT'); };
function revision(value: unknown): number {
  if(typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || Object.is(value,-0)) return reject();
  return value;
}
export function parseFieldPublicationV1(input: unknown): FieldPublicationV1 {
  try {
    const value=recordV2(input,['fieldPublicationVersion','tenantId','flowId','versionId','parentAuthoringVersion','sourceParentRevision','sourceFieldDraftRevision','definition','submissionMode']);
    if(value.fieldPublicationVersion!==1 || value.parentAuthoringVersion!==2 || value.submissionMode!=='unconfirmed_request')return reject();
    return Object.freeze({fieldPublicationVersion:1 as const,tenantId:identity.parse(value.tenantId),flowId:identity.parse(value.flowId),versionId:identity.parse(value.versionId),parentAuthoringVersion:2 as const,
      sourceParentRevision:revision(value.sourceParentRevision),sourceFieldDraftRevision:revision(value.sourceFieldDraftRevision),definition:parseFieldDocumentV3(value.definition),submissionMode:'unconfirmed_request' as const});
  } catch {return reject();}
}
