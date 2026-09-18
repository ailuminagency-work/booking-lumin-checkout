import { afterEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createFlowHttpServer } from '../server/http';
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flow = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerOrigin = 'https://owner.example.test';
const definition = { schemaVersion: 1, fields: [{ key: 'notes', kind: 'text', required: false, minLength: 0, maxLength: 100, prompt: 'Anything we should know?' }] };
const payload = { textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: 0, expectedFlowRevision: 1, definition };
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
async function start(allow?: boolean) {
  const call = vi.fn(async () => ({ textDraftVersion: 1, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 1, currentParentRevision: 1, definition, runtimePublishable: false }));
  const server = createFlowHttpServer({ repository: { call: vi.fn() }, textFieldDraftRepository: { call }, allowLocalTextPromptWrites: allow,
    authenticateOwner: async () => actor, ownerOrigins: [ownerOrigin], customerOrigins: [] });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const send = (body: unknown = payload) => fetch(`http://127.0.0.1:${port}/api/text-field-drafts/${flow}?tenantId=${tenant}`, {
    method: 'POST', headers: { Origin: ownerOrigin, Authorization: 'Bearer synthetic-owner-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  return { call, send };
}
it.each([undefined, false])('keeps prompt writes disabled without explicit server capability (%s)', async allow => {
  const { call, send } = await start(allow);
  const response = await send();
  expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: 'UNSUPPORTED_CONFIG' }); expect(call).not.toHaveBeenCalled();
});
it('does not accept the capability from request data', async () => {
  const { call, send } = await start();
  const response = await send({ ...payload, allowLocalPromptWrites: true });
  expect(response.status).toBe(400); expect(call).not.toHaveBeenCalled();
});
it('allows an explicitly coordinated local composition to send the exact prompted definition', async () => {
  const { call, send } = await start(true);
  const response = await send(); expect(response.status).toBe(200);
  expect(call).toHaveBeenCalledExactlyOnceWith('save_text_field_draft', [actor, tenant, flow, 0, 1, definition]);
  expect((await response.json()).data.definition).toEqual(definition);
});
