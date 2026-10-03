import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps a crash in one screen from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert">
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
