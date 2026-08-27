import { Component, type ReactNode } from 'react'
import { translate, type Language } from './i18n'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    const rendererError = window.nocturne?.diagnostics?.rendererError
    if (!rendererError) return
    void rendererError({
      type: 'error',
      message: error.message,
      stack: error.stack,
    }).catch(() => undefined)
  }

  private reload = () => window.location.reload()

  render() {
    if (!this.state.error) return this.props.children
    const language: Language = document.documentElement.lang === 'en' ? 'en' : 'pt-BR'
    return <main className="renderer-error" role="alert" aria-labelledby="renderer-error-title">
      <div className="renderer-error-panel">
        <p className="renderer-error-kicker">Nocturne Studio</p>
        <h1 id="renderer-error-title">{translate(language, 'errorBoundary.title')}</h1>
        <p>{translate(language, 'errorBoundary.description')}</p>
        <button className="primary" type="button" onClick={this.reload}>{translate(language, 'errorBoundary.reload')}</button>
      </div>
    </main>
  }
}
