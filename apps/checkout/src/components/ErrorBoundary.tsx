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

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Dev aid only; messages shown to customers stay generic.
    console.error("Checkout crashed", error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-fallback" role="alert">
          <h2>Something went wrong</h2>
          <p>Sorry — the checkout hit an unexpected error. Nothing has been charged.</p>
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
