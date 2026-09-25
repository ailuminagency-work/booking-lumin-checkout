import { parseFieldDraftReadV3, parseFieldDraftReceiptV3, parseFieldDraftSaveV3, type FieldDraftReadV3, type FieldDraftReceiptV3 } from '@lumin/workflow';
import { FlowError } from './client';

const LIMIT = 32768;
const REQUEST_TIMEOUT_MS = 15000;
const codes = ['INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'CONFLICT', 'NOT_AVAILABLE', 'UNSUPPORTED_CONFIG', 'INTERNAL_ERROR', 'RATE_LIMITED'] as const;

/** Owner draft transport only. Tenant is an untrusted selector; the server verifies
 * actor membership. The default-off constructor flag is a local opt-in, not
 * server authorization or version negotiation; no V1/V2 fallback is attempted. Call invalidate() whenever the account or tenant context changes. */
export function createFieldDraftV3Client(base: string, localHarness = false, fetcher: typeof fetch = fetch, allowLocalFieldDraftV3 = false) {
  if (typeof base !== 'string') throw new FlowError('INVALID_REQUEST');
  let url: URL;
  try { url = new URL(base); } catch { throw new FlowError('INVALID_REQUEST'); }
  if (url.origin !== base || url.username || url.password || !(url.protocol === 'https:' || (localHarness === true && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new FlowError('INVALID_REQUEST');
  let generation = 0;
  const active = new Set<() => void>();

  const statuses = { INVALID_REQUEST:400, UNAUTHENTICATED:401, FORBIDDEN:403, CONFLICT:409, NOT_AVAILABLE:404, UNSUPPORTED_CONFIG:422, INTERNAL_ERROR:500, RATE_LIMITED:429 };
  async function call<T>(token: string, tenantId: string, flowId: string, parse: (value: unknown) => T, input?: unknown): Promise<T> {
    if (allowLocalFieldDraftV3 !== true) throw new FlowError('NOT_AVAILABLE');
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /[^A-Za-z0-9._~-]/.test(token)) throw new FlowError('UNAUTHENTICATED');
    if (typeof flowId !== 'string' || flowId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowId)) throw new FlowError('INVALID_REQUEST');
    if (typeof tenantId !== 'string' || tenantId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new FlowError('INVALID_REQUEST');
    let body: string | undefined;
    let copiedSave: ReturnType<typeof parseFieldDraftSaveV3> | undefined;
    if (input !== undefined) {
      try {
        copiedSave = parseFieldDraftSaveV3(input);
        if (copiedSave.expectedRevision === Number.MAX_SAFE_INTEGER) throw new Error();
        body = JSON.stringify(copiedSave);
        if (new TextEncoder().encode(body).byteLength > LIMIT) throw new Error();
      } catch { throw new FlowError('INVALID_REQUEST'); }
    }
    const at = generation;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stopped: 'UNAUTHENTICATED' | 'INTERNAL_ERROR' | undefined;
    let finished = false;
    let cancelStarted = false;
    let rejectStopped!: (error: FlowError) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectStopped = reject; });
    // Observe rejection even if a synchronous adapter failure happens before a race.
    void interrupted.catch(() => undefined);
    function cancelReader() {
      if (!reader || cancelStarted) return;
      cancelStarted = true;
      try { void reader.cancel().catch(() => undefined); } catch { /* Adapter cleanup cannot mask the public error. */ }
    }
    function stop(code: 'UNAUTHENTICATED' | 'INTERNAL_ERROR') {
      if (finished || stopped) return;
      stopped = code;
      rejectStopped(new FlowError(code));
      controller.abort();
      cancelReader();
    }
    const invalidate = () => stop('UNAUTHENTICATED');
    active.add(invalidate);
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => stop('INTERNAL_ERROR'), REQUEST_TIMEOUT_MS);
    function check() {
      if (at !== generation) stop('UNAUTHENTICATED');
      if (Date.now() >= deadline) stop('INTERNAL_ERROR');
      if (stopped) throw new FlowError(stopped);
    }
    try {
      const fetching = Promise.resolve(fetcher(base + '/api/field-drafts-v3/' + encodeURIComponent(flowId) + '?tenantId=' + encodeURIComponent(tenantId), {
        signal: controller.signal, method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body }),
      })).then(response => {
        // An injected adapter may ignore AbortSignal and settle after we have rejected.
        // Own and dispose its late body without waiting for its cancellation promise.
        if (stopped || finished) {
          try { void response.body?.cancel().catch(() => undefined); } catch { /* No raw cleanup errors. */ }
        }
        return response;
      });
      const response = await Promise.race([fetching, interrupted]);
      // Do not fall back to unbounded json()/text() on adapters without a stream.
      if (!response.body) throw new FlowError('INTERNAL_ERROR');
      reader = response.body.getReader();
      if (response.redirected) throw new FlowError('INTERNAL_ERROR');
      check();
      const buffer = new Uint8Array(LIMIT);
      let size = 0;
      try {
        for (;;) {
          check();
          const chunk = await Promise.race([reader.read(), interrupted]);
          check();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > LIMIT - size) {
            stop('INTERNAL_ERROR');
            throw new FlowError('INTERNAL_ERROR');
          }
          buffer.set(chunk.value, size); size += chunk.value.byteLength;
        }
      } finally {
        cancelReader();
        try { reader.releaseLock(); } catch { /* An adapter may retain a pending native read. */ }
      }
      if (at !== generation) throw new FlowError('UNAUTHENTICATED');
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FlowError('INTERNAL_ERROR');
      const envelope = value as Record<string, unknown>;
      if (Object.keys(envelope).length !== 2) throw new FlowError('INTERNAL_ERROR');
      if (!response.ok && envelope.ok === false && codes.includes(envelope.code as typeof codes[number])) {
        const code = envelope.code as typeof codes[number];
        if (response.status !== statuses[code]) throw new FlowError('INTERNAL_ERROR');
        throw new FlowError(code);
      }
      if (response.status !== 200 || !response.ok || envelope.ok !== true || !Object.hasOwn(envelope, 'data')) throw new FlowError('INTERNAL_ERROR');
      const result = parse(envelope.data);
      if (copiedSave) {
        const receipt = parseFieldDraftReceiptV3(envelope.data);
        if (receipt.draftRevision !== copiedSave.expectedRevision + 1 || receipt.savedParentRevision !== copiedSave.expectedFlowRevision || receipt.currentParentRevision !== copiedSave.expectedFlowRevision || JSON.stringify(receipt.definition) !== JSON.stringify(copiedSave.definition)) throw new FlowError('INTERNAL_ERROR');
      }
      check();
      return result;
    } catch (error) {
      if (at !== generation) throw new FlowError('UNAUTHENTICATED');
      if (error instanceof FlowError && codes.includes(error.code)) throw new FlowError(error.code);
      throw new FlowError('INTERNAL_ERROR');
    } finally {
      finished = true;
      clearTimeout(timer);
      active.delete(invalidate);
      cancelReader();
    }
  }
  return {
    invalidate() { generation++; for (const invalidate of active) invalidate(); },
    read: (token: string, tenantId: string, flowId: string): Promise<FieldDraftReadV3> => call(token, tenantId, flowId, parseFieldDraftReadV3),
    save: (token: string, tenantId: string, flowId: string, input: unknown): Promise<FieldDraftReceiptV3> => {
      if (allowLocalFieldDraftV3 !== true) return Promise.reject(new FlowError('NOT_AVAILABLE'));
      if (input === undefined) return Promise.reject(new FlowError('INVALID_REQUEST'));
      return call(token, tenantId, flowId, parseFieldDraftReceiptV3, input);
    },
  };
}
export type FieldDraftV3Client = ReturnType<typeof createFieldDraftV3Client>;
