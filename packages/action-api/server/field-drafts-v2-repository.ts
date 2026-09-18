import { isDeepStrictEqual, types } from 'node:util';
import { parseFieldDraftReadV2, parseFieldDraftReceiptV2, parseFieldDraftSaveV2, type FieldDraftReceiptV2 } from '@lumin/workflow';
import { Uuid } from './contracts';
import { FlowError } from './repository';
export type FieldDraftV2Rpc = 'get_field_draft_v2' | 'save_field_draft_v2';
export interface FieldDraftV2Repository { call(name: FieldDraftV2Rpc, input: readonly unknown[]): Promise<unknown> }

export interface FieldDraftV2PgClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(error?: Error): void;
}
export interface FieldDraftV2PgPool { connect(): Promise<FieldDraftV2PgClient> }
const SQL = {
  get_field_draft_v2: 'select public.get_field_draft_v2($1::uuid,$2::uuid,$3::uuid) as result',
  save_field_draft_v2: 'select public.save_field_draft_v2($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::bigint,$6::jsonb) as result',
} as const;
function wire(receipt: FieldDraftReceiptV2) {
  return Object.freeze({ fieldDraftVersion: receipt.fieldDraftVersion, parentAuthoringVersion: receipt.parentAuthoringVersion,
    draftRevision: receipt.draftRevision, savedParentRevision: receipt.savedParentRevision,
    currentParentRevision: receipt.currentParentRevision, definition: receipt.definition, runtimePublishable: receipt.runtimePublishable });
}
function parameters(name: FieldDraftV2Rpc, input: readonly unknown[]) {
  try {
    if (typeof name !== 'string' || !Object.hasOwn(SQL, name) || !Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype) throw Error();
    const length = name === 'get_field_draft_v2' ? 3 : 6;
    if (input.length !== length || Reflect.ownKeys(input).length !== length + 1) throw Error();
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error();
      values.push(descriptor.value);
    }
    for (let i = 0; i < 3; i++) values[i] = Uuid.parse(values[i]);
    if (name === 'get_field_draft_v2') return { values };
    const save = parseFieldDraftSaveV2({ fieldDraftVersion: 2, parentAuthoringVersion: 2, expectedRevision: values[3], expectedFlowRevision: values[4], definition: values[5] });
    if (save.expectedRevision === Number.MAX_SAFE_INTEGER) throw Error();
    values[3] = save.expectedRevision; values[4] = save.expectedFlowRevision; values[5] = JSON.stringify(save.definition);
    return { values, save };
  } catch { throw new FlowError('INVALID_REQUEST'); }
}
function failure(error: unknown): FlowError {
  // Driver error text never becomes client-visible, and accessors are not invoked.
  if (!error || typeof error !== 'object' || types.isProxy(error)) return new FlowError('INTERNAL_ERROR');
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  const message = Object.getOwnPropertyDescriptor(error, 'message')?.value;
  if (code === '23514' && message === 'FIELD_DRAFT_FAMILY_CONFLICT') return new FlowError('CONFLICT');
  if (code === '42501' && message === 'FORBIDDEN') return new FlowError('FORBIDDEN');
  if (code === '40001' && ['FIELD_DRAFT_V2_PARENT_CONFLICT', 'FIELD_DRAFT_V2_REVISION_CONFLICT'].includes(message)) return new FlowError('CONFLICT');
  if (code === 'P0002' && message === 'FIELD_DRAFT_V2_NOT_AVAILABLE') return new FlowError('NOT_AVAILABLE');
  if (code === '0A000' && message === 'FIELD_DRAFT_V2_UNSUPPORTED_PARENT') return new FlowError('UNSUPPORTED_CONFIG');
  if (code === '22023' && ['FIELD_DRAFT_V2_INVALID', 'FIELD_DRAFT_V2_REVISION_EXHAUSTED'].includes(message)) return new FlowError('INVALID_REQUEST');
  return new FlowError('INTERNAL_ERROR');
}
/** Narrow trusted-pool composition seam; owns checked-out clients, never the pool.
 * Composition must configure bounded acquisition, statement and lock timeouts.
 * No Promise timeout is a database cancellation guarantee. An error during COMMIT
 * can have an unknown outcome: callers must re-read revisions, never blindly retry.
 */
export function createFieldDraftV2Repository(pool: FieldDraftV2PgPool): FieldDraftV2Repository {
  return { async call(name, input) {
    const copied = parameters(name, input);
    let client: FieldDraftV2PgClient;
    try { client = await pool.connect(); } catch { throw new FlowError('INTERNAL_ERROR'); }
    let commitSubmitted = false, discard = false;
    try {
      await client.query('begin');
      await client.query('set local role service_role');
      const result = await client.query(SQL[name], copied.values);
      let safe: unknown;
      try {
        // Never evaluate getters on a malformed driver envelope.
        if (!result || types.isProxy(result)) throw Error();
        const rows = Object.getOwnPropertyDescriptor(result, 'rows')?.value;
        if (!Array.isArray(rows) || types.isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1 || Reflect.ownKeys(rows).length !== 2) throw Error();
        const row = Object.getOwnPropertyDescriptor(rows, '0')?.value;
        if (!row || typeof row !== 'object' || types.isProxy(row) || ![Object.prototype,null].includes(Object.getPrototypeOf(row)) || Reflect.ownKeys(row).length !== 1) throw Error();
        const descriptor = Object.getOwnPropertyDescriptor(row, 'result');
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error();
        const raw = descriptor.value;
        if (name === 'get_field_draft_v2') {
          const read = parseFieldDraftReadV2(raw);
          safe = read.status === 'missing' ? read : Object.freeze({ status: 'present', receipt: wire(read.receipt) });
        } else {
          const receipt = parseFieldDraftReceiptV2(raw), save = copied.save;
          if (!save || receipt.draftRevision !== save.expectedRevision + 1 || receipt.savedParentRevision !== save.expectedFlowRevision || receipt.currentParentRevision !== save.expectedFlowRevision || !isDeepStrictEqual(receipt.definition, save.definition)) throw Error();
          safe = wire(receipt);
        }
      } catch { throw new FlowError('INTERNAL_ERROR'); }
      commitSubmitted = true;
      await client.query('commit');
      return safe;
    } catch (error) {
      discard = commitSubmitted;
      try { await client.query('rollback'); } catch { discard = true; }
      throw commitSubmitted ? new FlowError('INTERNAL_ERROR') : failure(error);
    } finally {
      try { client.release(discard ? new Error('FIELD_DRAFT_V2_CONNECTION_DISCARDED') : undefined); } catch { /* Never leak driver errors or retry release. */ }
    }
  } };
}
