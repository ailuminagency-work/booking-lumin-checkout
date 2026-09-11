import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createFlowClient, type FlowClient, type FlowList, type ServiceRender } from '@lumin/flow-ui';
import { createModeOwnerClient } from '../../../../packages/flow-ui/src/modeOwnerClient';
import { modeUuid, type ModeProfile, type RequestPage, type Mutation, type MutationBodies, type OwnerBodies, type OperationReceipt, type ModeEditorAdapter } from '../../../../packages/flow-ui/src/modeOwnerTypes';
import { PortalShell } from '../components/Layout';
import { PortalRoutes } from '../components/PortalRoutes';
import { VersionedEditor } from './FlowPortal';
import { InstallationPanel } from './InstallationPanel';
import { ModeRequestHistory } from './ModeRequestHistory';
type Session = {
    token: string;
    tenant: string;
    services: ServiceRender[];
    flows: FlowList['flows'];
    configurable: FlowList['flows'];
    requests: RequestPage;
    profile: ModeProfile;
};
type Pending = {
    method: Mutation;
    operation: OperationReceipt['operation'];
    body: MutationBodies[Mutation];
    createdAt: number;
    uncertain: boolean;
    recorded: OperationReceipt | null;
};
const operations = { publish: 'publish', install: 'install', 'apply-version': 'apply', 'update-policy': 'policy' } as const;
const messageFor = (code: string) => code === 'CONFLICT' ? 'Settings changed. Refresh before making another change.' : code === 'FORBIDDEN' ? 'This account cannot perform this action.' : code === 'RATE_LIMITED' ? 'Too many requests. Wait before trying again.' : 'The change could not be completed.';
export function ModeOwnerPortal({ ownerApiUrl, draftApiUrl }: {
    ownerApiUrl: string;
    draftApiUrl: string;
}) {
    const clients = useMemo(() => {
        try {
            const d = new URL(draftApiUrl), p = new URL(location.origin);
            if (!((p.protocol === 'http:' && p.hostname === '127.0.0.1') || (p.protocol === 'https:' && p.hostname === 'localhost')) || !p.port || d.origin !== draftApiUrl || d.protocol !== 'http:' || d.hostname !== '127.0.0.1' || !d.port || Number(d.port) < 1024 || d.port === p.port || new URL(ownerApiUrl).port === p.port || new URL(ownerApiUrl).port === d.port)
                return null;
            return { draft: createFlowClient(draftApiUrl, true), owner: createModeOwnerClient(ownerApiUrl) };
        }
        catch {
            return null;
        }
    }, [ownerApiUrl, draftApiUrl]);
    const [credential, setCredential] = useState(''), [tenantInput, setTenantInput] = useState(''), [session, setSession] = useState<Session | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<Pending | null>(null), [unresolved, setUnresolved] = useState(false), [receipt, setReceipt] = useState<OperationReceipt | null>(null), [flowId, setFlowId] = useState(''), [dirty, setDirty] = useState(false), [refreshVersion, setRefreshVersion] = useState(0), [currentUnavailable, setCurrentUnavailable] = useState(false);
    const generation = useRef(0), sessionRef = useRef<Session | null>(null), pendingRef = useRef<Pending | null>(null), unresolvedRef = useRef(false), mutationBusy = useRef(false), currentUnavailableRef = useRef(false), unresolvedFlow = useRef<string | null>(null);
    const getPending = (): Pending | null => pendingRef.current;
    const publishPending = (p: Pending | null) => { pendingRef.current = p; setPending(p); };
    const current = (at: number, s: Session) => at === generation.current && sessionRef.current === s;
    useEffect(() => () => { generation.current++; sessionRef.current = null; pendingRef.current = null; clients?.owner.invalidate(); clients?.draft.invalidate(); }, [clients]);
    useEffect(() => {
        if (!pending)
            return;
        const at = generation.current;
        const timer = setTimeout(() => {
            if (at !== generation.current || getPending() !== pending)
                return;
            unresolvedFlow.current = pending.body.flowId;
            publishPending(null);
            unresolvedRef.current = true;
            setUnresolved(true);
            setMessage('Previous change unresolved. Local tracking expired; the earlier change may still exist.');
        }, Math.max(0, pending.createdAt + 1800000 - performance.now()));
        return () => clearTimeout(timer);
    }, [pending]);
    useEffect(() => {
        if (!pending && !unresolved && !dirty)
            return;
        const listener = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', listener);
        return () => window.removeEventListener('beforeunload', listener);
    }, [pending, unresolved, dirty]);
    useEffect(() => {
        if (!dirty)
            return;
        const listener = (event: MouseEvent) => {
            const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (!anchor)
                return;
            if (!window.confirm('Discard unsaved edits and leave this questionnaire?')) {
                event.preventDefault();
                event.stopPropagation();
            }
            else
                setDirty(false);
        };
        document.addEventListener('click', listener, true);
        return () => document.removeEventListener('click', listener, true);
    }, [dirty]);
    function logout() {
        if ((pendingRef.current || unresolvedRef.current || dirty) && !window.confirm('A previous change or unsaved edits may remain. Discard local tracking and sign out?'))
            return;
        generation.current++;
        sessionRef.current = null;
        pendingRef.current = null;
        unresolvedRef.current = false;
        unresolvedFlow.current = null;
        mutationBusy.current = false;
        clients?.owner.invalidate();
        clients?.draft.invalidate();
        setSession(null);
        setCredential('');
        setTenantInput('');
        setPending(null);
        setUnresolved(false);
        setReceipt(null);
        setFlowId('');
        setDirty(false);
        setBusy(false);
        setError('');
        setMessage('');
        setRefreshVersion(0);
        currentUnavailableRef.current = false;
        setCurrentUnavailable(false);
    }
    async function login(e: FormEvent) {
        e.preventDefault();
        if (!clients || busy)
            return;
        const at = ++generation.current, token = credential, tenant = tenantInput;
        setBusy(true);
        setError('');
        try {
            modeUuid.parse(tenant);
            if (!/^[A-Za-z0-9._~-]{16,256}$/.test(token))
                throw Error();
            const [services, flows, configurable, history, profile] = await Promise.all([clients.draft.services(token, tenant), clients.draft.flows(token, tenant), clients.draft.configurableFlows(token, tenant), clients.owner.call('request-history', token, { tenantId: tenant, flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 }), clients.owner.profile(token)]);
            if (at !== generation.current)
                return;
            if (history.phase !== 'repository_result' || history.outcome.kind !== 'completed' || history.outcome.delivery !== 'data')
                throw Error();
            const s = { token, tenant, services: services.services, flows: flows.flows, configurable: configurable.flows, requests: history.outcome.data, profile: profile.profile };
            sessionRef.current = s;
            setSession(s);
            setCredential('');
            setTenantInput('');
        }
        catch {
            if (at === generation.current)
                setError('Unable to open this business. Check the local credential and business ID.');
        }
        finally {
            if (at === generation.current)
                setBusy(false);
        }
    }
    // Fresh list results update state, not the stable credential/generation identity held by callbacks.
    async function refreshCurrent(s: Session, at: number, selectedFlow?: string) {
        if (!clients || !current(at, s))
            throw Error();
        const [f, c] = await Promise.all([clients.draft.flows(s.token, s.tenant), clients.draft.configurableFlows(s.token, s.tenant)]);
        if (!current(at, s))
            throw Error();
        if (selectedFlow) {
            const r = await clients.owner.call('installations', s.token, { tenantId: s.tenant, flowId: selectedFlow, afterId: null, limit: 100 });
            if (!current(at, s) || r.phase !== 'repository_result' || r.outcome.kind !== 'completed' || r.outcome.delivery !== 'data')
                throw Error();
        }
        setSession(old => old ? { ...old, flows: f.flows, configurable: c.flows } : old);
        setRefreshVersion(v => v + 1);
        currentUnavailableRef.current = false;
        setCurrentUnavailable(false);
    }
    async function record(p: Pending, r: OperationReceipt, s: Session, at: number) {
        if (!current(at, s) || getPending() !== p)
            return;
        if (r.operation !== p.operation || r.flowId !== p.body.flowId)
            throw Error();
        const recorded = { ...p, recorded: r };
        publishPending(recorded);
        setReceipt(r);
        setMessage('Recorded; refreshing current settings.');
        try {
            await refreshCurrent(s, at, p.body.flowId);
            if (!current(at, s) || pendingRef.current !== recorded)
                return;
            publishPending(null);
            setMessage('Change recorded. Current settings refreshed.');
        }
        catch {
            if (current(at, s))
                setMessage('Recorded; current settings unavailable.');
        }
    }
    async function mutate<M extends Mutation>(method: M, body: Omit<MutationBodies[M], 'idempotencyKey'>) {
        const s = sessionRef.current;
        if (!clients || !s || mutationBusy.current || pendingRef.current || unresolvedRef.current || currentUnavailableRef.current)
            return;
        const at = generation.current;
        if (body.tenantId !== s.tenant)
            return;
        mutationBusy.current = true;
        setError('');
        setMessage('');
        let p: Pending;
        try {
            const copied = JSON.parse(JSON.stringify(body));
            if (Array.isArray(copied.allowedParentOrigins))
                copied.allowedParentOrigins = Object.freeze([...copied.allowedParentOrigins].sort());
            p = { method, operation: operations[method], body: Object.freeze({ ...copied, idempotencyKey: crypto.randomUUID() }), createdAt: performance.now(), uncertain: false, recorded: null };
            publishPending(p);
            if (!current(at, s))
                return;
            const r = await clients.owner.call(method, s.token, p.body as OwnerBodies[M]);
            if (!current(at, s) || getPending() !== p)
                return;
            if (r.phase === 'not_dispatched') {
                publishPending(null);
                setError(messageFor(r.error.code));
                return;
            }
            if (r.phase === 'repository_result' && r.outcome.kind === 'committed' && r.outcome.delivery === 'receipt') {
                await record(p, r.outcome.receipt, s, at);
                return;
            }
            if (r.phase === 'repository_result' && r.outcome.kind === 'failed' && !p.uncertain) {
                publishPending(null);
                setError(messageFor(r.outcome.code));
                if (r.outcome.code === 'CONFLICT') {
                    currentUnavailableRef.current = true;
                    setCurrentUnavailable(true);
                    await refreshCurrent(s, at, p.body.flowId);
                }
                return;
            }
            publishPending({ ...p, uncertain: true });
            setMessage('Change outcome unknown. Check previous change; do not repeat it.');
        }
        catch {
            if (current(at, s)) {
                const p = getPending();
                if (p) {
                    publishPending({ ...p, uncertain: true });
                    setMessage('Change outcome unknown. Check previous change; do not repeat it.');
                }
                else {
                    setError(currentUnavailableRef.current ? 'Current settings unavailable. Refresh before making a change.' : 'Unable to prepare the change. No request was sent.');
                }
            }
        }
        finally {
            if (current(at, s))
                mutationBusy.current = false;
        }
    }
    async function check() {
        const s = sessionRef.current, p = pendingRef.current;
        if (!clients || !s || !p || mutationBusy.current)
            return;
        const at = generation.current;
        mutationBusy.current = true;
        setBusy(true);
        setError('');
        try {
            if (p.recorded) {
                await record(p, p.recorded, s, at);
                return;
            }
            const r = await clients.owner.call('operation', s.token, { tenantId: s.tenant, flowId: p.body.flowId, operation: p.operation, idempotencyKey: p.body.idempotencyKey });
            if (!current(at, s) || getPending() !== p)
                return;
            if (r.phase === 'repository_result' && r.outcome.kind === 'completed' && r.outcome.delivery === 'data')
                await record(p, r.outcome.data, s, at);
            else
                setMessage('Previous change is still unresolved. An unavailable receipt does not mean it failed.');
        }
        catch {
            if (current(at, s))
                setMessage('Previous change is still unresolved.');
        }
        finally {
            if (current(at, s)) {
                mutationBusy.current = false;
                setBusy(false);
            }
        }
    }
    async function abandon() {
        const s = sessionRef.current;
        if (!s || mutationBusy.current || (!pendingRef.current && !unresolvedRef.current))
            return;
        const at = generation.current;
        mutationBusy.current = true;
        setBusy(true);
        try {
            await refreshCurrent(s, at, pendingRef.current?.body.flowId || unresolvedFlow.current || flowId || undefined);
            if (!current(at, s))
                return;
            if (!window.confirm('The earlier change may still exist. Current settings were reloaded. Continue without resolving is a new action, not proof that the previous change failed.'))
                return;
            publishPending(null);
            unresolvedRef.current = false;
            unresolvedFlow.current = null;
            setUnresolved(false);
            setMessage('Local tracking discarded. The earlier change may still exist.');
        }
        catch {
            if (current(at, s))
                setError('Current settings unavailable. Changes remain locked.');
        }
        finally {
            if (current(at, s)) {
                mutationBusy.current = false;
                setBusy(false);
            }
        }
    }
    const renderGeneration = generation.current, renderSession = sessionRef.current;
    const activeEditor = () => !!renderSession && current(renderGeneration, renderSession);
    const selection = useCallback((id: string, d: boolean) => { if (generation.current !== renderGeneration)
        return; setFlowId(id); setDirty(d); }, [renderGeneration]);
    const adapter: ModeEditorAdapter = { active: activeEditor, locked: !!pending || unresolved || currentUnavailable, beforeDiscard: () => !dirty || window.confirm('Discard unsaved edits and load another questionnaire?'), publish: async (id, revision) => {
            if (!activeEditor())
                return;
            const s = renderSession;
            if (s)
                await mutate('publish', { tenantId: s.tenant, flowId: id, expectedDraftRevision: revision });
        }, selection, changed: async () => {
            if (!activeEditor())
                return;
            const s = renderSession;
            if (s)
                await refreshCurrent(s, generation.current);
        } };
    const published = session ? [...session.flows, ...session.configurable].find(f => f.flowId === flowId)?.publishedVersionId ?? null : null;
    return <PortalShell mode="connected" tenantName="Local installation setup" roleLabel={session ? 'Local test owner' : 'Signed out'}><h1>Local installation setup</h1><p role="note">Synthetic credentials and test data only. Customer delivery not enabled.</p>{!clients ? <p role="alert">Local installation setup is unavailable. Configure distinct loopback APIs and a local portal.</p> : !session ? <section><h2>Open local test business</h2><form onSubmit={login}><fieldset disabled={busy}><label>Local test credential<input type="password" autoComplete="off" maxLength={256} value={credential} onChange={e => setCredential(e.target.value)} required/></label><label>Business ID<input maxLength={36} value={tenantInput} onChange={e => setTenantInput(e.target.value)} required/></label><button>Open business</button></fieldset></form></section> : <><button onClick={logout}>Sign out / change business</button>{(pending || unresolved) && <section aria-label="Previous change"><p>New changes are locked until this change is resolved or you explicitly continue.</p>{pending && <button disabled={busy || mutationBusy.current} onClick={() => void check()}>Check previous change</button>}<button disabled={busy} onClick={() => void abandon()}>Continue without resolving</button><p>Reloading this page loses local tracking. The change may still exist.</p></section>}{receipt && <p>Historical receipt recorded: {receipt.operation}. Current controls use refreshed settings.</p>}{currentUnavailable && <p role="alert">Current settings unavailable. Refresh before making a change.</p>}<button disabled={busy} onClick={() => {
                const s = sessionRef.current;
                if (!s)
                    return;
                const at = generation.current;
                setBusy(true);
                void refreshCurrent(s, at, flowId || undefined).catch(() => {
                    if (current(at, s))
                        setError('Current settings unavailable.');
                }).finally(() => {
                    if (current(at, s))
                        setBusy(false);
                });
            }}>Refresh current settings</button><div><PortalRoutes mode="connected" bookings={<ModeRequestHistory key={session.tenant} client={clients.owner} token={session.token} tenant={session.tenant} initial={session.requests}/>} services={<section><h1>Services</h1><ul>{session.services.map(s => <li key={s.id}>{s.name}</li>)}</ul></section>} embed={<><VersionedEditor key={session.tenant} client={clients.draft} token={session.token} tenant={session.tenant} services={session.services} initialFlows={session.flows} modeAdapter={adapter}/>{flowId && <InstallationPanel key={session.tenant + flowId + ":" + refreshVersion} client={clients.owner} token={session.token} tenant={session.tenant} flowId={flowId} publishedVersionId={published} profile={session.profile} locked={!!pending || unresolved || currentUnavailable} refreshVersion={refreshVersion} mutate={async (method, body) => { if (activeEditor())
            await mutate(method, body); }}/>}</>}/></div></>}{busy && <p role="status">Loading business settings…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</PortalShell>;
}
