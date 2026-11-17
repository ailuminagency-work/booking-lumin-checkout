import { useEffect, useId, useRef } from 'react';

/** Only the parent that validates bound server receipts may choose these states. */
export type DetailingTestPaymentState =
  | { phase: 'unavailable'; canCheckAvailability: boolean }
  | { phase: 'checking' }
  | { phase: 'ready' }
  | { phase: 'paying' }
  | { phase: 'unverified'; checkingStatus?: boolean; recovery?: 'check' | 'retry-payment' | 'confirm' }
  | { phase: 'confirmed'; canReplayConfirmation?: boolean };

export interface DetailingTestPaymentPanelProps {
  state: DetailingTestPaymentState;
  /** Authoritative display values supplied by the parent; never calculated here. */
  formattedTotal: string;
  reference: string;
  /** Any other parent action in progress also locks this panel's controls. */
  busy?: boolean;
  onCheckAvailability: () => void;
  onCompleteTestPayment: () => void;
  onCheckStatus: () => void;
  onReplayConfirmation?: () => void;
}

/** Presentation only: no transport, receipt validation, or automatic actions. */
export function DetailingTestPaymentPanel({
  state, formattedTotal, reference, busy = false,
  onCheckAvailability, onCompleteTestPayment, onCheckStatus, onReplayConfirmation,
}: DetailingTestPaymentPanelProps) {
  const titleId = useId();
  const noticeId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const previousPhase = useRef(state.phase);
  const pending = busy || state.phase === 'checking' || state.phase === 'paying'
    || (state.phase === 'unverified' && state.checkingStatus === true);

  useEffect(() => {
    if (previousPhase.current !== state.phase) {
      previousPhase.current = state.phase;
      statusRef.current?.focus();
    }
  }, [state.phase]);

  const status = state.phase === 'unavailable'
    ? 'Test payment availability has not been verified for this booking.'
    : state.phase === 'checking'
      ? 'Checking test payment availability for this booking…'
      : state.phase === 'ready'
        ? 'Test payment is available for this booking. The booking remains unconfirmed.'
        : state.phase === 'paying'
          ? 'Completing the staging test payment. Booking confirmation has not yet been verified.'
          : state.phase === 'unverified'
            ? state.checkingStatus
              ? 'Checking the test payment status of this same booking…'
              : 'Test payment and booking confirmation status are unverified.'
            : 'Staging test payment confirmed. This booking is confirmed in the staging test.';

  return (
    <section aria-labelledby={titleId} aria-describedby={noticeId}
      aria-busy={pending} style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <h2 id={titleId}>Staging test payment</h2>
      <p id={noticeId}><strong>STAGING TEST — no money charged.</strong> This is a simulated payment, using the staging mock provider.</p>
      <p>Booking reference: <strong>{reference}</strong></p>
      <p>Server total for this test: <strong>{formattedTotal}</strong></p>
      <p ref={statusRef} role={state.phase === 'unverified' && !state.checkingStatus ? 'alert' : 'status'}
        aria-atomic="true" tabIndex={-1}>{status}</p>
      {state.phase === 'unverified' && <p>Keep this same booking. Do not start another booking while its status is uncertain. Check its status, or contact the business with your booking reference.</p>}
      {state.phase === 'unavailable' && !state.canCheckAvailability && <p>Test payment cannot be checked here. Contact the business with your booking reference.</p>}
      {(state.phase === 'unavailable' || state.phase === 'checking') &&
        <button type="button" disabled={pending || (state.phase === 'unavailable' && !state.canCheckAvailability)}
          onClick={onCheckAvailability}>Check test payment availability</button>}
      {(state.phase === 'ready' || state.phase === 'paying') &&
        <button type="button" disabled={pending} onClick={onCompleteTestPayment}>Complete test payment</button>}
      {state.phase === 'unverified' && (!state.recovery || state.recovery === 'check') &&
        <button type="button" disabled={pending} onClick={onCheckStatus}>Check test payment status</button>}
      {state.phase === 'unverified' && state.recovery === 'retry-payment' &&
        <button type="button" disabled={pending} onClick={onCompleteTestPayment}>Retry the same test payment</button>}
      {state.phase === 'unverified' && state.recovery === 'confirm' &&
        <button type="button" disabled={pending || !onReplayConfirmation} onClick={onReplayConfirmation}>Verify the same test confirmation</button>}
      {state.phase === 'confirmed' && state.canReplayConfirmation && onReplayConfirmation &&
        <button type="button" disabled={pending} onClick={onReplayConfirmation}>Verify the same test confirmation</button>}
    </section>
  );
}
