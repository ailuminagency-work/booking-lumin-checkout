import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import type { FieldDraftV3Client } from '../../../../packages/flow-ui/src/fieldDraftV3Client';
import { FieldDraftV3Editor } from './FieldDraftV3Editor';
import { createTextGuardStore } from './TextGuardStore';
import { useTextStoreNavigationGuard } from './TextStoreNavigationGuard';

export interface LocalFieldDraftV3HostProps {
  client: FieldDraftV3Client; token: string; tenant: string; flowId: string;
  parentRevision: number; parentDirty: boolean; enabled?: boolean; confirmDiscard: () => boolean;
}
type Store = ReturnType<typeof createTextGuardStore>;
interface HostContext { props: LocalFieldDraftV3HostProps; identity: object; store: Store; requestChange(action: () => void): boolean }

/** Opt-in local test host only. Mount persistently above static synchronous routes.
 * Account/flow changes must use requestChange; forced prop changes only fence old data.
 * No loaders/actions/lazy pending transitions: pending-navigation admission is not implemented. */
export function LocalFieldDraftV3Host(props: LocalFieldDraftV3HostProps) {
  const [store] = useState(createTextGuardStore);
  const location = useLocation();
  const identity = useMemo(() => ({}), [props.client, props.token, props.tenant, props.flowId, props.enabled, location.key, location.pathname, location.search, location.hash]);
  const parentObservation = useMemo(() => ({}), [identity, props.parentRevision, props.parentDirty]);
  const [observedParent, setObservedParent] = useState(parentObservation);
  useLayoutEffect(() => { setObservedParent(parentObservation); }, [parentObservation]);
  const [committed, setCommitted] = useState<object>();
  const guard = useTextStoreNavigationGuard(store, props.confirmDiscard);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useLayoutEffect(() => {
    // The old effect cleanup invalidates its client before this reset.
    const scope = store.beginContext(); setCommitted(identity);
    return () => { props.client.invalidate(); scope.invalidate(); };
  }, [identity, store, props.client]);
  return <section aria-label="Local field draft workspace">
    <p>Local test workspace for short, long and dropdown question drafts only. Publishing and customer checkout are not available here.</p>
    <p role="status">{committed !== identity || observedParent !== parentObservation ? null : snapshot.busy ? 'Questions are loading or saving.' : snapshot.dirty ? 'Unsaved question changes.' : 'No unsaved question changes.'}</p>
    {committed === identity && <Outlet context={{ props, identity, store, requestChange: guard.requestChange } satisfies HostContext} />}
  </section>;
}

export function useLocalFieldDraftV3Context() { return useOutletContext<HostContext>(); }

/** The editor route owns one reporting generation. Leaving invalidates that generation. */
export function LocalFieldDraftV3Route() {
  const host = useLocalFieldDraftV3Context();
  const [binding, setBinding] = useState<{ identity: object; dirty(value: boolean): void; busy(value: boolean): void }>();
  useLayoutEffect(() => {
    const scope = host.store.beginContext(); let active = true, state = { dirty: false, busy: false };
    const report = (change: Partial<typeof state>) => { if (active) { state = { ...state, ...change }; scope.report(state); } };
    setBinding({ identity: host.identity, dirty: value => report({ dirty: value }), busy: value => report({ busy: value }) });
    return () => { active = false; host.props.client.invalidate(); scope.invalidate(); };
  }, [host.identity, host.store, host.props.client]);
  if (!binding || binding.identity !== host.identity) return null;
  return <FieldDraftV3Editor client={host.props.client} token={host.props.token} tenant={host.props.tenant} flowId={host.props.flowId}
    parentRevision={host.props.parentRevision} parentDirty={host.props.parentDirty} enabled={host.props.enabled === true}
    onDirtyChange={binding.dirty} onBusyChange={binding.busy} />;
}
