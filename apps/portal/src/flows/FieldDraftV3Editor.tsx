import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FieldDraftV3Client } from '../../../../packages/flow-ui/src/fieldDraftV3Client';
import { FieldQuestionPreviewV3 } from '../../../../packages/flow-ui/src/FieldQuestionPreviewV3';
import { parseFieldDocumentV3, type FieldV3 } from '@lumin/workflow';
type Field = FieldV3 & { readonly prompt?: string };
export interface FieldDraftV3EditorProps { client: FieldDraftV3Client; token: string; tenant: string; flowId: string; parentRevision: number; parentDirty: boolean; enabled?: boolean; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }
export function FieldDraftV3Editor({ client, token, tenant, flowId, parentRevision, parentDirty, enabled = false, onDirtyChange, onBusyChange }: FieldDraftV3EditorProps) {
  const context = useMemo(() => ({}), [client, token, tenant, flowId, enabled]);
  const parentContext = useMemo(() => ({}), [context, parentRevision, parentDirty]);
  const generation = useRef(0), operation = useRef(false), callback = useRef(onDirtyChange);
  const busyCallback = useRef(onBusyChange), dirtyRef = useRef(false);
  const [state, setState] = useState<{ context: object; parentContext: object; fields: Field[]; revision: number; parent: number; stale: boolean }>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false), [ack, setAck] = useState(false);
  const [statusContext, setStatusContext] = useState(parentContext);
  const current = state?.context === context ? state : undefined;
  const reconciled = current?.parentContext === parentContext;
  const previewIdentity = useMemo(() => ({}), [current, context, parentContext, ack, conflict]);
  const [previewFor, setPreviewFor] = useState<object>();
  useLayoutEffect(() => {
    setPreviewFor(undefined);
    generation.current++; operation.current = false; dirtyRef.current = false; setStatusContext(parentContext); setState(undefined); setDirty(false); setBusy(false); setMessage(''); setConflict(false); setAck(false); callback.current?.(false); busyCallback.current?.(false);
    return () => { generation.current++; operation.current = false; busyCallback.current?.(false); client.invalidate(); };
  }, [context, client]);
  // A committed parent transition gets a distinct epoch, even when its value later returns.
  useLayoutEffect(() => {
    generation.current++; operation.current = false; client.invalidate();
    setStatusContext(parentContext); setBusy(false); busyCallback.current?.(false); setAck(false); setPreviewFor(undefined); setMessage('');
  }, [parentContext, client]);
  useLayoutEffect(() => { callback.current = onDirtyChange; onDirtyChange?.(dirtyRef.current); }, [onDirtyChange]);
  useLayoutEffect(() => { busyCallback.current = onBusyChange; onBusyChange?.(operation.current); }, [onBusyChange]);
  const allowed = enabled && !parentDirty && Number.isSafeInteger(parentRevision) && parentRevision > 0;
  const markDirty = () => { dirtyRef.current = true; setDirty(true); callback.current?.(true); setMessage(''); };
  async function load(preserve = false) {
    if (!allowed || operation.current) return;
    setPreviewFor(undefined);
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
      setState({ context, parentContext, revision, parent, stale: read.status === 'present' && read.receipt.stale,
        fields: preserve && current ? current.fields : read.status === 'present' ? [...read.receipt.definition.fields] : [] });
      setAck(false); setConflict(false);
      if (!preserve) { dirtyRef.current = false; setDirty(false); callback.current?.(false); }
    } catch { if (at === generation.current) setMessage('Questions could not be loaded. Try again.'); }
    finally { if (at === generation.current) { operation.current = false; setBusy(false); busyCallback.current?.(false); } }
  }
  function edit(index: number, change: Partial<Field>) {
    if (!current || operation.current || !allowed) return;
    const field = current.fields[index]; if (!field) return;
    setState({ ...current, fields: current.fields.map((value, i) => i === index ? { ...value, ...change } as Field : value) });
    markDirty();
  }
  const choiceCount = current?.fields.reduce((sum, field)=>sum+(field.kind==='dropdown'?field.choices.length:0),0) ?? 0;
  function opaque(prefix: string, used: readonly string[]): string | undefined {
    try { for(let attempt=0;attempt<4;attempt++) { const id=prefix+crypto.randomUUID().replaceAll('-',''); if(/^[a-z][a-z0-9_]{0,63}$/.test(id) && !used.includes(id)) return id; } } catch { /* A failed generator must not alter existing identities. */ }
    return undefined;
  }
  function addField(dropdown: boolean) {
    if(!current || !allowed || operation.current || current.fields.length>=64 || (dropdown && choiceCount>=256)) return;
    const key=opaque('question_',current.fields.map(field=>field.key)); if(!key) return;
    const id=dropdown ? opaque('choice_',[]) : undefined; if(dropdown && !id) return;
    const field: Field = dropdown ? {key,kind:'dropdown',prompt:'',required:false,choices:[{id:id!,label:''}]} : {key,kind:'text',prompt:'',required:false,minLength:0,maxLength:500};
    setState({...current,fields:[...current.fields,field]}); markDirty();
  }
  function changeChoices(index: number, update: (choices: readonly {readonly id:string;readonly label:string}[])=>readonly {readonly id:string;readonly label:string}[]) {
    if(!current || !allowed || operation.current) return;
    const field=current.fields[index]; if(field?.kind!=='dropdown') return;
    const choices=update(field.choices);
    if(choices.length<1 || choices.length>32 || choiceCount-field.choices.length+choices.length>256) return;
    edit(index,{choices});
  }
  let previewDefinition: ReturnType<typeof parseFieldDocumentV3> | undefined;
  let invalid = false;
  try { if (current) previewDefinition = parseFieldDocumentV3({schemaVersion: 3, fields: current.fields}); } catch { invalid = true; }
  const canPreview = !!current && reconciled && allowed && !busy && !conflict && !invalid && current.parent === parentRevision && (!current.stale || ack);
  const previewOpen = canPreview && previewFor === previewIdentity;
  async function save() {
    if (!current || !reconciled || !allowed || operation.current || conflict || invalid || current.parent !== parentRevision || (current.stale && !ack)) return;
    setPreviewFor(undefined);
    const at = generation.current; operation.current = true; busyCallback.current?.(true); setBusy(true); setMessage('');
    try {
      const receipt = await client.save(token, tenant, flowId, { fieldDraftVersion: 3, parentAuthoringVersion: 2, expectedRevision: current.revision, expectedFlowRevision: current.parent, definition: { schemaVersion: 3, fields: current.fields } });
      if (at !== generation.current) return;
      setState({ context, parentContext, fields: [...receipt.definition.fields], revision: receipt.draftRevision, parent: receipt.currentParentRevision, stale: receipt.stale });
      dirtyRef.current = false; setDirty(false); callback.current?.(false); setAck(false); setMessage('Questions saved as a draft.');
    } catch (error) {
      if (at !== generation.current) return;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT') { setConflict(true); setMessage('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.'); }
      else setMessage('Questions could not be saved. Your edits are kept.');
    } finally { if (at === generation.current) { operation.current = false; setBusy(false); busyCallback.current?.(false); } }
  }
  if (!enabled) return <section aria-label="Booking questions"><p>Booking questions are not available in this environment.</p></section>;
  return <section aria-label="Booking questions" onKeyDown={event => { if(event.key === 'Enter' && event.target instanceof HTMLElement && ['INPUT','SELECT'].includes(event.target.tagName)) event.preventDefault(); }}>
    <h3>Booking questions</h3><p>Prepare questions for your booking form. These drafts are not shown to customers yet.</p>
    {!allowed && <p>Save your booking flow changes before editing questions.</p>}
    <button type="button" disabled={!allowed || (statusContext === parentContext && busy)} onClick={() => void load()}>{current ? dirty ? 'Discard edits and reload' : 'Reload questions' : 'Load questions'}</button>
    {current && <>
      <button type="button" disabled={!allowed || busy} onClick={() => void load(true)}>Check latest version</button>
      {(!reconciled || current.parent !== parentRevision) && <p>The booking flow changed. Check the latest version before saving questions.</p>}
      {current.stale && <label><input type="checkbox" checked={reconciled && ack} disabled={!reconciled || busy || !allowed || current.parent !== parentRevision} onChange={event => { if (reconciled && allowed && !operation.current && current.parent === parentRevision) setAck(event.target.checked); }} />I reviewed these questions for the updated booking flow.</label>}
      <fieldset disabled={!allowed || busy}><legend>Questions</legend>
      {current.fields.map((field, index) => <fieldset key={field.key}><legend>Question {index + 1}</legend>
        <p>{field.prompt ?? 'Question needs a label'}</p>
        {field.kind !== 'dropdown' && <label>Answer format<select value={field.kind} onChange={event => { if(event.target.value === 'text' || event.target.value === 'textarea') edit(index, { kind: event.target.value }); }}><option value="text">Short answer</option><option value="textarea">Long answer</option></select></label>}
        <label>Question label<input value={field.prompt ?? ''} maxLength={400} onChange={event => edit(index, { prompt: event.target.value })} /></label>
        <label><input type="checkbox" checked={field.required} onChange={event => edit(index, { required: event.target.checked })} />Answer required</label>
        {field.kind !== 'dropdown' && <><label>Minimum characters<input type="number" min={0} max={4096} value={field.minLength} onChange={event => edit(index, { minLength: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <label>Maximum characters<input type="number" min={0} max={4096} value={field.maxLength} onChange={event => edit(index, { maxLength: event.target.value === '' ? NaN : Number(event.target.value) })} /></label></>}
        {field.kind === 'dropdown' && <fieldset><legend>Choices</legend>
          {field.choices.map((choice, choiceIndex) => <div key={choice.id}>
            <label>Choice {choiceIndex + 1} label<input maxLength={400} value={choice.label} onChange={event => changeChoices(index, choices => choices.map((value, i) => i === choiceIndex ? {...value, label:event.target.value} : value))} /></label>
            <button type="button" disabled={choiceIndex === 0} aria-label={`Move choice ${choiceIndex + 1} up`} onClick={() => changeChoices(index, choices => { if(choiceIndex === 0) return choices; const next=[...choices]; [next[choiceIndex-1],next[choiceIndex]]=[next[choiceIndex]!,next[choiceIndex-1]!]; return next; })}>Move choice up</button>
            <button type="button" disabled={choiceIndex === field.choices.length-1} aria-label={`Move choice ${choiceIndex + 1} down`} onClick={() => changeChoices(index, choices => { if(choiceIndex >= choices.length-1) return choices; const next=[...choices]; [next[choiceIndex],next[choiceIndex+1]]=[next[choiceIndex+1]!,next[choiceIndex]!]; return next; })}>Move choice down</button>
            <button type="button" disabled={field.choices.length <= 1} aria-label={`Remove choice ${choiceIndex + 1}`} onClick={() => changeChoices(index, choices => choices.length > 1 ? choices.filter((_,i)=>i!==choiceIndex) : choices)}>Remove choice</button>
          </div>)}
          <button type="button" disabled={field.choices.length >= 32 || choiceCount >= 256} onClick={() => { if(field.choices.length >= 32 || choiceCount >= 256) return; const id=opaque('choice_',field.choices.map(choice=>choice.id)); if(id) changeChoices(index, choices=>[...choices,{id,label:''}]); }}>Add choice</button>
        </fieldset>}
        <button type="button" disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => { if (!allowed || operation.current || index <= 0) return; const fields = [...current.fields]; [fields[index - 1], fields[index]] = [fields[index]!, fields[index - 1]!]; setState({ ...current, fields }); markDirty(); }}>Move up</button>
        <button type="button" disabled={index === current.fields.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => { if (!allowed || operation.current || index >= current.fields.length - 1) return; const fields = [...current.fields]; [fields[index], fields[index + 1]] = [fields[index + 1]!, fields[index]!]; setState({ ...current, fields }); markDirty(); }}>Move down</button>
        <button type="button" aria-label={`Remove question ${index + 1}`} onClick={() => { if (!allowed || operation.current) return; setState({ ...current, fields: current.fields.filter((_, i) => i !== index) }); markDirty(); }}>Remove question</button>
      </fieldset>)}
      <button type="button" disabled={current.fields.length >= 64} onClick={() => addField(false)}>Add text question</button>
      <button type="button" disabled={current.fields.length >= 64 || choiceCount >= 256} onClick={() => addField(true)}>Add dropdown question</button>
      </fieldset>
      {invalid && <p>Give each question and choice a label and check its limits.</p>}
      <button type="button" disabled={!reconciled || !allowed || busy || conflict || invalid || current.parent !== parentRevision || (current.stale && !ack)} onClick={() => void save()}>Save questions</button>
      <button type="button" disabled={!canPreview} onClick={() => { if (!canPreview || operation.current) return; setPreviewFor(previewOpen ? undefined : previewIdentity); }}>{previewOpen ? 'Close preview' : 'Try questions'}</button>
      {previewOpen && previewDefinition && <FieldQuestionPreviewV3 definition={previewDefinition} resetKey={previewIdentity} />}
    </>}
    <p role="status">{statusContext === parentContext ? (busy ? 'Working…' : message) : null}</p>
  </section>;
}
