import { useEffect, useRef, useState } from 'react';
import type { ModeOwnerClient } from '../../../../packages/flow-ui/src/modeOwnerClient';
import type { InstallationPage, InstallationHistory, InstallationRow, ModeProfile, Mutation, MutationBodies } from '../../../../packages/flow-ui/src/modeOwnerTypes';
export type InstallationPanelProps = {
    client: ModeOwnerClient;
    token: string;
    tenant: string;
    flowId: string;
    publishedVersionId: string | null;
    profile: ModeProfile;
    locked: boolean;
    refreshVersion: number;
    mutate: <M extends Mutation>(method: M, body: Omit<MutationBodies[M], 'idempotencyKey'>) => Promise<void>;
};
export function InstallationPanel({ client, token, tenant, flowId, publishedVersionId, profile, locked, refreshVersion, mutate }: InstallationPanelProps) {
    const [page, setPage] = useState<InstallationPage>({ installations: [], nextCursor: null }), [history, setHistory] = useState<InstallationHistory | null>(null), [selected, setSelected] = useState<InstallationRow | null>(null), [mode, setMode] = useState<'hosted' | 'iframe'>('hosted'), [origins, setOrigins] = useState(''), [enabled, setEnabled] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [stack, setStack] = useState<(string | null)[]>([null]), [historyStack, setHistoryStack] = useState<(number | null)[]>([null]);
    const generation = useRef(0), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function load(afterId: string | null = null, nextStack: (string | null)[] = [null]) {
        if (!alive.current)
            return;
        const at = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await client.call('installations', token, { tenantId: tenant, flowId, afterId, limit: 100 });
            if (at !== generation.current)
                return;
            if (r.phase !== 'repository_result' || r.outcome.kind !== 'completed' || r.outcome.delivery !== 'data')
                throw Error();
            setPage(r.outcome.data);
            setStack(nextStack);
            setSelected(null);
            setHistory(null);
        }
        catch {
            if (at === generation.current)
                setError('Read outcome unavailable. Refresh installations.');
        }
        finally {
            if (at === generation.current)
                setBusy(false);
        }
    }
    useEffect(() => { setPage({ installations: [], nextCursor: null }); setSelected(null); setHistory(null); setOrigins(''); setMode('hosted'); void load(); return () => { generation.current++; }; }, [client, token, tenant, flowId, refreshVersion]);
    function select(row: InstallationRow) { generation.current++; setBusy(false); setSelected(row); setOrigins(row.allowedParentOrigins.join('\n')); setEnabled(row.enabled); setHistory(null); setHistoryStack([null]); }
    async function loadHistory(cursor: number | null = null, nextStack: (number | null)[] = [null]) {
        if (!alive.current)
            return;
        if (!selected)
            return;
        const at = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await client.call('installation-history', token, { tenantId: tenant, flowId, installationId: selected.installationId, beforeSequence: cursor, limit: 100 });
            if (at !== generation.current)
                return;
            if (r.phase !== 'repository_result' || r.outcome.kind !== 'completed' || r.outcome.delivery !== 'data')
                throw Error();
            setHistory(r.outcome.data);
            setHistoryStack(nextStack);
        }
        catch {
            if (at === generation.current)
                setError('Read outcome unavailable. Refresh history.');
        }
        finally {
            if (at === generation.current)
                setBusy(false);
        }
    }
    function parents() { return [...new Set(origins.split('\n').map(s => s.trim()).filter(Boolean))].sort(); }
    return <section><h2>Installations</h2><p>Customer delivery not enabled.</p><p>{publishedVersionId ? 'That published version, not current draft.' : 'Publish a saved version before creating an installation.'}</p>{publishedVersionId && <p>Published version: {publishedVersionId}</p>}{!profile && <p>No local deployment profile is configured. Publication and editing remain available.</p>}<button disabled={busy} onClick={() => void load()}>Refresh installations</button>{error && <p role="alert">{error}</p>}{busy && <p role="status">Loading installation settings…</p>}<fieldset disabled={locked || busy}><legend>Create an installation</legend><label>Installation mode<select value={mode} onChange={e => setMode(e.target.value as 'hosted' | 'iframe')}><option value="hosted">Hosted</option><option value="iframe">Website embed</option></select></label>{mode === 'iframe' && <label>Allowed parent origins<textarea maxLength={8192} value={origins} onChange={e => setOrigins(e.target.value)}/></label>}<button disabled={!profile || !publishedVersionId || (mode === 'iframe' && !parents().length)} onClick={() => {
            if (profile && publishedVersionId)
                void mutate('install', { tenantId: tenant, flowId, versionId: publishedVersionId, expectedPublishedVersionId: publishedVersionId, mode, deploymentProfileVersion: profile.profileVersion, allowedParentOrigins: mode === 'hosted' ? [] : parents() });
        }}>Create installation</button></fieldset><ul>{page.installations.map(row => <li key={row.installationId}><button onClick={() => select(row)}>{row.mode} installation {row.installationId}</button> · {row.enabled ? 'Enabled' : 'Disabled'} · Target revision {row.targetRevision} · Policy revision {row.policyRevision}</li>)}</ul>{!page.installations.length && <p>No installations found.</p>}<button disabled={busy || stack.length === 1} onClick={() => void load(stack.at(-2) ?? null, stack.slice(0, -1))}>Previous installations</button><button disabled={busy || !page.nextCursor || stack.length >= 20} onClick={() => void load(page.nextCursor, [...stack, page.nextCursor])}>Next installations</button>{stack.length >= 20 && <button onClick={() => void load()}>Back to first installation page</button>}{selected && <><h3>Selected installation</h3><p>Current target: {selected.currentVersionId}</p><fieldset disabled={locked || busy}><button disabled={!publishedVersionId || publishedVersionId === selected.currentVersionId} onClick={() => {
                if (publishedVersionId)
                    void mutate('apply-version', { tenantId: tenant, flowId, installationId: selected.installationId, expectedTargetRevision: selected.targetRevision, expectedCurrentVersionId: selected.currentVersionId, newVersionId: publishedVersionId });
            }}>Apply published version</button><label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>Distribution enabled</label>{selected.mode === 'iframe' && <label>Policy allowed parent origins<textarea value={origins} maxLength={8192} onChange={e => setOrigins(e.target.value)}/></label>}<button onClick={() => void mutate('update-policy', { tenantId: tenant, flowId, installationId: selected.installationId, expectedPolicyRevision: selected.policyRevision, enabled, allowedParentOrigins: selected.mode === 'hosted' ? [] : parents() })}>Save distribution policy</button></fieldset><button disabled={busy} onClick={() => void loadHistory()}>View installation history</button>{history && <><ol>{history.history.map(h => <li key={h.sequence}>Change {h.sequence}: {h.operation} · Target {h.targetRevision} · Policy {h.policyRevision}</li>)}</ol><button disabled={busy || historyStack.length === 1} onClick={() => void loadHistory(historyStack.at(-2) ?? null, historyStack.slice(0, -1))}>Previous changes</button><button disabled={busy || history.nextCursor === null || historyStack.length >= 20} onClick={() => void loadHistory(history.nextCursor, [...historyStack, history.nextCursor])}>Older changes</button>{historyStack.length >= 20 && <button onClick={() => void loadHistory()}>Back to first history page</button>}</>}</>}</section>;
}
