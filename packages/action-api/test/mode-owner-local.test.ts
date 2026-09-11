import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import { __startModeOwnerLocalForTests } from '../server/mode-owner-local';
const id = '00000000-0000-0000-0000-000000000001';
async function bound(): Promise<{
    server: Server;
    port: number;
}> { const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return { server, port: (server.address() as any).port }; }
const stop = (server: Server) => new Promise<void>(r => server.close(() => r()));
async function fixture() { const a = await bound(), d = await bound(); await Promise.all([stop(a.server), stop(d.server)]); const composition: any = { localOwnerApi: 'http://127.0.0.1:' + a.port, localDraftApi: 'http://127.0.0.1:' + d.port, localPortalOrigin: 'http://127.0.0.1:5174', profiles: [], profile: null, owner: {}, draftRepository: { call: vi.fn(async () => ({ services: [] })) }, authenticateOwner: vi.fn(async () => id), close: vi.fn(async () => { }) }; return { composition, a: a.port, d: d.port }; }
describe('owned two-listener lifecycle', () => {
    it('starts both explicit loopback endpoints and closes once', async () => { const f = await fixture(), local = await __startModeOwnerLocalForTests({ composition: f.composition }); const headers = { Origin: f.composition.localPortalOrigin, Authorization: 'Bearer synthetic-owner-token' }; const profile = await fetch(local.localOwnerApi + '/api/local/mode-owner/profile', { headers }); expect(profile.status).toBe(200); const services = await fetch(local.localDraftApi + '/api/services?tenantId=' + id, { headers }); expect(services.status).toBe(200); const a = local.close(), b = local.close(); expect(a).toBe(b); await a; expect(f.composition.close).toHaveBeenCalledTimes(1); });
    it('failed second bind closes first listener and composition without retry', async () => { const f = await fixture(), occupied = createServer(); await new Promise<void>(r => occupied.listen(f.d, '127.0.0.1', r)); try {
        await expect(__startModeOwnerLocalForTests({ composition: f.composition })).rejects.toThrow('MODE_OWNER_STARTUP_FAILED');
        expect(f.composition.close).toHaveBeenCalledTimes(1);
        const proof = createServer();
        await new Promise<void>((resolve, reject) => { proof.once('error', reject); proof.listen(f.a, '127.0.0.1', resolve); });
        await stop(proof);
    }
    finally {
        await stop(occupied);
    } });
    it('startup construction failure consumes composition cleanup', async () => { const f = await fixture(); f.composition.profiles = [{}]; await expect(__startModeOwnerLocalForTests({ composition: f.composition })).rejects.toThrow('MODE_OWNER_STARTUP_FAILED'); expect(f.composition.close).toHaveBeenCalledTimes(1); });
    it('one10s close deadline destroys a partial draft body and consumes stalled pool close', async () => { const f = await fixture(); let end!: (v: void) => void; f.composition.close = vi.fn(() => new Promise<void>(r => end = r)); const local = await __startModeOwnerLocalForTests({ composition: f.composition }), socket = createConnection({ host: '127.0.0.1', port: f.d }); socket.on('error', () => { }); await new Promise<void>(r => socket.once('connect', r)); socket.write('POST /api/flows/' + id + '/draft?tenantId=' + id + ' HTTP/1.1\r\nHost: 127.0.0.1:' + f.d + '\r\nOrigin: ' + f.composition.localPortalOrigin + '\r\nAuthorization: Bearer synthetic-owner-token\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{'); const closed = new Promise<void>(r => socket.once('close', () => r())); await new Promise(r => setTimeout(r, 20)); const start = Date.now(); await local.close(); expect(Date.now() - start).toBeGreaterThanOrEqual(9900); expect(Date.now() - start).toBeLessThan(12000); await closed; expect(f.composition.close).toHaveBeenCalledTimes(1); end(); }, 15000);
});
