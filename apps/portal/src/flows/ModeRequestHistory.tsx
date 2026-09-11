import { useEffect, useRef, useState } from 'react';
import type { ModeOwnerClient } from '../../../../packages/flow-ui/src/modeOwnerClient';
import type { RequestPage } from '../../../../packages/flow-ui/src/modeOwnerTypes';
export function ModeRequestHistory({ client, token, tenant, initial }: {
    client: ModeOwnerClient;
    token: string;
    tenant: string;
    initial: RequestPage;
}) {
    const [page, setPage] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [cursors, setCursors] = useState<(RequestPage['nextCursor'])[]>([null]);
    const generation = useRef(0), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => () => { generation.current++; }, []);
    async function load(cursor: RequestPage['nextCursor'], stack: (RequestPage['nextCursor'])[]) {
        if (!alive.current)
            return;
        const at = ++generation.current;
        setBusy(true);
        setError('');
        try {
            const r = await client.call('request-history', token, { tenantId: tenant, flowId: null, beforeCreatedAt: cursor?.createdAt ?? null, beforeBookingId: cursor?.bookingId ?? null, limit: 100 });
            if (at !== generation.current)
                return;
            if (r.phase !== 'repository_result' || r.outcome.kind !== 'completed' || r.outcome.delivery !== 'data')
                throw Error();
            setPage(r.outcome.data);
            setCursors(stack);
        }
        catch {
            if (at === generation.current)
                setError('Read outcome unavailable. Existing results have not been replaced.');
        }
        finally {
            if (at === generation.current)
                setBusy(false);
        }
    }
    return <section><h1>Bookings</h1><h2>Request history</h2><p>Current booking status. Customer details and payment information are not included.</p><button disabled={busy} onClick={() => void load(cursors.at(-1) ?? null, cursors)}>Refresh requests</button>{error && <p role="alert">{error}</p>}{busy && <p role="status">Loading requests…</p>}<ul>{page.requests.map(r => <li key={r.bookingId}>{r.reference} · {r.state} · <time dateTime={r.slotStart}>{r.slotStart}</time></li>)}</ul>{!page.requests.length && <p>No requests found.</p>}<button disabled={busy || cursors.length === 1} onClick={() => void load(cursors.at(-2) ?? null, cursors.slice(0, -1))}>Previous requests</button><button disabled={busy || !page.nextCursor || cursors.length >= 20} onClick={() => void load(page.nextCursor, [...cursors, page.nextCursor])}>Next requests</button><button disabled={busy} onClick={() => void load(null, [null])}>Back to first page</button></section>;
}
