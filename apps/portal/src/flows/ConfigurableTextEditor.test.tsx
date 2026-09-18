import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createFlowClient } from '@lumin/flow-ui';
import type { TextFieldDraftClient } from '../../../../packages/flow-ui/src/textFieldDraftClient';
import { ConfigurableEditor } from './ConfigurableEditor';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const tenant = '11111111-1111-4111-8111-111111111111', flow = '22222222-2222-4222-8222-222222222222';
const service = { id: tenant, name: 'Service', durationMinutes: 30, questions: [{ id: 'required', prompt: 'Mode', kind: 'single_choice' as const, required: true, choices: [{ id: 'a', label: 'A' }] }] };
const authoring = { authoringVersion: 2, config: { key: 'request', steps: [{ key: 'r', questionKey: 'required', kind: 'question', required: true }] }, questionOverrides: {} };
const field = { key: 'internal', kind: 'text' as const, required: false, minLength: 0, maxLength: 100 };
const receipt = { textDraftVersion: 1 as const, parentAuthoringVersion: 2 as const, draftRevision: 1, savedParentRevision: 4, currentParentRevision: 4, definition: { schemaVersion: 1 as const, fields: [field] }, runtimePublishable: false as const, stale: false };
function setup(enabled = true) {
 const fetcher = vi.fn(async (url: string, options: RequestInit) => {
  const data = url.includes('/draft') ? options.method === 'POST' ? { flowId: flow, revision: 5, authoringVersion: 2 } : { flowId: flow, revision: 4, name: 'Saved form', serviceId: tenant, authoring, effectiveService: service } : { flows: [{ flowId: flow, name: 'Saved form', revision: 4, status: 'draft', serviceId: tenant, publishedVersionId: null }] };
  return new Response(JSON.stringify({ ok: true, data }));
 });
 const text: TextFieldDraftClient = { invalidate: vi.fn(), read: vi.fn<TextFieldDraftClient['read']>().mockResolvedValue({ status: 'present', receipt }), save: vi.fn<TextFieldDraftClient['save']>().mockResolvedValue(receipt) };
 const props = { client: createFlowClient('https://api.example', false, fetcher as unknown as typeof fetch), token: 'owner-token-valid', tenant, services: [service], textDraftClient: text, ...(enabled ? { textDraftEnabled: true } : {}), onTextStateChange: vi.fn() };
 return { props, fetcher, text };
}
async function select() { await screen.findByText('Saved form'); fireEvent.change(screen.getByLabelText('Saved configurable questionnaire'), { target: { value: flow } }); await waitFor(() => expect(screen.getByLabelText('Configurable questionnaire name')).toHaveValue('Saved form'));  }
async function loadText() { fireEvent.click(screen.getByText('Load questions')); await screen.findByText('Question needs a label'); }
it('defaults text capability off and performs no text requests', async () => {
 const { props, text } = setup(false); render(<ConfigurableEditor {...props} />); await select(); expect(screen.queryByText('Load questions')).toBeNull(); expect(text.read).not.toHaveBeenCalled();
});
it('passes selected persisted V2 tuple to actual text editor without publishing', async () => {
 const { props, text, fetcher } = setup(); render(<ConfigurableEditor {...props} />); await select(); await loadText();
 expect(text.read).toHaveBeenCalledWith(props.token, tenant, flow); fireEvent.click(screen.getByText('Save questions')); await waitFor(() => expect(text.save).toHaveBeenCalled());
 expect(vi.mocked(text.save).mock.calls[0]?.[3]).toMatchObject({ expectedRevision: 1, expectedFlowRevision: 4 });
 expect(fetcher.mock.calls.every(([url]) => !url.includes('/publish'))).toBe(true);
});
it('preserves text edits across parent save and requires latest revision reconciliation', async () => {
 const { props } = setup(); render(<ConfigurableEditor {...props} />); await select(); await loadText();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Keep text' } });
 fireEvent.change(screen.getByLabelText('Configurable questionnaire name'), { target: { value: 'New name' } });
 expect(screen.getByText('Save questions')).toBeDisabled(); fireEvent.click(screen.getByText('Save configurable questionnaire'));
 await screen.findByText('Saved revision 5'); expect(screen.getByLabelText('Question label')).toHaveValue('Keep text');
 expect(screen.getByText('Save questions')).toBeDisabled(); expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: true, busy: false });
});
it('declining discard preserves edits; accepting new selection clears text state once', async () => {
 const { props, text } = setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); render(<ConfigurableEditor {...props} />); await select(); await loadText();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Keep text' } });
 fireEvent.click(screen.getByText('New configurable questionnaire')); expect(confirm).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Question label')).toHaveValue('Keep text');
 confirm.mockReturnValue(true); fireEvent.click(screen.getByText('New configurable questionnaire'));
 expect(screen.queryByLabelText('Question label')).toBeNull(); expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false }); expect(text.invalidate).toHaveBeenCalled();
});
it('blocks parent changes during unchanged text save and publishes synchronous busy state', async () => {
 const { props, text } = setup(); let finish!: (value: typeof receipt) => void; vi.mocked(text.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 render(<ConfigurableEditor {...props} />); await select(); await loadText(); fireEvent.click(screen.getByText('Save questions'));
 expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: true }); expect(screen.getByText('New configurable questionnaire')).toBeDisabled(); expect(screen.getByLabelText('Saved configurable questionnaire')).toBeDisabled();
 await act(async () => finish(receipt)); expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false });
});
it('clears selected text context when the account changes', async () => {
 const { props, text } = setup(); const view = render(<ConfigurableEditor {...props} />); await select(); await loadText();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Old account edit' } });
 view.rerender(<ConfigurableEditor {...props} token="different-owner-token" />);
 expect(screen.queryByDisplayValue('Old account edit')).toBeNull(); expect(text.invalidate).toHaveBeenCalled(); expect(screen.queryByLabelText('Question label')).toBeNull();
});

it('same-flow refresh preserves unsaved text and does not ask to discard it', async () => {
 const { props } = setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
 render(<ConfigurableEditor {...props} />); await select(); await loadText();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Keep across refresh' } });
 fireEvent.click(screen.getByText('Refresh configurable saved version (discard edits)'));
 await waitFor(() => expect(screen.getByText('Refresh configurable saved version (discard edits)')).not.toBeDisabled());
 expect(screen.getByLabelText('Question label')).toHaveValue('Keep across refresh'); expect(confirm).not.toHaveBeenCalled();
});

it('replacement observer immediately receives retained dirty and busy state', async () => {
 const { props, text } = setup(); let finish!: (value: typeof receipt) => void;
 vi.mocked(text.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const view = render(<ConfigurableEditor {...props} />); await select(); await loadText();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Retained edit' } });
 const replacement = vi.fn(); view.rerender(<ConfigurableEditor {...props} onTextStateChange={replacement} />);
 expect(replacement).toHaveBeenLastCalledWith({ dirty: true, busy: false });
 fireEvent.click(screen.getByText('Save questions'));
 const next = vi.fn(); view.rerender(<ConfigurableEditor {...props} onTextStateChange={next} />);
 expect(next).toHaveBeenLastCalledWith({ dirty: true, busy: true });
 expect(screen.getByLabelText('Question label')).toHaveValue('Retained edit');
 await act(async () => finish(receipt)); expect(next).toHaveBeenLastCalledWith({ dirty: false, busy: false });
 view.unmount(); expect(next).toHaveBeenLastCalledWith({ dirty: false, busy: false });
});

it('capability removal resets text state, preserves selection and fences pending save', async () => {
 const { props, text } = setup(); let finish!: (value: typeof receipt) => void;
 vi.mocked(text.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const view = render(<ConfigurableEditor {...props} />); await select(); await loadText();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Removed edit' } });
 fireEvent.click(screen.getByText('Save questions'));
 expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: true, busy: true });
 const reads = vi.mocked(text.read).mock.calls.length, saves = vi.mocked(text.save).mock.calls.length;
 view.rerender(<ConfigurableEditor {...props} textDraftEnabled={false} />);
 expect(screen.queryByLabelText('Question label')).toBeNull(); expect(screen.queryByText('Load questions')).toBeNull();
 expect(screen.getByLabelText('Configurable questionnaire name')).toHaveValue('Saved form');
 expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false }); expect(text.invalidate).toHaveBeenCalled();
 expect(screen.getByText('New configurable questionnaire')).not.toBeDisabled();
 await act(async () => finish(receipt));
 expect(props.onTextStateChange).toHaveBeenLastCalledWith({ dirty: false, busy: false });
 expect(text.read).toHaveBeenCalledTimes(reads); expect(text.save).toHaveBeenCalledTimes(saves);
});
