import { useEffect, useRef, useState } from 'react';
import { listTemplates } from '@lumin/templates';
import { createTemplateAdoptionClient, TemplateAdoptionError, type AdoptionReceipt } from '../../../../packages/flow-ui/src/templateAdoptionClient';

export type TemplateAdoptionClient = ReturnType<typeof createTemplateAdoptionClient>;
export interface TemplateAdoptionPanelProps {
  client: TemplateAdoptionClient;
  token: string;
  tenant: string;
  locked?: boolean;
}
type Pending = { tenant: string; key: string; idempotencyKey: string; credentialFingerprint: string };
const catalog = listTemplates().map(template => ({ key: template.key, title: template.title }));
const storageKey = (tenant: string) => `booking-lumin:template-adoption:v1:${tenant}`;
const validPending = (value: unknown, tenant: string): value is Pending => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 4 && record.tenant === tenant && typeof record.key === 'string' && catalog.some(t => t.key === record.key) && typeof record.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(record.idempotencyKey) && typeof record.credentialFingerprint === 'string' && /^[0-9a-f]{64}$/.test(record.credentialFingerprint);
};
async function fingerprint(token: string, salt: string): Promise<string> {
  if (!crypto?.subtle || !token || !salt) throw Error('CRYPTO_UNAVAILABLE');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${token}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function stored(tenant: string): Pending | null {
  const raw = sessionStorage.getItem(storageKey(tenant));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!validPending(value, tenant)) throw Error('INVALID_STORED_OPERATION');
  return value;
}
function persist(operation: Pending) {
  const existing = stored(operation.tenant);
  if (existing && (existing.key !== operation.key || existing.idempotencyKey !== operation.idempotencyKey || existing.credentialFingerprint !== operation.credentialFingerprint)) throw Error('STORED_OPERATION_CONFLICT');
  sessionStorage.setItem(storageKey(operation.tenant), JSON.stringify(operation));
  const confirmed = stored(operation.tenant);
  if (!confirmed || confirmed.key !== operation.key || confirmed.idempotencyKey !== operation.idempotencyKey || confirmed.credentialFingerprint !== operation.credentialFingerprint) throw Error('STORAGE_NOT_DURABLE');
}
function clear(operation: Pending) {
  const existing = stored(operation.tenant);
  if (!existing || existing.key !== operation.key || existing.idempotencyKey !== operation.idempotencyKey || existing.credentialFingerprint !== operation.credentialFingerprint) throw Error('STORED_OPERATION_CONFLICT');
  sessionStorage.removeItem(storageKey(operation.tenant));
  if (stored(operation.tenant)) throw Error('STORAGE_NOT_CLEARED');
}
const messageFor = (code: string) => {
  if (code === 'COMMIT_UNCERTAIN' || code === 'OUTCOME_UNKNOWN') return 'The result is uncertain. An inactive draft will not appear in the active services list. Retry this same request to reconcile it.';
  if (code === 'FORBIDDEN') return 'An active business owner account is required.';
  if (code === 'CONFLICT') return 'This request conflicts with an earlier result. Check the draft before starting again.';
  if (code === 'UNAUTHENTICATED') return 'Sign in again before adding a service template.';
  return 'The service template could not be added. Please check the request and try again.';
};

/** Connected owner action only. Success creates an INACTIVE service draft. */
export function TemplateAdoptionPanel({ client, token, tenant, locked = false }: TemplateAdoptionPanelProps) {
  const [selected, setSelected] = useState(catalog[0]?.key ?? '');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [receipt, setReceipt] = useState<AdoptionReceipt | null>(null);
  const [error, setError] = useState('');
  const [storageBlocked, setStorageBlocked] = useState(true);
  const busyRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const contextRef = useRef({ token, tenant, client });
  const generation = useRef(0);
  // Update before effects so a late promise from the previous identity cannot paint a result.
  contextRef.current = { token, tenant, client };
  useEffect(() => {
    generation.current++;
    const at = generation.current;
    let disposed = false;
    busyRef.current = false;
    pendingRef.current = null;
    setBusy(false); setPending(null); setReceipt(null); setError(''); setStorageBlocked(true);
    void (async () => {
      try {
        const recovered = stored(tenant);
        if (recovered && await fingerprint(token, recovered.idempotencyKey) !== recovered.credentialFingerprint) throw Error('DIFFERENT_OWNER_SESSION');
        if (disposed || at !== generation.current) return;
        if (recovered) { pendingRef.current = recovered; setPending(recovered); setSelected(recovered.key); }
        setStorageBlocked(false);
      } catch {
        if (disposed || at !== generation.current) return;
        setStorageBlocked(true); setError('Saved request tracking belongs to another or unavailable owner session. No new request was sent.');
      }
    })();
    return () => { disposed = true; generation.current++; client.invalidate(); };
  }, [client, token, tenant]);

  async function adopt() {
    if (locked || storageBlocked || busyRef.current || !selected || !token || !tenant) return;
    busyRef.current = true; setBusy(true);
    const current = contextRef.current;
    const at = generation.current;
    let operation: Pending | null = null;
    try {
      const recovered = stored(tenant);
      if (pendingRef.current && (!recovered || recovered.key !== pendingRef.current.key || recovered.idempotencyKey !== pendingRef.current.idempotencyKey || recovered.credentialFingerprint !== pendingRef.current.credentialFingerprint)) throw Error('STORED_OPERATION_CONFLICT');
      operation = recovered ?? pendingRef.current;
      if (operation && operation.key !== selected) throw Error('STORED_OPERATION_CONFLICT');
      if (operation && await fingerprint(token, operation.idempotencyKey) !== operation.credentialFingerprint) throw Error('DIFFERENT_OWNER_SESSION');
      if (!operation) {
        const idempotencyKey = crypto.randomUUID();
        if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw Error();
        operation = { tenant, key: selected, idempotencyKey, credentialFingerprint: await fingerprint(token, idempotencyKey) };
        persist(operation);
      }
      if (at !== generation.current || contextRef.current.token !== current.token || contextRef.current.tenant !== current.tenant || contextRef.current.client !== current.client) return;
      pendingRef.current = operation; setPending(operation);
    } catch {
      if (at === generation.current && contextRef.current.token === current.token && contextRef.current.tenant === current.tenant && contextRef.current.client === current.client) {
        setStorageBlocked(true); setError('A secure saved request key is unavailable for this owner session. No request was sent.');
        busyRef.current = false; setBusy(false);
      }
      return;
    }
    setError(''); setReceipt(null);
    try {
      const next = await client.adopt(token, tenant, operation.key, operation.idempotencyKey);
      if (at !== generation.current || contextRef.current.token !== current.token || contextRef.current.tenant !== current.tenant || contextRef.current.client !== current.client) return;
      if (next.templateKey !== operation.key || next.active !== false) throw Error('INVALID_RECEIPT');
      try { clear(operation); pendingRef.current = null; setPending(null); setReceipt(next); }
      catch { setStorageBlocked(true); setError('The draft was created, but saved request tracking could not be cleared. Do not start another request.'); setReceipt(next); }
    } catch (cause) {
      if (at !== generation.current || contextRef.current.token !== current.token || contextRef.current.tenant !== current.tenant || contextRef.current.client !== current.client) return;
      const code = cause instanceof TemplateAdoptionError ? cause.code : 'OUTCOME_UNKNOWN';
      if (code !== 'COMMIT_UNCERTAIN' && code !== 'OUTCOME_UNKNOWN') {
        try { clear(operation); pendingRef.current = null; setPending(null); }
        catch { setStorageBlocked(true); setError('Saved request tracking could not be cleared. No new request can be sent.'); return; }
      }
      setError(messageFor(code));
    } finally {
      if (at === generation.current && contextRef.current.token === current.token && contextRef.current.tenant === current.tenant && contextRef.current.client === current.client) { busyRef.current = false; setBusy(false); }
    }
  }

  return <section aria-labelledby="template-adoption-title">
    <h2 id="template-adoption-title">Start from a service template</h2>
    <p>Choose a starting point for a new service draft. Review its pricing and availability before publishing it.</p>
    <label htmlFor="template-adoption-choice">Service template</label>
    <select id="template-adoption-choice" value={selected} disabled={locked || storageBlocked || busy || pending !== null} onChange={event => { setSelected(event.target.value); setReceipt(null); setError(''); }}>
      {catalog.map(template => <option key={template.key} value={template.key}>{template.title}</option>)}
    </select>
    <button type="button" disabled={locked || storageBlocked || busy || !selected} onClick={() => void adopt()}>{pending ? 'Retry same request' : 'Create inactive draft'}</button>
    {pending && <p role="status">The previous attempt may have created a draft. Retrying uses the same request key and cannot create a second draft for this attempt.</p>}
    {error && <p role="alert">{error}</p>}
    {receipt && <div role="status"><strong>Inactive draft created</strong><p>Service reference: {receipt.serviceId}. This service is not bookable and will not appear in the active services list until you review and activate it.</p></div>}
  </section>;
}
