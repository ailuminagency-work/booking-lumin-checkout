import { listTemplates } from '@lumin/templates';

/** Owner-only transport. Availability is decided by the server's current registry and membership. */
export const TEMPLATE_KEYS: readonly string[] = Object.freeze(listTemplates().map(template => template.key));
export type TemplateKey = string;
export type AdoptionReceipt = Readonly<{ serviceId: string; templateKey: TemplateKey; active: false }>;
export type AdoptionErrorCode = 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE' | 'DEADLINE' | 'INTERNAL_ERROR' | 'COMMIT_UNCERTAIN' | 'OUTCOME_UNKNOWN';
export class TemplateAdoptionError extends Error {
  constructor(readonly code: AdoptionErrorCode) { super(code === 'COMMIT_UNCERTAIN' || code === 'OUTCOME_UNKNOWN' ? 'The result is uncertain. Check the draft or retry only with the same key.' : 'The service template could not be added.'); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_BYTES = 8192;
const DEADLINE_MS = 15000;
const encoder = new TextEncoder();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const typedArrayOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const statuses: Partial<Record<AdoptionErrorCode, number>> = { INVALID_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, CONFLICT: 409, UNAVAILABLE: 404, DEADLINE: 503, INTERNAL_ERROR: 500 };

function plain(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value: Record<string, unknown>, names: string[]) { return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)); }

/** The caller retains the idempotency key across explicit retries. This client never generates or rotates it. */
export function createTemplateAdoptionClient(base: string, localHarness = false, fetcher: typeof fetch = fetch) {
  let url: URL;
  try { url = new URL(base); } catch { throw new TemplateAdoptionError('INVALID_REQUEST'); }
  if (url.origin !== base || url.username || url.password || !(url.protocol === 'https:' || (localHarness && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new TemplateAdoptionError('INVALID_REQUEST');
  let generation = 0;
  const active = new Set<() => void>();
  return {
    invalidate() { generation++; for (const stop of [...active]) stop(); },
    async adopt(token: string, tenantId: string, templateKey: TemplateKey, idempotencyKey: string): Promise<AdoptionReceipt> {
      if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /[^A-Za-z0-9._~-]/.test(token)) throw new TemplateAdoptionError('UNAUTHENTICATED');
      if (typeof tenantId !== 'string' || !UUID.test(tenantId) || typeof templateKey !== 'string' || !TEMPLATE_KEYS.includes(templateKey) || typeof idempotencyKey !== 'string' || !IDEMPOTENCY.test(idempotencyKey)) throw new TemplateAdoptionError('INVALID_REQUEST');
      const body = JSON.stringify({ key: templateKey, idempotencyKey });
      if (encoder.encode(body).byteLength > 512) throw new TemplateAdoptionError('INVALID_REQUEST');
      const at = generation;
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let stopped: AdoptionErrorCode | undefined;
      let finished = false;
      let cancelStarted = false;
      let rejectStop!: (error: TemplateAdoptionError) => void;
      const interrupted = new Promise<never>((_, reject) => { rejectStop = reject; });
      void interrupted.catch(() => undefined);
      const cancelReader = () => { if (reader && !cancelStarted) { cancelStarted = true; try { void reader.cancel().catch(() => undefined); } catch { /* cleanup cannot alter outcome */ } } };
      const stop = (code: AdoptionErrorCode) => { if (stopped || finished) return; stopped = code; rejectStop(new TemplateAdoptionError(code)); controller.abort(); cancelReader(); };
      const invalidate = () => stop('OUTCOME_UNKNOWN');
      active.add(invalidate);
      const started = performance.now();
      const timer = setTimeout(() => stop('OUTCOME_UNKNOWN'), DEADLINE_MS);
      const check = () => {
        if (at !== generation) stop('OUTCOME_UNKNOWN');
        const elapsed = performance.now() - started;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= DEADLINE_MS) stop('OUTCOME_UNKNOWN');
        if (stopped) throw new TemplateAdoptionError(stopped);
      };
      try {
        const fetching = Promise.resolve(fetcher(base + '/api/service-templates/adopt?tenantId=' + encodeURIComponent(tenantId), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body,
          signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        })).then(response => {
          if (stopped || finished) { try { void response.body?.cancel().catch(() => undefined); } catch { /* late body */ } }
          return response;
        });
        const response = await Promise.race([fetching, interrupted]);
        check();
        if (response.redirected || !response.body) throw new TemplateAdoptionError('OUTCOME_UNKNOWN');
        reader = response.body.getReader();
        const bytes = new Uint8Array(MAX_BYTES); let size = 0;
        try {
          for (;;) {
            check();
            const chunk = await Promise.race([reader.read(), interrupted]);
            check();
            if (chunk.done) break;
            let length: number, buffer: ArrayBuffer, offset: number;
            try {
              if (!ArrayBuffer.isView(chunk.value) || typedArrayTag?.call(chunk.value) !== 'Uint8Array') throw Error();
              length = typedArrayByteLength!.call(chunk.value) as number;
              buffer = typedArrayBuffer!.call(chunk.value) as ArrayBuffer;
              offset = typedArrayOffset!.call(chunk.value) as number;
              if (!Number.isSafeInteger(length) || length > MAX_BYTES - size) throw Error();
              bytes.set(new Uint8Array(buffer, offset, length), size); size += length;
            } catch { throw new TemplateAdoptionError('OUTCOME_UNKNOWN'); }
          }
        } finally { cancelReader(); try { reader.releaseLock(); } catch { /* pending read */ } }
        check();
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
        if (!plain(value)) throw new TemplateAdoptionError('OUTCOME_UNKNOWN');
        if (response.status === 503 && keys(value, ['ok', 'code', 'reconciliation']) && value.ok === false && value.code === 'COMMIT_UNCERTAIN' && value.reconciliation === 'RETRY_WITH_SAME_KEY_ONLY') throw new TemplateAdoptionError('COMMIT_UNCERTAIN');
        if (value.ok === false && keys(value, ['ok', 'code']) && typeof value.code === 'string' && Object.hasOwn(statuses, value.code) && statuses[value.code as AdoptionErrorCode] === response.status) throw new TemplateAdoptionError(value.code as AdoptionErrorCode);
        if (!response.ok || response.status !== 200 || !keys(value, ['ok', 'data']) || value.ok !== true || !plain(value.data)) throw new TemplateAdoptionError('OUTCOME_UNKNOWN');
        const data = value.data;
        if (!keys(data, ['serviceId', 'templateKey', 'active']) || typeof data.serviceId !== 'string' || !UUID.test(data.serviceId) || data.templateKey !== templateKey || data.active !== false) throw new TemplateAdoptionError('OUTCOME_UNKNOWN');
        check();
        return Object.freeze({ serviceId: data.serviceId, templateKey, active: false });
      } catch (error) {
        if (stopped || at !== generation) throw new TemplateAdoptionError(stopped ?? 'OUTCOME_UNKNOWN');
        if (error instanceof TemplateAdoptionError) throw error;
        throw new TemplateAdoptionError('OUTCOME_UNKNOWN');
      } finally { finished = true; clearTimeout(timer); active.delete(invalidate); cancelReader(); }
    },
  };
}
