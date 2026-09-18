import type { IncomingMessage } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { parseFieldDraftSaveV2, parseFieldDraftReadV2, parseFieldDraftReceiptV2 } from '@lumin/workflow';
import { Uuid } from './contracts';
import { FlowError, type FlowCode } from './repository';
import type { FieldDraftV2Repository } from './field-drafts-v2-repository';
export interface FieldDraftV2HttpDependencies {
  /** Coordinated disposable-local editor capability, never accepted from request data.
   * Hosted or mixed-version consumers require version negotiation before activation. */
  allowLocalFieldDraftV2?: boolean;
  /** Must resolve a freshly verified identity; never take actor IDs from caller JSON. */
  authenticateOwner(credential: string): Promise<string | null>;
  /** Trusted fixed RPC adapter; SQL must independently authorize actor + tenant + flow. */
  call: FieldDraftV2Repository['call'];
}
const statuses: Partial<Record<FlowCode, number>> = { INVALID_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, CONFLICT: 409, NOT_AVAILABLE: 404, UNSUPPORTED_CONFIG: 422, INTERNAL_ERROR: 500, RATE_LIMITED: 429 };
const invalid = (): never => { throw new FlowError('INVALID_REQUEST'); };
function id(value: unknown): string {
  const parsed = Uuid.safeParse(value);
  if (!parsed.success) return invalid();
  return parsed.data;
}
function body(req: IncomingMessage, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks: Buffer[] = [];
    const finish = (error?: FlowError) => {
      if (done) return;
      done = true; clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', failed); req.off('close', closed);
      if (error) { req.pause(); reject(error); } else resolve(Buffer.concat(chunks, size));
    };
    const failed = () => finish(new FlowError('INVALID_REQUEST'));
    const closed = () => { if (!req.complete) failed(); };
    const data = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk) || size + chunk.length > maximum) { failed(); return; }
      size += chunk.length; chunks.push(chunk);
    };
    const end = () => finish();
    const timer = setTimeout(failed, 10000);
    if (req.aborted || req.destroyed) { failed(); return; }
    req.on('data', data); req.on('end', end); req.on('error', failed); req.on('aborted', failed); req.on('close', closed);
  });
}
/** Serialize only validated raw wire fields; stale is derived by the recipient. */
function wireReceipt(value: ReturnType<typeof parseFieldDraftReceiptV2>) {
  return { fieldDraftVersion: value.fieldDraftVersion, parentAuthoringVersion: value.parentAuthoringVersion,
    draftRevision: value.draftRevision, savedParentRevision: value.savedParentRevision,
    currentParentRevision: value.currentParentRevision, definition: value.definition,
    runtimePublishable: value.runtimePublishable };
}
/** Component only: outer composition must enforce allowed owner origin, TLS,
 * a bounded authentication deadline, rate limits and safe connection closure for rejected/unread request bodies.
 * tenantId query selects a tenant; it grants no authority. No public route or
 * publication/session capability is installed by this module.
 */
export async function handleFieldDraftV2Request(req: IncomingMessage, dependencies: FieldDraftV2HttpDependencies) {
  try {
    if (dependencies.allowLocalFieldDraftV2 !== true) throw new FlowError('NOT_AVAILABLE');
    if (typeof req.url !== 'string' || /[\\\u0000-\u0020#]/.test(req.url) || !/^\/api\/field-drafts-v2\/[^/?]+(?:\?[^#]*)?$/.test(req.url)) throw new FlowError('NOT_AVAILABLE');
    const rawPath = req.url.split('?')[0]!;
    if (rawPath.includes('%') || rawPath.endsWith('/.') || rawPath.endsWith('/..')) throw new FlowError('NOT_AVAILABLE');
    const url = new URL(req.url, 'http://local.invalid');
    const route = /^\/api\/field-drafts-v2\/([^/]+)$/.exec(url.pathname);
    if (!route || (req.method !== 'GET' && req.method !== 'POST')) throw new FlowError('NOT_AVAILABLE');
    if ([...url.searchParams.keys()].some(key => key !== 'tenantId') || url.searchParams.getAll('tenantId').length !== 1) return invalid();
    const flow = id(route[1]), tenant = id(url.searchParams.get('tenantId'));
    // Node normally rejects ambiguous framing itself; reject duplicate security
    // headers here too so this component never relies on coalesced header values.
    if (req.rawHeaders !== undefined) {
      if (!Array.isArray(req.rawHeaders) || req.rawHeaders.length % 2 !== 0 || req.rawHeaders.length > 200) return invalid();
      const seen = new Set<string>();
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const key = req.rawHeaders[index], value = req.rawHeaders[index + 1];
        if (typeof key !== 'string' || typeof value !== 'string') return invalid();
        const lower = key.toLowerCase();
        if (['authorization','content-length','transfer-encoding','content-type'].includes(lower)) {
          if (seen.has(lower)) return invalid(); seen.add(lower);
        }
      }
    }
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(authorization)) throw new FlowError('UNAUTHENTICATED');
    let actor: string;
    try { actor = id(await dependencies.authenticateOwner(authorization.slice(7))); } catch { throw new FlowError('UNAUTHENTICATED'); }
    const length = req.headers['content-length'], transfer = req.headers['transfer-encoding'];
    if (length !== undefined && (typeof length !== 'string' || !/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 32768)) return invalid();
    if (transfer !== undefined && (transfer !== 'chunked' || length !== undefined)) return invalid();
    if (req.method === 'GET') {
      if (transfer !== undefined || (length !== undefined && length !== '0')) return invalid();
      await body(req, 0);
      if (req.aborted || (req.destroyed && !req.complete) || req.socket?.destroyed === true) return invalid();
      const raw = await dependencies.call('get_field_draft_v2', [actor, tenant, flow]);
      let data;
      try { data = parseFieldDraftReadV2(raw); } catch { throw new FlowError('INTERNAL_ERROR'); }
      return { status: 200, body: { ok: true as const, data: data.status === 'present' ? { status: 'present' as const, receipt: wireReceipt(data.receipt) } : data } };
    }
    if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) return invalid();
    const bytes = await body(req, 32768);
    if (length !== undefined && bytes.length !== Number(length)) return invalid();
    let parsed;
    try { parsed = parseFieldDraftSaveV2(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); } catch { return invalid(); }
    if (parsed.expectedRevision === Number.MAX_SAFE_INTEGER) return invalid();
    if (req.aborted || (req.destroyed && !req.complete) || req.socket?.destroyed === true) return invalid();
    const raw = await dependencies.call('save_field_draft_v2', [actor, tenant, flow, parsed.expectedRevision, parsed.expectedFlowRevision, parsed.definition]);
    let data;
    try { data = parseFieldDraftReceiptV2(raw); } catch { throw new FlowError('INTERNAL_ERROR'); }
    if (data.draftRevision !== parsed.expectedRevision + 1 || data.savedParentRevision !== parsed.expectedFlowRevision || data.currentParentRevision !== parsed.expectedFlowRevision || !isDeepStrictEqual(data.definition, parsed.definition)) throw new FlowError('INTERNAL_ERROR');
    return { status: 200, body: { ok: true as const, data: wireReceipt(data) } };
  } catch (error) {
    const code = error instanceof FlowError && Object.hasOwn(statuses, error.code) ? error.code : 'INTERNAL_ERROR';
    return { status: statuses[code] ?? 500, body: { ok: false as const, code } };
  }
}
