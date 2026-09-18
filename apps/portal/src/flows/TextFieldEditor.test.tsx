import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TextFieldDraftClient } from '../../../../packages/flow-ui/src/textFieldDraftClient';
import { TextFieldEditor } from './TextFieldEditor';
afterEach(cleanup);
const tenant = '11111111-1111-4111-8111-111111111111', flowId = '22222222-2222-4222-8222-222222222222';
const field = { key: 'legacy_internal', kind: 'text' as const, required: false, minLength: 0, maxLength: 100 };
const receipt = (fields = [field]) => ({ textDraftVersion: 1 as const, parentAuthoringVersion: 2 as const, draftRevision: 2, savedParentRevision: 3, currentParentRevision: 3, definition: { schemaVersion: 1 as const, fields }, runtimePublishable: false as const, stale: false });
function setup() {
 const client: TextFieldDraftClient = { invalidate: vi.fn(), read: vi.fn<TextFieldDraftClient['read']>().mockResolvedValue({ status: 'present', receipt: receipt() }), save: vi.fn<TextFieldDraftClient['save']>().mockResolvedValue(receipt()) };
 const props = { client, token: 'test-owner-token', tenant, flowId, parentRevision: 3, parentDirty: false, enabled: true, onDirtyChange: vi.fn() };
 return { client, props };
}
async function load() { fireEvent.click(screen.getByText('Load questions')); await screen.findByText('Question needs a label'); }
it('preserves untouched legacy omission and sends exact dual CAS without exposing internal key', async () => {
 const { client, props } = setup(); const view = render(<TextFieldEditor {...props} />); await load();
 expect(view.container.textContent).not.toContain(field.key);
 fireEvent.click(screen.getByText('Save questions')); await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
 expect(client.save).toHaveBeenCalledWith(props.token, tenant, flowId, { textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: 2, expectedFlowRevision: 3, definition: { schemaVersion: 1, fields: [field] } });
});
it('keeps stable keys, escapes labels and tracks dirty changes', async () => {
 const { client, props } = setup(); render(<TextFieldEditor {...props} />); await load();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: '<img src=x onerror=alert(1)>' } });
 expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(document.querySelector('img')).toBeNull();
 fireEvent.click(screen.getByText('Save questions')); await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
 expect(vi.mocked(client.save).mock.calls[0]?.[3]).toMatchObject({ definition: { fields: [{ ...field, prompt: '<img src=x onerror=alert(1)>' }] } });
 await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(false));
});
it('requires a label after editing a legacy question, but allows untouched omission', async () => {
 const { props } = setup(); render(<TextFieldEditor {...props} />); await load();
 fireEvent.click(screen.getByLabelText('Answer required')); expect(screen.getByText('Save questions')).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Your instructions' } }); expect(screen.getByText('Save questions')).not.toBeDisabled();
});
it('preserves edits on conflict and never retries automatically', async () => {
 const { client, props } = setup(); vi.mocked(client.save).mockRejectedValue({ code: 'CONFLICT' }); render(<TextFieldEditor {...props} />); await load();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Keep my edit' } }); fireEvent.click(screen.getByText('Save questions'));
 await screen.findByText(/Questions changed elsewhere/); expect(screen.getByLabelText('Question label')).toHaveValue('Keep my edit'); expect(screen.getByText('Save questions')).toBeDisabled(); expect(client.save).toHaveBeenCalledTimes(1);
});
it('clears old tenant display and ignores old pending read completion', async () => {
 const { client, props } = setup(); let finish!: (value: Awaited<ReturnType<TextFieldDraftClient['read']>>) => void;
 vi.mocked(client.read).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const view = render(<TextFieldEditor {...props} />); fireEvent.click(screen.getByText('Load questions'));
 view.rerender(<TextFieldEditor {...props} tenant="33333333-3333-4333-8333-333333333333" />);
 await act(async () => finish({ status: 'present', receipt: receipt() }));
 expect(screen.queryByLabelText('Question label')).toBeNull(); expect(client.invalidate).toHaveBeenCalled(); expect(screen.getByText('Load questions')).not.toBeDisabled();
 view.unmount(); expect(client.invalidate).toHaveBeenCalledTimes(2);
});
it('preserves unsaved fields across parent edits and requires fresh read then acknowledgement', async () => {
 const { client, props } = setup(); const view = render(<TextFieldEditor {...props} />); await load();
 fireEvent.change(screen.getByLabelText('Question label'), { target: { value: 'Keep this question' } });
 view.rerender(<TextFieldEditor {...props} parentDirty parentRevision={4} />); expect(screen.getByLabelText('Question label')).toHaveValue('Keep this question'); expect(screen.getByText('Save questions')).toBeDisabled();
 view.rerender(<TextFieldEditor {...props} parentRevision={4} />);
 vi.mocked(client.read).mockResolvedValue({ status: 'present', receipt: { ...receipt(), currentParentRevision: 4, stale: true } });
 fireEvent.click(screen.getByText('Check latest version')); await screen.findByLabelText('I reviewed these questions for the updated booking flow.');
 expect(screen.getByText('Save questions')).toBeDisabled(); expect(screen.getByLabelText('Question label')).toHaveValue('Keep this question');
 fireEvent.click(screen.getByLabelText('I reviewed these questions for the updated booking flow.')); fireEvent.click(screen.getByText('Save questions'));
 await waitFor(() => expect(client.save).toHaveBeenCalled()); expect(vi.mocked(client.save).mock.calls[0]?.[3]).toMatchObject({ expectedRevision: 2, expectedFlowRevision: 4 });
});
it('requires labels on newly added questions and supports accessible ordering/removal', async () => {
 const { props } = setup(); render(<TextFieldEditor {...props} />); await load(); fireEvent.click(screen.getByText('Add text question'));
 expect(screen.getByText('Save questions')).toBeDisabled(); fireEvent.change(screen.getAllByLabelText('Question label')[1]!, { target: { value: 'New question' } });
 fireEvent.click(screen.getByLabelText('Move question 2 up')); expect(screen.getAllByLabelText('Question label')[0]).toHaveValue('New question');
 fireEvent.click(screen.getByLabelText('Remove question 1')); expect(screen.getAllByLabelText('Question label')).toHaveLength(1);
});
it('does no work when capability disabled or parent has never been saved', () => {
 const { client, props } = setup(); const view = render(<TextFieldEditor {...props} enabled={false} />); expect(screen.queryByText('Load questions')).toBeNull();
 view.rerender(<TextFieldEditor {...props} parentRevision={0} />); expect(screen.getByText('Load questions')).toBeDisabled(); expect(client.read).not.toHaveBeenCalled();
});
it('reports busy synchronously for deferred read and unchanged save, clearing on settlement', async () => {
 const { client, props } = setup(); const onBusyChange = vi.fn();
 let readDone!: (value: Awaited<ReturnType<TextFieldDraftClient['read']>>) => void;
 let saveDone!: (value: Awaited<ReturnType<TextFieldDraftClient['save']>>) => void;
 vi.mocked(client.read).mockImplementationOnce(() => new Promise(resolve => { readDone = resolve; }));
 vi.mocked(client.save).mockImplementationOnce(() => new Promise(resolve => { saveDone = resolve; }));
 render(<TextFieldEditor {...props} onBusyChange={onBusyChange} />);
 fireEvent.click(screen.getByText('Load questions')); expect(onBusyChange).toHaveBeenLastCalledWith(true);
 await act(async () => readDone({ status: 'present', receipt: receipt() })); expect(onBusyChange).toHaveBeenLastCalledWith(false);
 expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
 fireEvent.click(screen.getByText('Save questions')); expect(onBusyChange).toHaveBeenLastCalledWith(true);
 await act(async () => saveDone(receipt())); expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
it('does not let old context read settlement clear a new operation busy flag', async () => {
 const { client, props } = setup(); const onBusyChange = vi.fn();
 const finishes: ((value: Awaited<ReturnType<TextFieldDraftClient['read']>>) => void)[] = [];
 vi.mocked(client.read).mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
 const view = render(<TextFieldEditor {...props} onBusyChange={onBusyChange} />);
 fireEvent.click(screen.getByText('Load questions')); expect(onBusyChange).toHaveBeenLastCalledWith(true);
 view.rerender(<TextFieldEditor {...props} tenant="33333333-3333-4333-8333-333333333333" onBusyChange={onBusyChange} />);
 expect(onBusyChange).toHaveBeenLastCalledWith(false);
 fireEvent.click(screen.getByText('Load questions')); const count = onBusyChange.mock.calls.length;
 await act(async () => finishes[0]!({ status: 'present', receipt: receipt() }));
 expect(onBusyChange).toHaveBeenCalledTimes(count); expect(onBusyChange).toHaveBeenLastCalledWith(true);
 await act(async () => finishes[1]!({ status: 'present', receipt: receipt() })); expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
it('publishes current busy state to a replaced callback without restarting the request', async () => {
 const { client, props } = setup(); const first = vi.fn(), second = vi.fn();
 let finish!: (value: Awaited<ReturnType<TextFieldDraftClient['read']>>) => void;
 vi.mocked(client.read).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const view = render(<TextFieldEditor {...props} onBusyChange={first} />); fireEvent.click(screen.getByText('Load questions'));
 view.rerender(<TextFieldEditor {...props} onBusyChange={second} />); expect(second).toHaveBeenLastCalledWith(true);
 const previous = first.mock.calls.length;
 await act(async () => finish({ status: 'present', receipt: receipt() }));
 expect(second).toHaveBeenLastCalledWith(false); expect(first).toHaveBeenCalledTimes(previous); expect(client.read).toHaveBeenCalledTimes(1);
});
it('clears busy on unmount and ignores late save completion', async () => {
 const { client, props } = setup(); const onBusyChange = vi.fn();
 let finish!: (value: Awaited<ReturnType<TextFieldDraftClient['save']>>) => void;
 vi.mocked(client.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const view = render(<TextFieldEditor {...props} onBusyChange={onBusyChange} />); await load();
 fireEvent.click(screen.getByText('Save questions')); expect(onBusyChange).toHaveBeenLastCalledWith(true);
 view.unmount(); expect(onBusyChange).toHaveBeenLastCalledWith(false); const count = onBusyChange.mock.calls.length;
 await act(async () => finish(receipt())); expect(onBusyChange).toHaveBeenCalledTimes(count); expect(client.invalidate).toHaveBeenCalledTimes(1);
});
