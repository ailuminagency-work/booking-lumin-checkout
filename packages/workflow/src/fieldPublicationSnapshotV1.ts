import { recordV2 } from './fieldDocumentV2';
import { parseFieldDraftReceiptV3 } from './fieldDraftV3';
import { parseFieldPublicationV1, type FieldPublicationV1 } from './fieldPublicationV1';

/** Pure snapshot construction from supplied data only. A source wrapper is not proof
 * of tenant/flow ownership. The caller must authorize and atomically load tenant-bound
 * rows and compare both revisions in its transaction. This function does not fetch,
 * persist, authorize, rebase or enable publication. Enforce byte limits before JSON.
 * source.receipt must be raw V3 wire data; derived receipt properties are not accepted.
 */
export function snapshotFieldPublicationV1(input: unknown): FieldPublicationV1 {
  try {
    const value=recordV2(input,['tenantId','flowId','versionId','expectedParentRevision','expectedFieldDraftRevision','source']);
    const source=recordV2(value.source,['tenantId','flowId','receipt']);
    const receipt=parseFieldDraftReceiptV3(source.receipt);
    // Exact identity equality avoids silently changing spelling or binding another row.
    if(value.tenantId!==source.tenantId || value.flowId!==source.flowId ||
       value.expectedParentRevision!==receipt.savedParentRevision || value.expectedParentRevision!==receipt.currentParentRevision ||
       value.expectedFieldDraftRevision!==receipt.draftRevision)throw Error();
    // Publication parsing validates UUID syntax, positive safe revisions and a detached
    // frozen definition. Project only the publication contract's explicitly allowed data.
    return parseFieldPublicationV1({fieldPublicationVersion:1,tenantId:value.tenantId,flowId:value.flowId,versionId:value.versionId,parentAuthoringVersion:2,
      sourceParentRevision:value.expectedParentRevision,sourceFieldDraftRevision:value.expectedFieldDraftRevision,definition:receipt.definition,submissionMode:'unconfirmed_request'});
  } catch {throw new Error('INVALID_FIELD_PUBLICATION_SNAPSHOT_V1_CONTRACT');}
}
