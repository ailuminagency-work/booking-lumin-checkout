/** Identity evidence only. Owner operations still require the current-session DB fence. */
export type IdentityEvidence = Readonly<{ userId: string; sessionId: string; expiresAt: string }>;
export type SupabaseAuthConfig = Readonly<{ projectUrl: string; publicKey: string }>;
const FAILURE = 'AUTHENTICATION_FAILED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error(FAILURE); };
const object = (v: unknown): Record<string, unknown> => {
 if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
 return v as Record<string, unknown>;
};
// JSON.parse alone silently accepts duplicate authority keys, including escaped keys.
function json(text: string): unknown {
 let i = 0;
 const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
 const string = (): string => {
  const start = i++;
  while (i < text.length) {
   if (text[i] === '\\') { i += 2; continue; }
   if (text[i++] === '"') return JSON.parse(text.slice(start, i)) as string;
  }
  return fail();
 };
 const value = (depth: number): void => {
  if (depth > 32) fail(); ws();
  if (text[i] === '{') {
   i++; ws(); const keys = new Set<string>();
   if (text[i] === '}') { i++; return; }
   for (;;) {
    ws(); if (text[i] !== '"') fail(); const key = string();
    if (keys.has(key)) fail(); keys.add(key); ws(); if (text[i++] !== ':') fail();
    value(depth + 1); ws(); const c = text[i++]; if (c === '}') return; if (c !== ',') fail();
   }
  }
  if (text[i] === '[') {
   i++; ws(); if (text[i] === ']') { i++; return; }
   for (;;) { value(depth + 1); ws(); const c = text[i++]; if (c === ']') return; if (c !== ',') fail(); }
  }
  if (text[i] === '"') { string(); return; }
  const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
  if (!match) fail(); i += match![0].length;
 };
 value(0); ws(); if (i !== text.length) fail(); return JSON.parse(text) as unknown;
}
function segment(s: string): Record<string, unknown> {
 if (!/^[A-Za-z0-9_-]+$/.test(s)) return fail();
 const bytes = Buffer.from(s, 'base64url');
 if (bytes.toString('base64url') !== s) return fail();
 return object(json(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
function jwt(token: string): Record<string, unknown> {
 if (typeof token !== 'string' || token.length > 4096) return fail();
 const parts = token.split('.'); if (parts.length !== 3) return fail();
 const header = segment(parts[0]!);
 if (!['HS256', 'RS256', 'ES256'].includes(header.alg as string) || (header.typ !== undefined && header.typ !== 'JWT') || header.crit !== undefined || header.b64 !== undefined) return fail();
 if (!/^[A-Za-z0-9_-]+$/.test(parts[2]!) || Buffer.from(parts[2]!, 'base64url').toString('base64url') !== parts[2]) return fail();
 return segment(parts[1]!);
}
function fresh(claims: Record<string, unknown>, now: number): number {
 const exp = claims.exp;
 if (!Number.isFinite(now) || !Number.isSafeInteger(exp) || (exp as number) <= 0 || (exp as number) > 253402300799 || (exp as number) * 1000 <= now) return fail();
 if (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) <= 0 || (claims.nbf as number) * 1000 > now)) return fail();
 return exp as number;
}
export function createSupabaseIdentityVerifier(config: SupabaseAuthConfig, dependencies: { fetch?: typeof fetch; now?: () => number } = {}): (bearer: string) => Promise<IdentityEvidence> {
 let endpoint: string;
 const publicKey = config.publicKey;
 try {
  const url = new URL(config.projectUrl);
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.projectUrl) || url.origin !== config.projectUrl) fail();
  if (typeof publicKey !== 'string' || publicKey.length > 4096) fail();
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(publicKey)) {
   const key = jwt(publicKey); if (key.role !== 'anon' || key.ref !== url.hostname.split('.')[0]) fail();
  }
  endpoint = `${url.origin}/auth/v1/user`;
 } catch { throw new Error('INVALID_AUTH_CONFIGURATION'); }
 const issuer = `${config.projectUrl}/auth/v1`;
 const request = dependencies.fetch ?? globalThis.fetch;
 const now = dependencies.now ?? Date.now;
 return async (bearer: string): Promise<IdentityEvidence> => {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
   const claims = jwt(bearer);
   if (claims.iss !== issuer || claims.aud !== 'authenticated' || claims.is_anonymous !== false || typeof claims.sub !== 'string' || !UUID.test(claims.sub) || typeof claims.session_id !== 'string' || !UUID.test(claims.session_id)) fail();
   fresh(claims, now());
   const deadline = now() + 5000;
   const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(FAILURE)); }, 5000); });
   const work = async (): Promise<IdentityEvidence> => {
    const response = await request(endpoint, { method: 'GET', headers: { 'Accept-Encoding': 'identity', apikey: publicKey, Authorization: `Bearer ${bearer}` }, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (controller.signal.aborted || now() >= deadline) { void response.body?.cancel().catch(() => {}); fail(); }
    if (response.status !== 200 || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || (response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity')) { void response.body?.cancel().catch(() => {}); fail(); }
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) { void response.body?.cancel().catch(() => {}); fail(); }
    if (!response.body) fail(); reader = response.body!.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const chunk = await reader.read(); if (controller.signal.aborted || now() >= deadline) fail(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 65536 || chunks.length >= 65536) fail(); chunks.push(chunk.value); }
    const body = object(json(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if (typeof body.id !== 'string' || !UUID.test(body.id) || body.id.toLowerCase() !== (claims.sub as string).toLowerCase() || body.is_anonymous !== false) fail();
    const time = now(); if (time >= deadline) fail(); const exp = fresh(claims, time);
    return Object.freeze({ userId: (body.id as string).toLowerCase(), sessionId: (claims.session_id as string).toLowerCase(), expiresAt: new Date(exp * 1000).toISOString() });
   };
   return await Promise.race([work(), timeout]);
  } catch { return fail(); }
  finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); if (reader) void reader.cancel().catch(() => {}); }
 };
}