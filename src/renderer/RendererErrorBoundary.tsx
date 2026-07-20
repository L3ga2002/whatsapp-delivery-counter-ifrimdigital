import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  hasError: boolean;
}

export class RendererErrorBoundary extends Component<RendererErrorBoundaryProps, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep diagnostic logs free from imported WhatsApp content.
    console.error('[renderer] Recovered from a render error.', {
      name: error.name,
      componentStack: info.componentStack?.slice(0, 1_000),
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="renderer-recovery" role="alert">
        <p className="eyebrow large">IfrimDigital</p>
        <h1>Aplicatia a intampinat o eroare de afisare.</h1>
        <p>Datele locale nu au fost sterse. Reincarca ecranul pentru a continua.</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          Reincarca aplicatia
        </button>
      </main>
    );
  }
}
