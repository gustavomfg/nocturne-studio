import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './shared/ErrorBoundary'
import { I18nProvider } from './shared/i18n'
import './index.css'

let reportingRendererError = false
function reportRendererError(value: { type: 'error' | 'unhandledRejection'; message: string; stack?: string }) {
  if (reportingRendererError || !window.nocturne?.diagnostics?.rendererError) return
  reportingRendererError = true
  void window.nocturne.diagnostics.rendererError(value).catch(() => { /* nunca gerar outro unhandledRejection a partir do diagnóstico */ }).finally(() => { reportingRendererError = false })
}
window.addEventListener('error', (event) => reportRendererError({ type: 'error', message: event.message, stack: event.error instanceof Error ? event.error.stack : undefined }))
window.addEventListener('unhandledrejection', (event) => { const error = event.reason; reportRendererError({ type: 'unhandledRejection', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }) })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider><ErrorBoundary><App /></ErrorBoundary></I18nProvider>
  </React.StrictMode>,
)
