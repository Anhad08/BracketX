import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last line of defence against a blank screen.
 *
 * ============================================================================
 * A BLANK SCREEN IS NEVER AN ACCEPTABLE STATE
 * ============================================================================
 * Without a boundary, any exception thrown while rendering unmounts the entire
 * React tree and leaves `#root` empty — a completely black page, with the real
 * error visible only in a console the user has not opened.
 *
 * This does not make the application correct when something breaks. It makes
 * the breakage VISIBLE, which is the difference between a bug report that says
 * "it renders nothing" and one that says what actually failed.
 *
 * ============================================================================
 * WHAT IT DELIBERATELY DOES NOT DO
 * ============================================================================
 * It does not retry, and it does not swallow. A boundary that silently
 * re-renders a component which just threw produces a flickering loop and hides
 * the fault; a boundary that catches and shows nothing is the blank screen it
 * was added to prevent.
 *
 * It also does not sit *inside* the shell. The shell itself can throw, so the
 * boundary has to be above it — which is why the fallback below draws its own
 * minimal chrome rather than assuming any of the product is available.
 */

export interface BoundaryProps {
  readonly children: ReactNode;
  /** Called on catch, so a host can log or report. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface BoundaryState {
  readonly error: Error | null;
  readonly stack: string | null;
}

export class AppBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? null });
    this.props.onError?.(error, info);
    // Re-thrown to the console deliberately: a developer with devtools open
    // should still get the full trace and the source map.
    console.error("Streamatrix Studio failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="fatal" role="alert" data-testid="fatal">
        <div className="fatal-body">
          <h1>Streamatrix could not start</h1>
          <p>
            Something failed while drawing the interface. Your work is not lost —
            reloading usually recovers it.
          </p>
          <button
            type="button"
            className="chip primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <details>
            <summary>Technical details</summary>
            <pre className="dump mono">
              {error.name}: {error.message}
              {stack === null ? "" : `\n${stack}`}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
