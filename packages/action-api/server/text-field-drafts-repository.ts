import { isDeepStrictEqual, types } from 'node:util';
import { parseTextFieldDraftRead, parseTextFieldDraftReceipt, parseTextFieldDraftSave, type TextFieldDraftReceipt } from '@lumin/workflow';
import { Uuid } from './contracts';
import { FlowError } from './repository';
import type { TextFieldDraftHttpDependencies, TextFieldDraftRpc } from './text-field-drafts-http';

export interface TextFieldDraftPgClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(error?: Error): void;
}
export interface TextFieldDraftPgPool { connect(): Promise<TextFieldDraftPgClient> }
const SQL = {
  get_text_field_draft: 'select public.get_text_field_draft($1::uuid,$2::uuid,$3::uuid) as result',
  save_text_field_draft: 'select public.save_text_field_draft($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::bigint,$6::jsonb) as result',
} as const;
function wire(receipt: TextFieldDraftReceipt) {
  return Object.freeze({ textDraftVersion: receipt.textDraftVersion, parentAuthoringVersion: receipt.parentAuthoringVersion,
    draftRevision: receipt.draftRevision, savedParentRevision: receipt.savedParentRevision,
    currentParentRevision: receipt.currentParentRevision, definition: receipt.definition, runtimePublishable: receipt.runtimePublishable });
}
function parameters(name: TextFieldDraftRpc, input: readonly unknown[]) {
  try {
    if (!Object.hasOwn(SQL, name) || !Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype) throw Error();
    const length = name === 'get_text_field_draft' ? 3 : 6;
    if (input.length !== length || Reflect.ownKeys(input).length !== length + 1) throw Error();
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error();
      values.push(descriptor.value);
    }
    for (let i = 0; i < 3; i++) values[i] = Uuid.parse(values[i]);
    if (name === 'get_text_field_draft') return { values };
    const save = parseTextFieldDraftSave({ textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: values[3], expectedFlowRevision: values[4], definition: values[5] });
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
  if (code === '42501' && message === 'FORBIDDEN') return new FlowError('FORBIDDEN');
  if (code === '40001' && ['TEXT_DRAFT_PARENT_CONFLICT', 'TEXT_DRAFT_REVISION_CONFLICT'].includes(message)) return new FlowError('CONFLICT');
  if (code === 'P0002' && message === 'TEXT_DRAFT_NOT_AVAILABLE') return new FlowError('NOT_AVAILABLE');
  if (code === '0A000' && message === 'TEXT_DRAFT_UNSUPPORTED_PARENT') return new FlowError('UNSUPPORTED_CONFIG');
  if (code === '22023' && ['TEXT_DRAFT_INVALID', 'TEXT_DRAFT_REVISION_EXHAUSTED'].includes(message)) return new FlowError('INVALID_REQUEST');
  return new FlowError('INTERNAL_ERROR');
}
/** Narrow trusted-pool composition seam; owns checked-out clients, never the pool.
 * Composition must configure bounded acquisition, statement and lock timeouts.
 * No Promise timeout is a database cancellation guarantee. An error during COMMIT
 * can have an unknown outcome: callers must re-read revisions, never blindly retry.
 */
export function createTextFieldDraftRepository(pool: TextFieldDraftPgPool): Pick<TextFieldDraftHttpDependencies, 'call'> {
  return { async call(name, input) {
    const copied = parameters(name, input);
    let client: TextFieldDraftPgClient;
    try { client = await pool.connect(); } catch { throw new FlowError('INTERNAL_ERROR'); }
    let commitSubmitted = false, discard = false;
    try {
      await client.query('begin');
      await client.query('set local role service_role');
      const result = await client.query(SQL[name], copied.values);
      let safe: unknown;
      try {
        if (result.rows.length !== 1) throw Error();
        const raw = result.rows[0]?.result;
        if (name === 'get_text_field_draft') {
          const read = parseTextFieldDraftRead(raw);
          safe = read.status === 'missing' ? read : Object.freeze({ status: 'present', receipt: wire(read.receipt) });
        } else {
          const receipt = parseTextFieldDraftReceipt(raw), save = copied.save;
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
      try { client.release(discard ? new Error('TEXT_DRAFT_CONNECTION_DISCARDED') : undefined); } catch { /* Never leak driver errors or retry release. */ }
    }
  } };
}
