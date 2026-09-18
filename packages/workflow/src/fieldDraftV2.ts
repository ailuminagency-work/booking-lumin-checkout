import { parseFieldDocumentV2, type FieldDocumentV2 } from './fieldDocumentV2';
/** Pure draft transport contracts, not authorization, CAS execution or persistence.
 * parentAuthoringVersion is only a discriminator: the server must resolve the
 * route's tenant/flow, verify owner membership and actual parent version/revision.
 * Separate mixed-field V2 wire contract; no conversion, fallback or sidecar selection.
 * A future server must reject ambiguous V1/V2 sidecars under a shared storage invariant.
 * This parser neither proves absence of a V1 sidecar nor authorizes V2 activation.
 * expectedRevision 0 means create-only; no automatic rebase is performed here.
 * MAX_SAFE_INTEGER is a readable/suppliable token; storage must reject any update
 * that would increment it. Raw request byte limits belong before JSON decoding.
 */
export interface FieldDraftSaveV2 {
  readonly fieldDraftVersion: 2; readonly parentAuthoringVersion: 2;
  readonly expectedRevision: number; readonly expectedFlowRevision: number;
  readonly definition: FieldDocumentV2;
}
export interface FieldDraftReceiptV2 {
  readonly fieldDraftVersion: 2; readonly parentAuthoringVersion: 2;
  readonly draftRevision: number; readonly savedParentRevision: number;
  readonly currentParentRevision: number; readonly definition: FieldDocumentV2;
  readonly runtimePublishable: false; readonly stale: boolean;
}
export type FieldDraftReadV2 = Readonly<{
  status: 'missing'; fieldDraftVersion: 2; parentAuthoringVersion: 2;
  currentParentRevision: number; runtimePublishable: false;
}> | Readonly<{ status: 'present'; receipt: FieldDraftReceiptV2 }>;
const reject = (): never => { throw new Error('INVALID_FIELD_DRAFT_V2_CONTRACT'); };
function own(input: unknown): object {
  if (!input || typeof input !== 'object') return reject();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return reject();
  return input;
}
function data(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return reject();
  return descriptor.value;
}
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = own(input), actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return reject();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) result[key] = data(value, key);
  return result;
}
function revision(input: unknown, minimum: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum || Object.is(input, -0)) return reject();
  return input;
}
function versions(value: Record<string, unknown>): void {
  if (value.fieldDraftVersion !== 2 || value.parentAuthoringVersion !== 2) reject();
}
export function parseFieldDraftSaveV2(input: unknown): FieldDraftSaveV2 {
  try {
    const value = record(input, ['fieldDraftVersion', 'parentAuthoringVersion', 'expectedRevision', 'expectedFlowRevision', 'definition']);
    versions(value);
    return Object.freeze({ fieldDraftVersion: 2 as const, parentAuthoringVersion: 2 as const,
      expectedRevision: revision(value.expectedRevision, 0), expectedFlowRevision: revision(value.expectedFlowRevision, 1),
      definition: parseFieldDocumentV2(value.definition) });
  } catch { return reject(); }
}
export function parseFieldDraftReceiptV2(input: unknown): FieldDraftReceiptV2 {
  try {
    const value = record(input, ['fieldDraftVersion', 'parentAuthoringVersion', 'draftRevision', 'savedParentRevision', 'currentParentRevision', 'definition', 'runtimePublishable']);
    versions(value);
    if (value.runtimePublishable !== false) return reject();
    const draftRevision = revision(value.draftRevision, 1), savedParentRevision = revision(value.savedParentRevision, 1), currentParentRevision = revision(value.currentParentRevision, 1);
    if (savedParentRevision > currentParentRevision) return reject();
    return Object.freeze({ fieldDraftVersion: 2 as const, parentAuthoringVersion: 2 as const,
      draftRevision, savedParentRevision, currentParentRevision, definition: parseFieldDocumentV2(value.definition),
      runtimePublishable: false as const, stale: savedParentRevision !== currentParentRevision });
  } catch { return reject(); }
}
/** Receipt inputs are raw wire data; a caller-supplied stale flag always rejects. */
export function parseFieldDraftReadV2(input: unknown): FieldDraftReadV2 {
  try {
    const status = data(own(input), 'status');
    if (status === 'present') {
      const value = record(input, ['status', 'receipt']);
      return Object.freeze({ status: 'present' as const, receipt: parseFieldDraftReceiptV2(value.receipt) });
    }
    if (status !== 'missing') return reject();
    const value = record(input, ['status', 'fieldDraftVersion', 'parentAuthoringVersion', 'currentParentRevision', 'runtimePublishable']);
    versions(value);
    if (value.runtimePublishable !== false) return reject();
    return Object.freeze({ status: 'missing' as const, fieldDraftVersion: 2 as const, parentAuthoringVersion: 2 as const,
      currentParentRevision: revision(value.currentParentRevision, 1), runtimePublishable: false as const });
  } catch { return reject(); }
}
