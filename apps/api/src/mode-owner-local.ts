/** Owns two loopback listeners and their one bounded shutdown, with no import-time startup. */
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { createLocalModeOwnerComposition, type ModeOwnerComposition } from './mode-owner-composition';
import { createModeOwnerHttpServer, type ModeOwnerHttp } from './mode-owner-http';
import { createFlowHttpServer } from './http';
const nativeSet = setTimeout, nativeClear = clearTimeout, freeze = Object.freeze;
export interface ModeOwnerLocal {
    readonly localOwnerApi: string;
    readonly localDraftApi: string;
    close(): Promise<void>;
}
/** Private actual-harness seam: supplied composition still comes from the guarded real local factory. */
export async function __startModeOwnerLocalForTests({ composition, ownerHttp }: {
    composition: ModeOwnerComposition;
    ownerHttp?: ModeOwnerHttp;
}): Promise<ModeOwnerLocal> {
    let ownedOwner: ModeOwnerHttp, draft: Server;
    try {
        ownedOwner = ownerHttp ?? createModeOwnerHttpServer({ composition });
        draft = createFlowHttpServer({ repository: composition.draftRepository, authenticateOwner: composition.authenticateOwner, ownerOrigins: [composition.localPortalOrigin], customerOrigins: [] });
    }
    catch {
        try {
            await composition.close();
        }
        catch { }
        throw Error('MODE_OWNER_STARTUP_FAILED');
    }
    const servers = [ownedOwner.server, draft];
    const sockets = new Set<Socket>();
    let closing: Promise<void> | undefined, closed = false;
    for (const server of servers)
        server.on('connection', (socket: Socket) => {
            if (closed) {
                socket.destroy();
                return;
            }
            sockets.add(socket);
            socket.once('close', () => sockets.delete(socket));
        });
    const draftHandlers = draft.listeners('request');
    function close(): Promise<void> {
        if (closing)
            return closing;
        closed = true;
        closing = new Promise<void>(resolve => {
            let done = false;
            const finish = () => {
                if (done)
                    return;
                done = true;
                nativeClear(timer);
                for (const socket of sockets)
                    socket.destroy();
                sockets.clear();
                resolve();
            };
            const timer = nativeSet(finish, 10000);
            try {
                ownedOwner.stopAdmission();
            }
            catch { }
            // Remove only this owned listener's accepted request handlers before adding a rejection handler.
            for (const handler of draftHandlers)
                draft.removeListener('request', handler as any);
            draft.on('request', (_req, res) => { res.writeHead(503, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' }); res.end(); });
            const endings = servers.map(server => new Promise<void>(complete => {
                try {
                    server.close(() => complete());
                    server.closeIdleConnections();
                }
                catch {
                    complete();
                }
            }));
            try {
                endings.push(Promise.resolve(composition.close()));
            }
            catch {
                endings.push(Promise.resolve());
            }
            void Promise.allSettled(endings).then(finish);
        });
        return closing;
    }
    const listen = (server: Server, url: string) => new Promise<void>((resolve, reject) => {
        const failed = () => { server.removeListener('listening', ready); reject(Error('MODE_OWNER_STARTUP_FAILED')); };
        const ready = () => { server.removeListener('error', failed); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        try {
            server.listen(Number(new URL(url).port), '127.0.0.1');
        }
        catch {
            failed();
        }
    });
    try {
        await listen(ownedOwner.server, composition.localOwnerApi);
        await listen(draft, composition.localDraftApi);
    }
    catch {
        await close();
        throw Error('MODE_OWNER_STARTUP_FAILED');
    }
    // Unexpected runtime listener errors close only this owned composition; no error/credential logging.
    for (const server of servers)
        server.on('error', () => { void close(); });
    return freeze({ localOwnerApi: composition.localOwnerApi, localDraftApi: composition.localDraftApi, close });
}
export function startModeOwnerLocal(config: unknown): Promise<ModeOwnerLocal> { return __startModeOwnerLocalForTests({ composition: createLocalModeOwnerComposition(config) }); }
