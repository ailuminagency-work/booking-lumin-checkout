/** Explicit disposable local composition; never a production authentication or deployment factory. */
import { Pool, type PoolConfig } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { __createModeInstallationRepositoryForTests, type ModeInstallationRepository, type ModePool } from './mode-installation-repository';
import { createModeContracts, modeRecord } from './mode-installation-contracts';
import { __createModeSessionRepositoryForTests, type ModeSessionRepository } from './mode-session-repository';
import { copySessionValue, createModeSessionContracts, sessionUuid } from './mode-session-contracts';
import { createFlowRepository, FlowError, type FlowRepository } from './repository';
import type { InstallationProfile } from '@lumin/contracts';
const freeze = Object.freeze, from = Buffer.from.bind(Buffer), compare = timingSafeEqual, nativeSet = setTimeout, nativeClear = clearTimeout;
export type ModeOwnerMethods = Pick<ModeInstallationRepository, 'publish' | 'install' | 'applyVersion' | 'updatePolicy' | 'ownerInstallations' | 'ownerHistory' | 'ownerOperation'> & {
    requestHistory: ModeSessionRepository['ownerHistory'];
};
export interface ModeOwnerComposition {
    readonly owner: ModeOwnerMethods;
    readonly draftRepository: FlowRepository;
    readonly localOwnerApi: string;
    readonly localDraftApi: string;
    readonly localPortalOrigin: string;
    readonly profile: InstallationProfile | null;
    readonly profiles: readonly InstallationProfile[];
    authenticateOwner(credential: string): Promise<string | null>;
    close(): Promise<void>;
}
export type ModeOwnerCompositionConfig = {
    profiles: unknown;
    credentials: unknown;
    localPortalOrigin: string;
};
export type ModeOwnerPoolFactory = (config: PoolConfig) => ModePool;
const invalid = (): never => { throw Error('EXPLICIT_LOCAL_MODE_OWNER_REQUIRED'); };
function port(value: unknown, min: number): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,4}$/.test(value) || Number(value) < min || Number(value) > 65535)
        invalid();
    return Number(value);
}
function boundedEnd(pool: ModePool): Promise<void> {
    return new Promise(resolve => {
        let done = false;
        const timer = nativeSet(finish, 10000);
        function finish() {
            if (done)
                return;
            done = true;
            nativeClear(timer);
            resolve();
        }
        try {
            Promise.resolve(pool.end()).then(finish, finish);
        }
        catch {
            finish();
        }
    });
}
/** Private controlled composition seam; the public factory below never accepts environment/pool overrides. */
export function __createModeOwnerCompositionForTests(config: unknown, { poolFactory, environment }: {
    poolFactory: ModeOwnerPoolFactory;
    environment: NodeJS.ProcessEnv;
}): ModeOwnerComposition {
    const c = modeRecord(config, ['profiles', 'credentials', 'localPortalOrigin']);
    const profiles = copySessionValue(c.profiles, { depth: 2, nodes: 16, props: 5, array: 1, string: 512, bytes: 4096 }) as InstallationProfile[];
    if (!Array.isArray(profiles))
        invalid();
    createModeContracts(profiles);
    createModeSessionContracts(profiles);
    const credentials = copySessionValue(c.credentials, { depth: 2, nodes: 49, props: 2, array: 16, string: 256, bytes: 8192 });
    if (!Array.isArray(credentials))
        invalid();
    const identities = new Map<string, string>();
    for (const entry of credentials) {
        const r = modeRecord(entry, ['credential', 'userId']);
        if (typeof r.credential !== 'string' || !/^[A-Za-z0-9._~-]{16,256}$/.test(r.credential) || identities.has(r.credential))
            invalid();
        sessionUuid(r.userId);
        identities.set(r.credential as string, r.userId);
    }
    const env = environment;
    for (const name of ['LOCAL_HARNESS', 'FLOW_TEST_DISPOSABLE', 'MODE_INSTALLATIONS_TEST_DISPOSABLE', 'MODE_SESSIONS_TEST_DISPOSABLE', 'MODE_OWNER_TEST_DISPOSABLE'])
        if (env[name] !== '1')
            invalid();
    const host = env.PGHOST, database = env.PGDATABASE, password = env.PGPASSWORD ?? '', pgPort = port(env.PGPORT, 1), ownerPort = port(env.MODE_OWNER_API_PORT, 1024), draftPort = port(env.MODE_OWNER_DRAFT_PORT, 1024);
    if (!['127.0.0.1', 'localhost'].includes(host ?? '') || env.PGUSER !== 'postgres' || !database || database.length > 63 || !/^lumin_mode_owner_journey_[a-z0-9_]+$/.test(database) || !['', 'postgres'].includes(password) || ['DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'].some(k => Boolean(env[k])) || ownerPort === draftPort)
        invalid();
    if (typeof c.localPortalOrigin !== 'string' || c.localPortalOrigin.length > 300)
        invalid();
    let portal: URL;
    try {
        portal = new URL(c.localPortalOrigin as string);
    }
    catch {
        return invalid();
    }
    const portalPort = port(portal.port, 1024);
    if (portal.origin !== c.localPortalOrigin || !((portal.protocol === 'http:' && portal.hostname === '127.0.0.1') || (portal.protocol === 'https:' && portal.hostname === 'localhost')) || [ownerPort, draftPort].includes(portalPort))
        invalid();
    const localOwnerApi = 'http://127.0.0.1:' + ownerPort, localDraftApi = 'http://127.0.0.1:' + draftPort, localPortalOrigin = c.localPortalOrigin as string;
    if (profiles.some(p => [p.rendererOrigin, p.apiOrigin, p.portalOrigin].some(o => [localOwnerApi, localDraftApi, localPortalOrigin].includes(o))))
        invalid();
    const fixedPassword = () => password;
    const base: PoolConfig = { host, port: pgPort, user: 'postgres', database, password: fixedPassword, ssl: false, pipeline: false, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 5000, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, query_timeout: 0 };
    const created: ModePool[] = [];
    let installations: ModeInstallationRepository, sessions: ModeSessionRepository, draft: FlowRepository;
    try {
        const make = (name: string) => { const pool = poolFactory({ ...base, application_name: name }); created.push(pool); pool.on('error', () => { }); return pool; };
        installations = __createModeInstallationRepositoryForTests({ pool: make('mode-owner-installations-local'), profiles });
        sessions = __createModeSessionRepositoryForTests({ pool: make('mode-owner-sessions-local'), profiles });
        draft = createFlowRepository(make('mode-owner-drafts-local') as Pool);
    }
    catch {
        for (const pool of created)
            void boundedEnd(pool);
        throw Error('MODE_OWNER_STARTUP_FAILED');
    }
    const allowed = new Set(['flow_owner_services', 'flow_owner_list', 'flow_owner_configurable_list', 'flow_owner_draft', 'get_configurable_flow_draft', 'save_bound_flow_draft', 'save_configurable_flow_draft']);
    let closed = false, closing: Promise<void> | undefined;
    const owner: ModeOwnerMethods = freeze({ publish: installations.publish, install: installations.install, applyVersion: installations.applyVersion, updatePolicy: installations.updatePolicy, ownerInstallations: installations.ownerInstallations, ownerHistory: installations.ownerHistory, ownerOperation: installations.ownerOperation, requestHistory: sessions.ownerHistory });
    return freeze({ owner, localOwnerApi, localDraftApi, localPortalOrigin, profile: profiles[0] ?? null, profiles: freeze(profiles),
        draftRepository: freeze({ call(name, params) {
                if (closed || !allowed.has(name))
                    return Promise.reject(new FlowError('NOT_AVAILABLE'));
                return draft.call(name, params);
            } } as FlowRepository),
        async authenticateOwner(credential: string) {
            if (closed || typeof credential !== 'string' || !/^[A-Za-z0-9._~-]{16,256}$/.test(credential))
                return null;
            const candidate = from(credential, 'utf8');
            let match: string | null = null;
            for (const [secret, id] of identities) {
                const expected = from(secret, 'utf8');
                if (candidate.length === expected.length && compare(candidate, expected))
                    match = id;
            }
            return match;
        },
        close() {
            if (closing)
                return closing;
            closed = true;
            identities.clear();
            closing = Promise.allSettled([installations.close(), sessions.close(), boundedEnd(created[2]!)]).then(() => { });
            return closing;
        }
    });
}
export function createLocalModeOwnerComposition(config: unknown): ModeOwnerComposition {
    // Capture only relevant environment fields; no per-request mutation or hosted fallback.
    const environment: NodeJS.ProcessEnv = {};
    for (const k of ['LOCAL_HARNESS', 'FLOW_TEST_DISPOSABLE', 'MODE_INSTALLATIONS_TEST_DISPOSABLE', 'MODE_SESSIONS_TEST_DISPOSABLE', 'MODE_OWNER_TEST_DISPOSABLE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'MODE_OWNER_API_PORT', 'MODE_OWNER_DRAFT_PORT'])
        environment[k] = process.env[k];
    return __createModeOwnerCompositionForTests(config, { environment, poolFactory: c => new Pool(c) });
}
