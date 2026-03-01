import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[codetrail] renderer crashed", error, errorInfo);
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main
        style={{
          padding: "24px",
          fontFamily:
            '"JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          lineHeight: 1.4,
        }}
      >
        <h1 style={{ marginTop: 0 }}>Renderer Error</h1>
        <p>Code Trail encountered a render-time error.</p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            padding: "12px",
            border: "1px solid #999",
            borderRadius: "6px",
            background: "#f7f7f7",
          }}
        >
          {this.state.error.stack ?? this.state.error.message}
        </pre>
      </main>
    );
  }
}
