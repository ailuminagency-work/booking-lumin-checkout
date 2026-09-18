import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TextFieldDraftClient } from '../../../../packages/flow-ui/src/textFieldDraftClient';
import type { TextField } from '@lumin/workflow';
type Field = TextField & { readonly prompt?: string };
export interface TextFieldEditorProps { client: TextFieldDraftClient; token: string; tenant: string; flowId: string; parentRevision: number; parentDirty: boolean; enabled: boolean; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }
export function TextFieldEditor({ client, token, tenant, flowId, parentRevision, parentDirty, enabled, onDirtyChange, onBusyChange }: TextFieldEditorProps) {
  const context = useMemo(() => ({}), [client, token, tenant, flowId, enabled]);
  const generation = useRef(0), operation = useRef(false), callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const busyCallback = useRef(onBusyChange);
  useLayoutEffect(() => { busyCallback.current = onBusyChange; onBusyChange?.(operation.current); }, [onBusyChange]);
  const [state, setState] = useState<{ context: object; fields: Field[]; revision: number; parent: number; stale: boolean }>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false), [ack, setAck] = useState(false), [touched, setTouched] = useState<Set<string>>(new Set());
  const current = state?.context === context ? state : undefined;
  useEffect(() => {
    generation.current++; operation.current = false; setState(undefined); setDirty(false); setBusy(false); setMessage(''); setConflict(false); setAck(false); setTouched(new Set()); callback.current?.(false); busyCallback.current?.(false);
    return () => { generation.current++; operation.current = false; busyCallback.current?.(false); client.invalidate(); };
  }, [context, client]);
  const allowed = enabled && !parentDirty && Number.isSafeInteger(parentRevision) && parentRevision > 0;
  const markDirty = () => { setDirty(true); callback.current?.(true); setMessage(''); };
  async function load(preserve = false) {
    if (!allowed || operation.current) return;
    const at = generation.current; operation.current = true; busyCallback.current?.(true); setBusy(true); setMessage('');
    try {
      const read = await client.read(token, tenant, flowId);
      if (at !== generation.current) return;
      const revision = read.status === 'missing' ? 0 : read.receipt.draftRevision;
      const parent = read.status === 'missing' ? read.currentParentRevision : read.receipt.currentParentRevision;
      if (preserve && current && revision !== current.revision) { setConflict(true); setMessage('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.'); return; }
      setState({ context, revision, parent, stale: read.status === 'present' && read.receipt.stale,
        fields: preserve && current ? current.fields : read.status === 'present' ? [...read.receipt.definition.fields] : [] });
      setAck(false); setConflict(false);
      if (!preserve) { setDirty(false); callback.current?.(false); setTouched(new Set()); }
    } catch { if (at === generation.current) setMessage('Questions could not be loaded. Try again.'); }
    finally { if (at === generation.current) { operation.current = false; setBusy(false); busyCallback.current?.(false); } }
  }
  function edit(index: number, change: Partial<Field>) {
    if (!current || busy) return;
    const field = current.fields[index]; if (!field) return;
    setState({ ...current, fields: current.fields.map((value, i) => i === index ? { ...value, ...change } : value) });
    setTouched(new Set([...touched, field.key])); markDirty();
  }
  const badPrompt = (prompt: string) => !prompt.trim() || prompt.length > 400 || Array.from(prompt).length > 200 || /[\u0000\r\n\u2028\u2029]/.test(prompt) || Array.from(prompt).some(character => character.length === 1 && /[\uD800-\uDFFF]/.test(character));
  const invalid = current?.fields.some(field => ((touched.has(field.key) || field.prompt !== undefined) && (field.prompt === undefined || badPrompt(field.prompt))) || !Number.isInteger(field.minLength) || !Number.isInteger(field.maxLength) || field.minLength < 0 || field.maxLength > 4096 || field.minLength > field.maxLength || (field.required && field.maxLength === 0));
  async function save() {
    if (!current || !allowed || operation.current || conflict || invalid || current.parent !== parentRevision || (current.stale && !ack)) return;
    const at = generation.current; operation.current = true; busyCallback.current?.(true); setBusy(true); setMessage('');
    try {
      const receipt = await client.save(token, tenant, flowId, { textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: current.revision, expectedFlowRevision: current.parent, definition: { schemaVersion: 1, fields: current.fields } });
      if (at !== generation.current) return;
      setState({ context, fields: [...receipt.definition.fields], revision: receipt.draftRevision, parent: receipt.currentParentRevision, stale: receipt.stale });
      setDirty(false); callback.current?.(false); setTouched(new Set()); setAck(false); setMessage('Questions saved as a draft.');
    } catch (error) {
      if (at !== generation.current) return;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT') { setConflict(true); setMessage('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.'); }
      else setMessage('Questions could not be saved. Your edits are kept.');
    } finally { if (at === generation.current) { operation.current = false; setBusy(false); busyCallback.current?.(false); } }
  }
  if (!enabled) return <section aria-label="Text questions"><p>Text questions are not available in this environment.</p></section>;
  return <section aria-label="Text questions">
    <h3>Text questions</h3><p>Prepare questions for your booking form. These drafts are not shown to customers yet.</p>
    {!allowed && <p>Save your booking flow changes before editing questions.</p>}
    <button type="button" disabled={!allowed || busy} onClick={() => void load()}>{current ? dirty ? 'Discard edits and reload' : 'Reload questions' : 'Load questions'}</button>
    {current && <>
      <button type="button" disabled={!allowed || busy} onClick={() => void load(true)}>Check latest version</button>
      {current.parent !== parentRevision && <p>The booking flow changed. Check the latest version before saving questions.</p>}
      {current.stale && <label><input type="checkbox" checked={ack} disabled={busy || !allowed || current.parent !== parentRevision} onChange={event => setAck(event.target.checked)} />I reviewed these questions for the updated booking flow.</label>}
      <fieldset disabled={!allowed || busy}><legend>Questions</legend>
      {current.fields.map((field, index) => <fieldset key={field.key}><legend>Question {index + 1}</legend>
        <p>{field.prompt ?? 'Question needs a label'}</p>
        <label>Question label<input value={field.prompt ?? ''} maxLength={400} onChange={event => edit(index, { prompt: event.target.value })} /></label>
        <label><input type="checkbox" checked={field.required} onChange={event => edit(index, { required: event.target.checked })} />Answer required</label>
        <label>Minimum characters<input type="number" min={0} max={4096} value={field.minLength} onChange={event => edit(index, { minLength: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <label>Maximum characters<input type="number" min={0} max={4096} value={field.maxLength} onChange={event => edit(index, { maxLength: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <button type="button" disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => { const fields = [...current.fields]; [fields[index - 1], fields[index]] = [fields[index]!, fields[index - 1]!]; setState({ ...current, fields }); markDirty(); }}>Move up</button>
        <button type="button" disabled={index === current.fields.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => { const fields = [...current.fields]; [fields[index], fields[index + 1]] = [fields[index + 1]!, fields[index]!]; setState({ ...current, fields }); markDirty(); }}>Move down</button>
        <button type="button" aria-label={`Remove question ${index + 1}`} onClick={() => { setState({ ...current, fields: current.fields.filter((_, i) => i !== index) }); markDirty(); }}>Remove question</button>
      </fieldset>)}
      <button type="button" disabled={current.fields.length >= 64} onClick={() => { const key = 'question_' + crypto.randomUUID().replaceAll('-', ''); setState({ ...current, fields: [...current.fields, { key, kind: 'text', prompt: '', required: false, minLength: 0, maxLength: 500 }] }); setTouched(new Set([...touched, key])); markDirty(); }}>Add text question</button>
      </fieldset>
      {invalid && <p>Give each edited question a label and check its character limits.</p>}
      <button type="button" disabled={!allowed || busy || conflict || invalid || current.parent !== parentRevision || (current.stale && !ack)} onClick={() => void save()}>Save questions</button>
    </>}
    <p role="status">{busy ? 'Working…' : message}</p>
  </section>;
}
