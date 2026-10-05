import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DetailingTestPaymentPanel, type DetailingTestPaymentPanelProps, type DetailingTestPaymentState } from './DetailingTestPaymentPanel';

afterEach(cleanup);

function props(state: DetailingTestPaymentState): DetailingTestPaymentPanelProps {
  return {
    state, formattedTotal: '$77.77', reference: 'LMN-STAGING-BOOKING',
    onCheckAvailability: vi.fn(), onCompleteTestPayment: vi.fn(),
    onCheckStatus: vi.fn(), onReplayConfirmation: vi.fn(),
  };
}

it('never fetches or starts an action on render, state transitions, or mount', () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const actions = props({ phase: 'unavailable', canCheckAvailability: true });
  try {
    const view = render(<DetailingTestPaymentPanel {...actions} />);
    for (const state of [{ phase: 'ready' }, { phase: 'unverified' }, { phase: 'confirmed', canReplayConfirmation: true }] as const) {
      view.rerender(<DetailingTestPaymentPanel {...actions} state={state} />);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(actions.onCheckAvailability).not.toHaveBeenCalled();
    expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
    expect(actions.onCheckStatus).not.toHaveBeenCalled();
    expect(actions.onReplayConfirmation).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});

it('checks availability only on an explicit click and waits for parent truth before offering payment', () => {
  const actions = props({ phase: 'unavailable', canCheckAvailability: true });
  const view = render(<DetailingTestPaymentPanel {...actions} />);
  expect(screen.queryByRole('button', { name: 'Complete test payment' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check test payment availability' }));
  expect(actions.onCheckAvailability).toHaveBeenCalledTimes(1);
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  view.rerender(<DetailingTestPaymentPanel {...actions} state={{ phase: 'ready' }} />);
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Complete test payment' }));
  expect(actions.onCompleteTestPayment).toHaveBeenCalledTimes(1);
  expect(actions.onCheckStatus).not.toHaveBeenCalled();
  expect(actions.onReplayConfirmation).not.toHaveBeenCalled();
});

it.each([
  { phase: 'checking' }, { phase: 'paying' },
  { phase: 'unverified', checkingStatus: true },
] as const)('disables actions during $phase and makes no confirmed claim', state => {
  const actions = props(state);
  render(<DetailingTestPaymentPanel {...actions} />);
  const action = screen.getByRole('button');
  expect(action).toBeDisabled();
  fireEvent.click(action);
  expect(actions.onCheckAvailability).not.toHaveBeenCalled();
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  expect(actions.onCheckStatus).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Staging test payment' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('STAGING TEST — no money charged.')).toBeVisible();
  expect(screen.queryByText(/This booking is confirmed/)).toBeNull();
});

it('keeps unknown outcomes neutral and permits only checking the same booking', () => {
  const actions = props({ phase: 'unverified' });
  render(<DetailingTestPaymentPanel {...actions} />);
  expect(screen.getByRole('alert')).toHaveTextContent('status are unverified');
  expect(screen.getByText(/Do not start another booking/)).toBeVisible();
  expect(screen.getByText('STAGING TEST — no money charged.')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/payment failed|payment succeeded|booking is confirmed|active hold|paid/i);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Check test payment status' }));
  expect(actions.onCheckStatus).toHaveBeenCalledTimes(1);
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  expect(actions.onReplayConfirmation).not.toHaveBeenCalled();
});

it.each([
  { recovery: 'retry-payment', label: 'Retry the same test payment', callback: 'onCompleteTestPayment' },
  { recovery: 'confirm', label: 'Verify the same test confirmation', callback: 'onReplayConfirmation' },
] as const)('offers only the explicit parent-permitted $recovery action while keeping the outcome unverified', ({ recovery, label, callback }) => {
  const actions = props({ phase: 'unverified', recovery });
  const view = render(<DetailingTestPaymentPanel {...actions} />);
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  expect(actions.onReplayConfirmation).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('status are unverified');
  expect(screen.getByText(/Do not start another booking/)).toBeVisible();
  expect(screen.queryByText(/This booking is confirmed/)).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(actions[callback]).toHaveBeenCalledTimes(1);
  expect(actions.onCheckStatus).not.toHaveBeenCalled();
  expect(actions[callback === 'onCompleteTestPayment' ? 'onReplayConfirmation' : 'onCompleteTestPayment']).not.toHaveBeenCalled();
  // Dispatching the recovery callback alone never changes the rendered truth.
  expect(screen.getByRole('alert')).toHaveTextContent('status are unverified');
  view.rerender(<DetailingTestPaymentPanel {...actions} busy />);
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
});

it('disables unknown confirmation recovery when its parent callback is absent', () => {
  render(<DetailingTestPaymentPanel {...props({ phase: 'unverified', recovery: 'confirm' })} onReplayConfirmation={undefined} />);
  expect(screen.getByRole('button', { name: 'Verify the same test confirmation' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('status are unverified');
});

it('renders confirmed staging truth, authoritative values, and no request or hold claims', () => {
  render(<DetailingTestPaymentPanel {...props({ phase: 'confirmed' })} />);
  expect(screen.getByRole('status')).toHaveTextContent('This booking is confirmed in the staging test.');
  expect(screen.getByText('STAGING TEST — no money charged.')).toBeVisible();
  expect(screen.getByText('$77.77')).toBeVisible();
  expect(screen.getByText('LMN-STAGING-BOOKING')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.body.textContent).not.toMatch(/active hold|request remains unconfirmed|invoice|notification|paid/i);
});

it('exposes exact confirmation replay only when the parent permits it and supplies its callback', () => {
  const actions = props({ phase: 'confirmed', canReplayConfirmation: true });
  const view = render(<DetailingTestPaymentPanel {...actions} />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify the same test confirmation' }));
  expect(actions.onReplayConfirmation).toHaveBeenCalledTimes(1);
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  view.rerender(<DetailingTestPaymentPanel {...actions} state={{ phase: 'confirmed', canReplayConfirmation: false }} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<DetailingTestPaymentPanel {...actions} onReplayConfirmation={undefined} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it.each([
  { phase: 'unavailable', canCheckAvailability: true }, { phase: 'ready' },
  { phase: 'unverified' }, { phase: 'confirmed', canReplayConfirmation: true },
] as const)('disables $phase actions during any parent operation', state => {
  const actions = props(state);
  render(<DetailingTestPaymentPanel {...actions} busy />);
  const action = screen.getByRole('button');
  expect(action).toBeDisabled();
  fireEvent.click(action);
  expect(actions.onCheckAvailability).not.toHaveBeenCalled();
  expect(actions.onCompleteTestPayment).not.toHaveBeenCalled();
  expect(actions.onCheckStatus).not.toHaveBeenCalled();
  expect(actions.onReplayConfirmation).not.toHaveBeenCalled();
});

it('does not allow unavailable checks forbidden by the parent', () => {
  const actions = props({ phase: 'unavailable', canCheckAvailability: false });
  render(<DetailingTestPaymentPanel {...actions} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check test payment availability' }));
  expect(actions.onCheckAvailability).not.toHaveBeenCalled();
  expect(screen.getByText(/Contact the business/)).toBeVisible();
});

it('labels the region and moves focus to accessible outcome text when the phase changes', () => {
  const actions = props({ phase: 'ready' });
  const view = render(<DetailingTestPaymentPanel {...actions} />);
  expect(screen.getByRole('region', { name: 'Staging test payment' })).toHaveAccessibleDescription(/STAGING TEST — no money charged/);
  fireEvent.click(screen.getByRole('button', { name: 'Complete test payment' }));
  view.rerender(<DetailingTestPaymentPanel {...actions} state={{ phase: 'unverified' }} />);
  expect(screen.getByRole('alert')).toHaveFocus();
  view.rerender(<DetailingTestPaymentPanel {...actions} state={{ phase: 'confirmed' }} />);
  expect(screen.getByRole('status')).toHaveFocus();
});

it('wraps long authoritative reference and total values within a bounded region', () => {
  const reference = 'LMN-' + 'X'.repeat(200);
  const total = 'USD ' + '9'.repeat(100);
  render(<DetailingTestPaymentPanel {...props({ phase: 'ready' })} reference={reference} formattedTotal={total} />);
  expect(screen.getByText(reference)).toBeVisible();
  expect(screen.getByText(total)).toBeVisible();
  expect(screen.getByRole('region')).toHaveStyle({ minWidth: '0', maxWidth: '100%', overflowWrap: 'anywhere' });
});
