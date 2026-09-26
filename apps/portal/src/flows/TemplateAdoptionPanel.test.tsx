import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { TemplateAdoptionPanel, type TemplateAdoptionClient } from './TemplateAdoptionPanel';
import { TemplateAdoptionError } from '../../../../packages/flow-ui/src/templateAdoptionClient';
import { webcrypto } from 'node:crypto';

const tenant = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const token = 'verified-owner-token';
const key = 'junk-removal';
const operation = '33333333-3333-4333-8333-333333333333';
function client(adopt: TemplateAdoptionClient['adopt'] = vi.fn(async () => ({ serviceId, templateKey: key, active: false as const }))) {
  return { adopt: vi.fn(adopt), invalidate: vi.fn() } as TemplateAdoptionClient;
}

beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', { randomUUID: vi.fn(() => operation), subtle: webcrypto.subtle }); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Create inactive draft' })).toBeEnabled());

it('creates one inactive draft using a new secure key and shows no activation claim', async () => {
  const c = client();
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByText('Inactive draft created')).toBeInTheDocument());
  expect(c.adopt).toHaveBeenCalledWith(token, tenant, key, operation);
  expect(c.adopt).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/not bookable/)).toBeInTheDocument();
});

it('retains the exact key after uncertainty and only retries on a deliberate click', async () => {
  const c = client(vi.fn().mockRejectedValueOnce(new TemplateAdoptionError('COMMIT_UNCERTAIN')).mockResolvedValueOnce({ serviceId, templateKey: key, active: false }));
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('uncertain'));
  expect(c.adopt).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('combobox')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(screen.getByText('Inactive draft created')).toBeInTheDocument());
  expect(c.adopt).toHaveBeenCalledTimes(2);
  expect(vi.mocked(c.adopt).mock.calls.map(call => call[3])).toEqual([operation, operation]);
  expect(vi.mocked(crypto.randomUUID)).toHaveBeenCalledTimes(1);
});

it('blocks a double-click while the owner request is in flight', async () => {
  let finish!: (value: { serviceId: string; templateKey: string; active: false }) => void;
  const c = client(vi.fn<TemplateAdoptionClient['adopt']>(() => new Promise(resolve => { finish = resolve; })));
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  const button = screen.getByRole('button', { name: 'Create inactive draft' });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(c.adopt).toHaveBeenCalledTimes(1));
  finish({ serviceId, templateKey: key, active: false });
  await waitFor(() => expect(screen.getByText('Inactive draft created')).toBeInTheDocument());
});

it.each(['FORBIDDEN', 'CONFLICT'] as const)('shows %s as a definitive failure and allows a new attempt', async code => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce(operation).mockReturnValueOnce('55555555-5555-4555-8555-555555555555'), subtle: webcrypto.subtle });
  const c = client(vi.fn<TemplateAdoptionClient['adopt']>().mockRejectedValueOnce(new TemplateAdoptionError(code)).mockResolvedValueOnce({ serviceId, templateKey: key, active: false }));
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Create inactive draft' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByText('Inactive draft created')).toBeInTheDocument());
  expect(vi.mocked(c.adopt).mock.calls.map(call => call[3])).toEqual([operation, '55555555-5555-4555-8555-555555555555']);
  expect(vi.mocked(crypto.randomUUID)).toHaveBeenCalledTimes(2);
});

it('drops an old tenant result and invalidates old client context', async () => {
  let finish!: (value: { serviceId: string; templateKey: string; active: false }) => void;
  const c = client(vi.fn<TemplateAdoptionClient['adopt']>(() => new Promise(resolve => { finish = resolve; })));
  const view = render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(c.adopt).toHaveBeenCalledTimes(1));
  view.rerender(<TemplateAdoptionPanel client={c} token={token} tenant="44444444-4444-4444-8444-444444444444"/>);
  expect(c.invalidate).toHaveBeenCalled();
  finish({ serviceId, templateKey: key, active: false });
  await Promise.resolve(); await Promise.resolve();
  expect(screen.queryByText('Inactive draft created')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create inactive draft' })).toBeEnabled();
});

it('persists an uncertain operation across unmount and remount, then explicitly retries with the same key', async () => {
  const c = client(vi.fn<TemplateAdoptionClient['adopt']>().mockRejectedValueOnce(new TemplateAdoptionError('OUTCOME_UNKNOWN')).mockResolvedValueOnce({ serviceId, templateKey: key, active: false }));
  const first = render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('uncertain'));
  expect(sessionStorage.getItem(`booking-lumin:template-adoption:v1:${tenant}`)).toContain(operation);
  first.unmount();
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same request' })).toBeEnabled());
  expect(c.adopt).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(screen.getByText('Inactive draft created')).toBeInTheDocument());
  expect(vi.mocked(c.adopt).mock.calls.map(call => call[3])).toEqual([operation, operation]);
  expect(vi.mocked(crypto.randomUUID)).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(`booking-lumin:template-adoption:v1:${tenant}`)).toBeNull();
});

it('blocks a different credential on the same tenant without sending or rotating', async () => {
  const c = client(vi.fn<TemplateAdoptionClient['adopt']>().mockRejectedValueOnce(new TemplateAdoptionError('OUTCOME_UNKNOWN')));
  const first = render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('uncertain'));
  first.unmount();
  render(<TemplateAdoptionPanel client={c} token="different-owner-token" tenant={tenant}/>);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('another or unavailable owner session'));
  expect(screen.getByRole('button', { name: 'Create inactive draft' })).toBeDisabled();
  expect(c.adopt).toHaveBeenCalledTimes(1);
  expect(vi.mocked(crypto.randomUUID)).toHaveBeenCalledTimes(1);
});

it('fails closed on corrupt saved tracking without rotating key or dispatching', async () => {
  sessionStorage.setItem(`booking-lumin:template-adoption:v1:${tenant}`, JSON.stringify({ tenant, key, idempotencyKey: 'bad' }));
  const c = client();
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  expect(screen.getByRole('button', { name: 'Create inactive draft' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('tracking belongs to another or unavailable'));
  expect(c.adopt).not.toHaveBeenCalled();
});

it('fails closed when session storage cannot be read', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('storage denied'); });
  try {
    const c = client();
    render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
    expect(screen.getByRole('button', { name: 'Create inactive draft' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('tracking belongs to another or unavailable'));
    expect(c.adopt).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});

it('refuses a secure-key generator failure without contacting the server', async () => {
  vi.stubGlobal('crypto', { randomUUID: () => { throw Error('unavailable'); }, subtle: webcrypto.subtle });
  const c = client();
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('secure saved request key'));
  expect(c.adopt).not.toHaveBeenCalled();
});

it('fails closed before dispatch when WebCrypto digest is unavailable', async () => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => operation) });
  const c = client();
  render(<TemplateAdoptionPanel client={c} token={token} tenant={tenant}/>);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Create inactive draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('secure saved request key'));
  expect(c.adopt).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(`booking-lumin:template-adoption:v1:${tenant}`)).toBeNull();
});
