import { parseInstallationRoute, type InstallationPolicy } from '@lumin/contracts';
import { createModePolicyTransport, modePolicyProfiles, type ModePolicyClock } from './modePolicyTransport';
export type ModeDocumentClock = ModePolicyClock;
export interface ModeDocumentOptions {
  profiles: unknown;
  fetch?: typeof globalThis.fetch;
  clock?: ModeDocumentClock;
  runtime?: Readonly<{controllerSha256: string}>;
}
export interface ModeDocumentHandler {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}
const encode = new TextEncoder();
const stringify = JSON.stringify;
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const freeze = Object.freeze;
function invalid(): never { throw Error('INVALID_MODE_DOCUMENT_CONFIGURATION'); }
const policies = ["default-src 'none'", "base-uri 'none'", "object-src 'none'", "script-src 'none'",
  "style-src 'none'", "img-src 'none'", "font-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"];
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function response(status: number, head: boolean, policy?: InstallationPolicy, runtime?: {controllerSha256: string}): Response {
  const message = status === 400 ? 'Invalid document request.' : status === 404 ? 'Booking experience unavailable.' :
    status === 405 ? 'Method not allowed.' : 'Booking experience is not available yet.';
  let bootstrap = '';
  if (policy) {
    const json = stringify({ schemaVersion: 1, kind: 'installation_document', operational: false, policy });
    if (encode.encode(json).byteLength > 17408) throw Error('DOCUMENT_LIMIT');
    bootstrap = `<template id="lumin-mode-bootstrap">${escapeText(json)}</template>`;
  }
  const executable = status === 200 && policy && runtime;
  const integrity = executable ? 'sha256-' + btoa(String.fromCharCode(...runtime.controllerSha256.match(/../g)!.map(pair => parseInt(pair, 16)))) : undefined;
  const script = executable ? `<script src="${escapeText(policy.rendererOrigin + '/assets/booking-lumin-controller.' + runtime.controllerSha256 + '.js')}" integrity="${integrity}" crossorigin="anonymous" defer></script>` : '';
  const documentPolicies = executable ? policies.map(value => value.startsWith('script-src ') ? `script-src '${integrity}'` :
    value.startsWith('connect-src ') ? `connect-src ${policy.apiOrigin}` : value) : policies;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Booking experience</title></head>' +
    `<body><main><h1>Booking experience</h1><p>${message}</p>${bootstrap}${script}</main></body></html>`;
  const bytes = encode.encode(html);
  if (bytes.byteLength > (status === 200 ? 32768 : 1024)) throw Error('DOCUMENT_LIMIT');
  const iframe = status === 200 && policy?.mode === 'iframe';
  const ancestors = iframe ? policy.allowedParentOrigins.join(' ') : "'none'";
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'no-store,max-age=0', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': [...documentPolicies, `frame-ancestors ${ancestors}`].join('; '),
  });
  if (!iframe) headers.set('X-Frame-Options', 'DENY');
  if (status === 405) headers.set('Allow', 'GET, HEAD');
  return new Response(head ? null : bytes, { status, headers });
}
/** Dedicated inert document only. No session runtime, legacy SPA fallback or Edge registration. */
export function createModeDocumentHandler(options: ModeDocumentOptions): ModeDocumentHandler {
  // Reflection may run Proxy traps; caught failures reject, accessors themselves are never read.
  let copied: Record<string, unknown>;
  try {
    if (!options || (prototype(options) !== Object.prototype && prototype(options) !== null)) invalid();
    const keys = ownKeys(options);
    if (keys.length > 4 || !keys.includes('profiles')) invalid();
    copied = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== 'string' || !['profiles', 'fetch', 'clock', 'runtime'].includes(key)) invalid();
      const d = descriptor(options, key);
      if (!d || !('value' in d) || !d.enumerable) invalid();
      copied[key] = d.value;
    }
  } catch { return invalid(); }
  const profiles = modePolicyProfiles(copied.profiles);
  const profile = profiles[0];
  let runtime: Readonly<{controllerSha256: string}> | undefined;
  if (copied.runtime !== undefined) {
    try {
      const value = copied.runtime;
      if (!value || typeof value !== 'object' || (prototype(value) !== Object.prototype && prototype(value) !== null) ||
        ownKeys(value).length !== 1) invalid();
      const d = descriptor(value, 'controllerSha256');
      if (!d || !d.enumerable || !('value' in d) || typeof d.value !== 'string' || !/^[0-9a-f]{64}$/.test(d.value)) invalid();
      runtime = freeze({controllerSha256: d.value});
    } catch { return invalid(); }
  }
  const transport = createModePolicyTransport<Response, boolean>({
    profiles, fetch: copied.fetch as typeof globalThis.fetch | undefined,
    clock: copied.clock as ModeDocumentClock | undefined, maxActive: 16,
    project: (outcome, head) => response(outcome.status, head, outcome.status === 200 ? outcome.policy : undefined, runtime),
  });
  async function handle(request: Request): Promise<Response> {
    const head = request.method === 'HEAD';
    let entry: number;
    try { entry = transport.sample(); } catch { return response(503, head); }
    if (transport.isClosed || !profile) return response(503, head);
    let route: ReturnType<typeof parseInstallationRoute>;
    try {
      const url = new URL(request.url);
      const target = request.url.slice(url.origin.length);
      if (url.origin !== profile.rendererOrigin || target.length > 256 || !/^[\x20-\x7e]+$/.test(target) ||
        /[?%#\\]/.test(target) || target.includes('//') || target.split('/').some(p => p === '.' || p === '..')) return response(400, head);
      try { route = parseInstallationRoute(target); }
      catch { return response(target.startsWith('/checkout/flow') || target.startsWith('/embed/flow') ? 400 : 404, head); }
      if (request.url !== profile.rendererOrigin + target) return response(400, head);
      if (request.method !== 'GET' && request.method !== 'HEAD') return response(405, head);
      const host = request.headers.get('host');
      if ((host !== null && host !== new URL(profile.rendererOrigin).host) || request.headers.has('cookie') ||
        request.headers.has('authorization') || request.headers.has('transfer-encoding') ||
        (request.headers.has('content-length') && request.headers.get('content-length') !== '0') || request.body !== null) return response(400, head);
    } catch { return response(400, head); }
    if (request.signal.aborted) return response(503, head);
    return transport.read(route, {signal: request.signal, entryTime: entry, context: head});
  }
  return freeze({handle, close: () => transport.close()});
}
