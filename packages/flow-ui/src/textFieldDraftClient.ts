import { parseTextFieldDraftRead, parseTextFieldDraftReceipt, parseTextFieldDraftSave, type TextFieldDraftRead, type TextFieldDraftReceipt } from '@lumin/workflow';
import { FlowError } from './client';

const LIMIT = 32768;
const REQUEST_TIMEOUT_MS = 15000;
const codes = ['INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'CONFLICT', 'NOT_AVAILABLE', 'UNSUPPORTED_CONFIG', 'INTERNAL_ERROR', 'RATE_LIMITED'] as const;

/** Owner draft transport only. Tenant is an untrusted selector; the server verifies
 * actor membership. Call invalidate() whenever the account or tenant context changes. */
export function createTextFieldDraftClient(base: string, localHarness = false, fetcher: typeof fetch = fetch) {
  let url: URL;
  try { url = new URL(base); } catch { throw new FlowError('INVALID_REQUEST'); }
  if (url.origin !== base || url.username || url.password || !(url.protocol === 'https:' || (localHarness && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new FlowError('INVALID_REQUEST');
  let generation = 0;
  const active = new Set<() => void>();

  async function call<T>(token: string, tenantId: string, flowId: string, parse: (value: unknown) => T, input?: unknown): Promise<T> {
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /[^A-Za-z0-9._~-]/.test(token)) throw new FlowError('UNAUTHENTICATED');
    if (typeof flowId !== 'string' || flowId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowId)) throw new FlowError('INVALID_REQUEST');
    if (typeof tenantId !== 'string' || tenantId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new FlowError('INVALID_REQUEST');
    let body: string | undefined;
    if (input !== undefined) {
      try {
        body = JSON.stringify(parseTextFieldDraftSave(input));
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
      const fetching = Promise.resolve(fetcher(base + '/api/text-field-drafts/' + encodeURIComponent(flowId) + '?tenantId=' + encodeURIComponent(tenantId), {
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
      check();
      const buffer = new Uint8Array(LIMIT);
      let size = 0;
      try {
        for (;;) {
          check();
          const chunk = await Promise.race([reader.read(), interrupted]);
          check();
          if (chunk.done) break;
          if (chunk.value.byteLength > LIMIT - size) {
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
      if (!response.ok && envelope.ok === false && codes.includes(envelope.code as typeof codes[number])) throw new FlowError(envelope.code as typeof codes[number]);
      if (!response.ok || envelope.ok !== true || !Object.hasOwn(envelope, 'data')) throw new FlowError('INTERNAL_ERROR');
      const result = parse(envelope.data);
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
    read: (token: string, tenantId: string, flowId: string): Promise<TextFieldDraftRead> => call(token, tenantId, flowId, parseTextFieldDraftRead),
    save: (token: string, tenantId: string, flowId: string, input: unknown): Promise<TextFieldDraftReceipt> => {
      if (input === undefined) return Promise.reject(new FlowError('INVALID_REQUEST'));
      return call(token, tenantId, flowId, parseTextFieldDraftReceipt, input);
    },
  };
}
export type TextFieldDraftClient = ReturnType<typeof createTextFieldDraftClient>;
