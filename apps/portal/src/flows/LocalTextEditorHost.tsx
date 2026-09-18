import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import type { TextFieldDraftClient } from '../../../../packages/flow-ui/src/textFieldDraftClient';
import { TextFieldEditor } from './TextFieldEditor';
import { createTextGuardStore } from './TextGuardStore';
import { useTextStoreNavigationGuard } from './TextStoreNavigationGuard';

export interface LocalTextEditorHostProps {
  client: TextFieldDraftClient; token: string; tenant: string; flowId: string;
  parentRevision: number; enabled: boolean; confirmDiscard: () => boolean;
}
type Store = ReturnType<typeof createTextGuardStore>;
interface HostContext { props: LocalTextEditorHostProps; identity: object; store: Store; requestChange(action: () => void): boolean }

/** Opt-in local test host only. Mount persistently above static synchronous routes.
 * No loaders/actions/lazy pending transitions: pending-navigation admission is not implemented. */
export function LocalTextEditorHost(props: LocalTextEditorHostProps) {
  const [store] = useState(createTextGuardStore);
  const location = useLocation();
  const identity = useMemo(() => ({}), [props.client, props.token, props.tenant, props.flowId, props.enabled, location.key, location.pathname, location.search, location.hash]);
  const [committed, setCommitted] = useState<object>();
  const guard = useTextStoreNavigationGuard(store, props.confirmDiscard);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useLayoutEffect(() => {
    // The old effect cleanup invalidates its client before this reset.
    const scope = store.beginContext(); setCommitted(identity);
    return () => { props.client.invalidate(); scope.invalidate(); };
  }, [identity, store, props.client]);
  return <section aria-label="Local text draft workspace">
    <p>Local test workspace for text question drafts only. Publishing and customer checkout are not available here.</p>
    <p role="status">{snapshot.busy ? 'Questions are loading or saving.' : snapshot.dirty ? 'Unsaved question changes.' : 'No unsaved question changes.'}</p>
    {committed === identity && <Outlet context={{ props, identity, store, requestChange: guard.requestChange } satisfies HostContext} />}
  </section>;
}

export function useLocalTextEditorContext() { return useOutletContext<HostContext>(); }

/** The editor route owns one reporting generation. Leaving invalidates that generation. */
export function LocalTextEditorRoute() {
  const host = useLocalTextEditorContext();
  const [binding, setBinding] = useState<{ identity: object; dirty(value: boolean): void; busy(value: boolean): void }>();
  useLayoutEffect(() => {
    const scope = host.store.beginContext(); let active = true, state = { dirty: false, busy: false };
    const report = (change: Partial<typeof state>) => { if (active) { state = { ...state, ...change }; scope.report(state); } };
    setBinding({ identity: host.identity, dirty: value => report({ dirty: value }), busy: value => report({ busy: value }) });
    return () => { active = false; host.props.client.invalidate(); scope.invalidate(); };
  }, [host.identity, host.store, host.props.client]);
  if (!binding || binding.identity !== host.identity) return null;
  return <TextFieldEditor client={host.props.client} token={host.props.token} tenant={host.props.tenant} flowId={host.props.flowId}
    parentRevision={host.props.parentRevision} parentDirty={false} enabled={host.props.enabled}
    onDirtyChange={binding.dirty} onBusyChange={binding.busy} />;
}
