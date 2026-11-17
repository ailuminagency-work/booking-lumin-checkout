import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Keep exception messages and component details out of customer diagnostics.
    console.error("Checkout crashed", { code: "CHECKOUT_RENDER_FAILED" });
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-fallback" role="alert">
          <h2>Something went wrong</h2>
          <p>Booking and payment status could not be verified. Check your booking or contact the business before trying another booking.</p>
          <p>Reloading this page does not cancel a booking or payment.</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => window.location.reload()}
          >
            Reload checkout
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
