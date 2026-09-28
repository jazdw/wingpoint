import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors so a bad state shows a message instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="splash">
          <div className="card empty-state">
            <h2>Something went wrong</h2>
            <p className="muted">{this.state.error.message}</p>
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
