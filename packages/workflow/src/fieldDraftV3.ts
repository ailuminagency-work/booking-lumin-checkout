import { recordV2 } from './fieldDocumentV2';
import { parseFieldDocumentV3, type FieldDocumentV3 } from './fieldDocumentV3';
/** Pure draft transport contracts, not authorization, CAS execution or persistence.
 * parentAuthoringVersion is only a discriminator: the server must resolve the
 * route's tenant/flow, verify owner membership and actual parent version/revision.
 * Separate mixed-field V3 wire contract; no conversion, fallback or sidecar selection.
 * A future server must reject ambiguous V1/V2/V3 sidecars under a shared storage invariant.
 * This parser neither proves absence of existing sidecars nor authorizes V3 activation.
 * expectedRevision 0 means create-only; no automatic rebase is performed here.
 * MAX_SAFE_INTEGER is a readable/suppliable token; storage must reject any update
 * that would increment it. Raw request byte limits belong before JSON decoding.
 */
export interface FieldDraftSaveV3 {
  readonly fieldDraftVersion: 3; readonly parentAuthoringVersion: 2;
  readonly expectedRevision: number; readonly expectedFlowRevision: number;
  readonly definition: FieldDocumentV3;
}
export interface FieldDraftReceiptV3 {
  readonly fieldDraftVersion: 3; readonly parentAuthoringVersion: 2;
  readonly draftRevision: number; readonly savedParentRevision: number;
  readonly currentParentRevision: number; readonly definition: FieldDocumentV3;
  readonly runtimePublishable: false; readonly stale: boolean;
}
export type FieldDraftReadV3 = Readonly<{
  status: 'missing'; fieldDraftVersion: 3; parentAuthoringVersion: 2;
  currentParentRevision: number; runtimePublishable: false;
}> | Readonly<{ status: 'present'; receipt: FieldDraftReceiptV3 }>;
const reject = (): never => { throw new Error('INVALID_FIELD_DRAFT_V3_CONTRACT'); };
const record = (input: unknown, keys: readonly string[]) => recordV2(input, keys);
function revision(input: unknown, minimum: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum || Object.is(input, -0)) return reject();
  return input;
}
function versions(value: Record<string, unknown>): void {
  if (value.fieldDraftVersion !== 3 || value.parentAuthoringVersion !== 2) reject();
}
export function parseFieldDraftSaveV3(input: unknown): FieldDraftSaveV3 {
  try {
    const value = record(input, ['fieldDraftVersion', 'parentAuthoringVersion', 'expectedRevision', 'expectedFlowRevision', 'definition']);
    versions(value);
    return Object.freeze({ fieldDraftVersion: 3 as const, parentAuthoringVersion: 2 as const,
      expectedRevision: revision(value.expectedRevision, 0), expectedFlowRevision: revision(value.expectedFlowRevision, 1),
      definition: parseFieldDocumentV3(value.definition) });
  } catch { return reject(); }
}
export function parseFieldDraftReceiptV3(input: unknown): FieldDraftReceiptV3 {
  try {
    const value = record(input, ['fieldDraftVersion', 'parentAuthoringVersion', 'draftRevision', 'savedParentRevision', 'currentParentRevision', 'definition', 'runtimePublishable']);
    versions(value);
    if (value.runtimePublishable !== false) return reject();
    const draftRevision = revision(value.draftRevision, 1), savedParentRevision = revision(value.savedParentRevision, 1), currentParentRevision = revision(value.currentParentRevision, 1);
    if (savedParentRevision > currentParentRevision) return reject();
    return Object.freeze({ fieldDraftVersion: 3 as const, parentAuthoringVersion: 2 as const,
      draftRevision, savedParentRevision, currentParentRevision, definition: parseFieldDocumentV3(value.definition),
      runtimePublishable: false as const, stale: savedParentRevision !== currentParentRevision });
  } catch { return reject(); }
}
/** Receipt inputs are raw wire data; a caller-supplied stale flag always rejects. */
export function parseFieldDraftReadV3(input: unknown): FieldDraftReadV3 {
  try {
    // Reflect the untrusted envelope once. Branch checks only revisit this detached
    // own-data snapshot, so a descriptor-changing Proxy cannot swap its status.
    const snapshot = recordV2(input, ['status'], ['receipt', 'fieldDraftVersion', 'parentAuthoringVersion', 'currentParentRevision', 'runtimePublishable']);
    const status = snapshot.status;
    if (status === 'present') {
      const value = record(snapshot, ['status', 'receipt']);
      return Object.freeze({ status: 'present' as const, receipt: parseFieldDraftReceiptV3(value.receipt) });
    }
    if (status !== 'missing') return reject();
    const value = record(snapshot, ['status', 'fieldDraftVersion', 'parentAuthoringVersion', 'currentParentRevision', 'runtimePublishable']);
    versions(value);
    if (value.runtimePublishable !== false) return reject();
    return Object.freeze({ status: 'missing' as const, fieldDraftVersion: 3 as const, parentAuthoringVersion: 2 as const,
      currentParentRevision: revision(value.currentParentRevision, 1), runtimePublishable: false as const });
  } catch { return reject(); }
}
