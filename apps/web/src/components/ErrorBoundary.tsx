import { Component, type ErrorInfo, type ReactNode } from "react"

/** A render crash in one surface must not leave a blank window. It says what happened and offers a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("JCVC screen crashed:", error.message, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <main role="alert" className="mx-auto mt-24 grid max-w-xl gap-3 p-6">
        <h1 className="m-0">This screen stopped working</h1>
        <p className="m-0">
          Nothing was decided or changed by this. Pending requests are still waiting in the Host and
          your phone can still answer them. Reload to carry on.
        </p>
        <p className="mono m-0 text-[13px] text-mut [overflow-wrap:anywhere]">
          {this.state.error.message}
        </p>
        <div>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </main>
    )
  }
}
