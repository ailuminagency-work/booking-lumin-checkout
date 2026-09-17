import { afterEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createFlowHttpServer } from '../server/http';
import { LOCAL_FIXTURE as F, localIdentity } from '../server/fixtures';
import { FlowError } from '../server/repository';

const flow = '33333333-3333-4333-8333-333333333333';
const definition = { schemaVersion: 1, fields: [{ key: 'notes', kind: 'text', required: false, minLength: 0, maxLength: 100 }] };
const save = { textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: 0, expectedFlowRevision: 1, definition };
const receipt = { textDraftVersion: 1, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 1, currentParentRevision: 1, definition, runtimePublishable: false };
const missing = { status: 'missing', textDraftVersion: 1, parentAuthoringVersion: 2, currentParentRevision: 1, runtimePublishable: false };
const ownerHeaders = { Origin: F.ownerOrigin, Authorization: `Bearer ${F.ownerToken}`, 'Content-Type': 'application/json' };
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
async function start(value: unknown = missing, options: { omitRepository?: boolean; auth?: (token: string) => Promise<string | null> } = {}) {
  const call = vi.fn(async (_name: string, _params: readonly unknown[]) => value);
  const legacy = vi.fn(async () => ({ services: [] }));
  const auth = vi.fn(options.auth ?? localIdentity);
  const server = createFlowHttpServer({ repository: { call: legacy }, authenticateOwner: auth,
    ownerOrigins: [F.ownerOrigin], customerOrigins: [F.customerOrigin],
    ...(options.omitRepository ? {} : { textFieldDraftRepository: { call } }),
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Expected loopback address');
  const base = `http://127.0.0.1:${address.port}`;
  return { base, url: `${base}/api/text-field-drafts/${flow}?tenantId=${F.tenantA}`, call, legacy, auth };
}
it('composes GET through owner authentication and exact tenant tuple without legacy dispatch', async () => {
  const h = await start(); const response = await fetch(h.url, { headers: ownerHeaders });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, data: missing });
  expect(h.auth).toHaveBeenCalledExactlyOnceWith(F.ownerToken);
  expect(h.call).toHaveBeenCalledExactlyOnceWith('get_text_field_draft', [F.ownerA, F.tenantA, flow]);
  expect(h.legacy).not.toHaveBeenCalled();
  expect(response.headers.get('access-control-allow-origin')).toBe(F.ownerOrigin);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('connection')).toBe('close');
});
it('composes POST using only server-verified actor and validated raw receipt', async () => {
  const h = await start(receipt); const response = await fetch(h.url, { method: 'POST', headers: ownerHeaders, body: JSON.stringify(save) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, data: receipt });
  expect(h.call).toHaveBeenCalledExactlyOnceWith('save_text_field_draft', [F.ownerA, F.tenantA, flow, 0, 1, definition]);
  expect(h.auth).toHaveBeenCalledTimes(1); expect(h.legacy).not.toHaveBeenCalled();
});
it('sends present stale data without adding a derived stale wire property', async () => {
  const data = { status: 'present', receipt: { ...receipt, currentParentRevision: 2 } };
  const h = await start(data); const response = await fetch(h.url, { headers: ownerHeaders });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, data });
});
it('keeps route unavailable without its explicit dependency and preserves legacy services', async () => {
  const h = await start(missing, { omitRepository: true });
  const response = await fetch(h.url, { headers: ownerHeaders });
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
  expect(h.call).not.toHaveBeenCalled(); expect(h.legacy).not.toHaveBeenCalled();
  const legacy = await fetch(h.base + '/api/services?tenantId=' + F.tenantA, { headers: ownerHeaders });
  expect(legacy.status).toBe(200); expect(await legacy.json()).toEqual({ ok: true, data: { services: [] } });
  expect(h.legacy).toHaveBeenCalledExactlyOnceWith('flow_owner_services', [F.ownerA, F.tenantA]);
});
it.each([F.customerOrigin, 'https://untrusted.example'])('rejects non-owner origin %s before authentication or repository work', async origin => {
  const h = await start(); const response = await fetch(h.url, { headers: { ...ownerHeaders, Origin: origin } });
  expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(h.auth).not.toHaveBeenCalled(); expect(h.call).not.toHaveBeenCalled();
});
it('handles owner OPTIONS without authentication and refuses customer preflight', async () => {
  const h = await start();
  for (const origin of [F.ownerOrigin, F.customerOrigin]) {
    const response = await fetch(h.url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
    expect(response.status).toBe(origin === F.ownerOrigin ? 204 : 403);
    await response.text();
  }
  expect(h.auth).not.toHaveBeenCalled(); expect(h.call).not.toHaveBeenCalled();
});
it('rejects duplicate selectors and supplied actor authority without invoking repository', async () => {
  const h = await start();
  for (const suffix of ['&tenantId=' + F.tenantA, '&actorId=' + F.ownerB]) {
    const response = await fetch(h.url + suffix, { headers: ownerHeaders });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, code: 'INVALID_REQUEST' });
  }
  expect(h.call).not.toHaveBeenCalled();
});
it.each(['null', 'rejection'])('rejects %s authentication with a finite safe error', async mode => {
  const h = await start(missing, { auth: async () => { if (mode === 'rejection') throw Error('private authentication details'); return null; } });
  const response = await fetch(h.url, { headers: ownerHeaders });
  expect(response.status).toBe(401); expect(await response.json()).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  expect(h.call).not.toHaveBeenCalled();
});
it('rejects absent credentials before authentication callback', async () => {
  const h = await start(); const response = await fetch(h.url, { headers: { Origin: F.ownerOrigin } });
  expect(response.status).toBe(401); await response.text();
  expect(h.auth).not.toHaveBeenCalled(); expect(h.call).not.toHaveBeenCalled();
});
it.each(['{', ' '.repeat(32769), JSON.stringify({ ...save, actorId: F.ownerB })])('rejects malformed, oversized or authority-bearing request without dispatch', async body => {
  const h = await start(receipt); const response = await fetch(h.url, { method: 'POST', headers: ownerHeaders, body });
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, code: 'INVALID_REQUEST' });
  expect(h.call).not.toHaveBeenCalled();
});
it('maps repository conflict and unexpected error without leaking details or retrying', async () => {
  for (const error of [new FlowError('CONFLICT'), new Error('private database details')]) {
    const h = await start(receipt); h.call.mockRejectedValue(error);
    const response = await fetch(h.url, { method: 'POST', headers: ownerHeaders, body: JSON.stringify(save) });
    expect(response.status).toBe(error instanceof FlowError ? 409 : 500);
    expect(await response.json()).toEqual({ ok: false, code: error instanceof FlowError ? 'CONFLICT' : 'INTERNAL_ERROR' });
    expect(h.call).toHaveBeenCalledTimes(1);
  }
});
