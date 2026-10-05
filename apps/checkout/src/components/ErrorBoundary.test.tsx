import { Component, type ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
class BrokenCheckout extends Component<{message: string}> {
  override render(): ReactNode { throw new Error(this.props.message); }
}
it('does not assert financial status after a rendering failure and masks boundary diagnostics', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const privateMessage = 'private payment response bearer secret test@example.test';
  render(<ErrorBoundary><BrokenCheckout message={privateMessage}/></ErrorBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('Booking and payment status could not be verified');
  expect(screen.getByRole('alert').textContent).toContain('before trying another booking');
  expect(screen.getByRole('alert').textContent).toContain('does not cancel a booking or payment');
  expect(screen.getByRole('alert').textContent).not.toContain('Nothing has been charged');
  expect(document.body.textContent).not.toContain(privateMessage);
  const boundaryLog = logged.mock.calls.find(([message]) => message === 'Checkout crashed');
  expect(boundaryLog).toEqual(['Checkout crashed', {code: 'CHECKOUT_RENDER_FAILED'}]);
  expect(screen.getByRole('button', {name: 'Reload checkout'})).toBeEnabled();
});
it('renders a healthy checkout without recovery guidance or a boundary diagnostic', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<ErrorBoundary><p>Verified checkout content</p></ErrorBoundary>);
  expect(screen.getByText('Verified checkout content')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(logged).not.toHaveBeenCalled();
});
