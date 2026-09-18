import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FieldDraftV2Client } from '../../../../packages/flow-ui/src/fieldDraftV2Client';
import { parseFieldDocumentV2, type FieldV2 } from '@lumin/workflow';
type Field = FieldV2 & { readonly prompt?: string };
export interface FieldDraftV2EditorProps { client: FieldDraftV2Client; token: string; tenant: string; flowId: string; parentRevision: number; parentDirty: boolean; enabled?: boolean; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }
export function FieldDraftV2Editor({ client, token, tenant, flowId, parentRevision, parentDirty, enabled = false, onDirtyChange, onBusyChange }: FieldDraftV2EditorProps) {
  const context = useMemo(() => ({}), [client, token, tenant, flowId, enabled]);
  const generation = useRef(0), operation = useRef(false), callback = useRef(onDirtyChange);
  const busyCallback = useRef(onBusyChange), dirtyRef = useRef(false);
  const [state, setState] = useState<{ context: object; fields: Field[]; revision: number; parent: number; stale: boolean }>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false), [ack, setAck] = useState(false);
  const [statusContext, setStatusContext] = useState(context);
  const current = state?.context === context ? state : undefined;
  useLayoutEffect(() => {
    generation.current++; operation.current = false; dirtyRef.current = false; setStatusContext(context); setState(undefined); setDirty(false); setBusy(false); setMessage(''); setConflict(false); setAck(false); callback.current?.(false); busyCallback.current?.(false);
    return () => { generation.current++; operation.current = false; busyCallback.current?.(false); client.invalidate(); };
  }, [context, client]);
  useLayoutEffect(() => { callback.current = onDirtyChange; onDirtyChange?.(dirtyRef.current); }, [onDirtyChange]);
  useLayoutEffect(() => { busyCallback.current = onBusyChange; onBusyChange?.(operation.current); }, [onBusyChange]);
  const allowed = enabled && !parentDirty && Number.isSafeInteger(parentRevision) && parentRevision > 0;
  const markDirty = () => { dirtyRef.current = true; setDirty(true); callback.current?.(true); setMessage(''); };
  async function load(preserve = false) {
    if (!allowed || operation.current) return;
    const at = generation.current; operation.current = true; busyCallback.current?.(true); setBusy(true); setMessage('');
    try {
      const read = await client.read(token, tenant, flowId);
      if (at !== generation.current) return;
      const revision = read.status === 'missing' ? 0 : read.receipt.draftRevision;
      const parent = read.status === 'missing' ? read.currentParentRevision : read.receipt.currentParentRevision;
      if (preserve && current && revision !== current.revision) {
        setConflict(true);
        setMessage('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.'); return;
      }
      setState({ context, revision, parent, stale: read.status === 'present' && read.receipt.stale,
        fields: preserve && current ? current.fields : read.status === 'present' ? [...read.receipt.definition.fields] : [] });
      setAck(false); setConflict(false);
      if (!preserve) { dirtyRef.current = false; setDirty(false); callback.current?.(false); }
    } catch { if (at === generation.current) setMessage('Questions could not be loaded. Try again.'); }
    finally { if (at === generation.current) { operation.current = false; setBusy(false); busyCallback.current?.(false); } }
  }
  function edit(index: number, change: Partial<Field>) {
    if (!current || operation.current || !allowed) return;
    const field = current.fields[index]; if (!field) return;
    setState({ ...current, fields: current.fields.map((value, i) => i === index ? { ...value, ...change } : value) });
    markDirty();
  }
  let invalid = false;
  try { if (current) parseFieldDocumentV2({schemaVersion: 2, fields: current.fields}); } catch { invalid = true; }
  async function save() {
    if (!current || !allowed || operation.current || conflict || invalid || current.parent !== parentRevision || (current.stale && !ack)) return;
    const at = generation.current; operation.current = true; busyCallback.current?.(true); setBusy(true); setMessage('');
    try {
      const receipt = await client.save(token, tenant, flowId, { fieldDraftVersion: 2, parentAuthoringVersion: 2, expectedRevision: current.revision, expectedFlowRevision: current.parent, definition: { schemaVersion: 2, fields: current.fields } });
      if (at !== generation.current) return;
      setState({ context, fields: [...receipt.definition.fields], revision: receipt.draftRevision, parent: receipt.currentParentRevision, stale: receipt.stale });
      dirtyRef.current = false; setDirty(false); callback.current?.(false); setAck(false); setMessage('Questions saved as a draft.');
    } catch (error) {
      if (at !== generation.current) return;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT') { setConflict(true); setMessage('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.'); }
      else setMessage('Questions could not be saved. Your edits are kept.');
    } finally { if (at === generation.current) { operation.current = false; setBusy(false); busyCallback.current?.(false); } }
  }
  if (!enabled) return <section aria-label="Booking questions"><p>Booking questions are not available in this environment.</p></section>;
  return <section aria-label="Booking questions">
    <h3>Booking questions</h3><p>Prepare questions for your booking form. These drafts are not shown to customers yet.</p>
    {!allowed && <p>Save your booking flow changes before editing questions.</p>}
    <button type="button" disabled={!allowed || (statusContext === context && busy)} onClick={() => void load()}>{current ? dirty ? 'Discard edits and reload' : 'Reload questions' : 'Load questions'}</button>
    {current && <>
      <button type="button" disabled={!allowed || busy} onClick={() => void load(true)}>Check latest version</button>
      {current.parent !== parentRevision && <p>The booking flow changed. Check the latest version before saving questions.</p>}
      {current.stale && <label><input type="checkbox" checked={ack} disabled={busy || !allowed || current.parent !== parentRevision} onChange={event => { if (allowed && !operation.current && current.parent === parentRevision) setAck(event.target.checked); }} />I reviewed these questions for the updated booking flow.</label>}
      <fieldset disabled={!allowed || busy}><legend>Questions</legend>
      {current.fields.map((field, index) => <fieldset key={field.key}><legend>Question {index + 1}</legend>
        <p>{field.prompt ?? 'Question needs a label'}</p>
        <label>Answer format<select value={field.kind} onChange={event => edit(index, { kind: event.target.value as Field['kind'] })}><option value="text">Short answer</option><option value="textarea">Long answer</option></select></label>
        <label>Question label<input value={field.prompt ?? ''} maxLength={400} onChange={event => edit(index, { prompt: event.target.value })} /></label>
        <label><input type="checkbox" checked={field.required} onChange={event => edit(index, { required: event.target.checked })} />Answer required</label>
        <label>Minimum characters<input type="number" min={0} max={4096} value={field.minLength} onChange={event => edit(index, { minLength: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <label>Maximum characters<input type="number" min={0} max={4096} value={field.maxLength} onChange={event => edit(index, { maxLength: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <button type="button" disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => { if (!allowed || operation.current) return; const fields = [...current.fields]; [fields[index - 1], fields[index]] = [fields[index]!, fields[index - 1]!]; setState({ ...current, fields }); markDirty(); }}>Move up</button>
        <button type="button" disabled={index === current.fields.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => { if (!allowed || operation.current) return; const fields = [...current.fields]; [fields[index], fields[index + 1]] = [fields[index + 1]!, fields[index]!]; setState({ ...current, fields }); markDirty(); }}>Move down</button>
        <button type="button" aria-label={`Remove question ${index + 1}`} onClick={() => { if (!allowed || operation.current) return; setState({ ...current, fields: current.fields.filter((_, i) => i !== index) }); markDirty(); }}>Remove question</button>
      </fieldset>)}
      <button type="button" disabled={current.fields.length >= 64} onClick={() => { if (!allowed || operation.current || current.fields.length >= 64) return; const key = 'question_' + crypto.randomUUID().replaceAll('-', ''); setState({ ...current, fields: [...current.fields, { key, kind: 'text', prompt: '', required: false, minLength: 0, maxLength: 500 }] }); markDirty(); }}>Add text question</button>
      </fieldset>
      {invalid && <p>Give each edited question a label and check its character limits.</p>}
      <button type="button" disabled={!allowed || busy || conflict || invalid || current.parent !== parentRevision || (current.stale && !ack)} onClick={() => void save()}>Save questions</button>
    </>}
    <p role="status">{statusContext === context ? (busy ? 'Working…' : message) : null}</p>
  </section>;
}
