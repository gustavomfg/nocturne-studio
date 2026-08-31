import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Bot, Folder, Monitor, Settings, Star, X, type LucideIcon } from 'lucide-react'
import type { AppSettings, Workspace } from '../../types'
import { errorMessage } from '../../shared/format'
import { useDialogA11y } from '../../shared/useDialogA11y'
import { AISettingsPage } from './AISettingsPage'
import { useI18n, type Language } from '../../shared/i18n'

type SettingsPage = 'ai' | 'workspace' | 'application' | 'diagnostics'

const settingsPages: Array<{ id: SettingsPage; labelKey: string; descriptionKey: string; icon: LucideIcon }> = [
  { id: 'ai', labelKey: 'settings.ai', descriptionKey: 'settings.aiDescription', icon: Bot },
  { id: 'workspace', labelKey: 'settings.workspace', descriptionKey: 'settings.workspaceDescription', icon: Folder },
  { id: 'application', labelKey: 'settings.application', descriptionKey: 'settings.applicationDescription', icon: Monitor },
  { id: 'diagnostics', labelKey: 'settings.diagnostics', descriptionKey: 'settings.diagnosticsDescription', icon: Activity },
]

export function SettingsDialog({ value, workspace, workspaces, onClose, onSave, onCodexModelChange, onNotify, onOnboarding }: { value: AppSettings; workspace: string; workspaces: Workspace[]; onClose(): void; onSave(value: AppSettings): void | Promise<void>; onCodexModelChange(modelId: string): Promise<void>; onNotify(message: string): void; onOnboarding(): void }) {
  const { t } = useI18n()
  const [form, setForm] = useState(value)
  const [page, setPage] = useState<SettingsPage>('ai')
  const [diagnostic, setDiagnostic] = useState(t('settings.loadDiagnostic'))
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [operation, setOperation] = useState<string | null>(null)
  const [discardAction, setDiscardAction] = useState<'close' | 'onboarding' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const settingsDirty = JSON.stringify(form) !== JSON.stringify(value)
  const requestExit = (action: 'close' | 'onboarding' = 'close') => { if (settingsDirty && !saving) setDiscardAction(action); else if (action === 'onboarding') onOnboarding(); else onClose() }
  const confirmDiscard = () => { const action = discardAction; setDiscardAction(null); if (action === 'onboarding') onOnboarding(); else onClose() }
  const dialogRef = useDialogA11y<HTMLDivElement>(() => requestExit())
  useEffect(() => { if (page === 'diagnostics') setDiagnostic(t('settings.systemLoaded')) }, [page, t])
  const save = async () => { if (saving) return; setSaving(true); setSaveError(null); try { await onSave(form) } catch (error) { setSaveError(errorMessage(error)) } finally { setSaving(false) } }
  const selectCodexModel = async (modelId: string) => {
    await onCodexModelChange(modelId)
    setForm((current) => ({ ...current, model: modelId }))
  }
  const runOperation = async (name: string, operationTask: () => Promise<string | null | void>, success: string) => {
    if (operation) return
    setOperation(name)
    try { const result = await operationTask(); if (result !== null) onNotify(success) }
    catch (error) { setDiagnostic(errorMessage(error)) }
    finally { setOperation(null) }
  }
  const restoreBackup = async () => {
    if (operation) return
    setOperation('import')
    try {
      const restored = await window.nocturne.data.import()
      if (restored) window.location.reload()
    } catch (error) {
      setDiagnostic(errorMessage(error))
    } finally {
      setOperation(null)
    }
  }
  const currentPage = settingsPages.find((item) => item.id === page) ?? settingsPages[0]

  return <div className="modal-backdrop settings-backdrop" onMouseDown={() => requestExit()}>
    <div ref={dialogRef} className="settings-dialog beta-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
      <header className="settings-header"><div className="settings-heading"><span><Settings size={17}/></span><div><strong id="settings-title">{t('settings.title')}</strong><small>{t('settings.subtitle')}</small></div></div><button className="settings-close" aria-label={t('settings.close')} title={t('common.close')} onClick={() => requestExit()}><X size={17}/></button></header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label={t('settings.sections')}>
          {settingsPages.map((item) => { const Icon = item.icon; return <button key={item.id} className={page === item.id ? 'active' : ''} aria-label={t(item.labelKey)} title={t(item.labelKey)} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><Icon size={17}/><span><strong>{t(item.labelKey)}</strong><small>{t(item.descriptionKey)}</small></span></button> })}
        </nav>
        <main className="settings-content">
          <div className="settings-page-title"><span><currentPage.icon size={19}/></span><div><h2>{t(currentPage.labelKey)}</h2><p>{t(currentPage.descriptionKey)}</p></div></div>
          {page === 'ai' && <AISettingsPage workspaceId={workspace} onNotify={onNotify} onCodexModelChange={selectCodexModel}/>}
          {page === 'workspace' && <SettingsSection title={t('settings.recentProjects')}><div className="settings-workspaces">{workspaces.slice(0, 6).map((workspace) => <div key={workspace.path}><span className="workspace-setting-icon"><Folder size={15}/></span><span><strong title={workspace.name}>{workspace.name}</strong><small title={workspace.path}>{workspace.path}</small></span>{workspace.favorite && <Star className="workspace-setting-star" size={13} fill="currentColor"/>}</div>)}{!workspaces.length && <p className="settings-empty">{t('settings.noRecentWorkspaces')}</p>}</div></SettingsSection>}
          {page === 'application' && <SettingsSection title={t('settings.preferences')}><div className="settings-columns"><label>{t('settings.theme')}<select value={form.theme === 'light' ? 'light' : 'dark'} onChange={(event) => setForm({ ...form, theme: event.target.value === 'light' ? 'light' : 'dark' })}><option value="dark">{t('settings.darkTheme')}</option><option value="light">{t('settings.lightTheme')}</option></select></label><label>{t('settings.language')}<select value={form.language === 'en' ? 'en' : 'pt-BR'} onChange={(event) => setForm({ ...form, language: event.target.value as Language })}><option value="pt-BR">Português (Brasil)</option><option value="en">English</option></select><small>{t('settings.languageHint')}</small></label></div><label className="check-label"><input type="checkbox" checked={Boolean(form.diagnosticMode)} onChange={(event) => setForm({ ...form, diagnosticMode: event.target.checked })}/><span><strong>{t('settings.detailedLogs')}</strong><small>{t('settings.detailedLogsHint')}</small></span></label><button className="secondary-setting" onClick={() => requestExit('onboarding')}>{t('settings.reopenOnboarding')}</button></SettingsSection>}
          {page === 'diagnostics' && <SettingsSection title={t('settings.systemInfo')}><pre className="diagnostic-summary" aria-live="polite">{diagnostic}</pre><div className="diagnostic-actions"><button disabled={Boolean(operation)} onClick={() => void runOperation('logs', () => window.nocturne.diagnostics.openLogs(), t('settings.logsOpened'))}>{t('settings.openLogs')}</button><button disabled={Boolean(operation)} onClick={() => void runOperation('copy', async () => { const content = await window.nocturne.diagnostics.copy(); await window.nocturne.clipboard.writeText(content); setCopied(true) }, t('settings.diagnosticCopied'))}>{operation === 'copy' ? t('settings.copying') : copied ? t('settings.infoCopied') : t('settings.copyInfo')}</button><button disabled={Boolean(operation)} onClick={() => void runOperation('diagnostic-export', () => window.nocturne.diagnostics.export(), t('settings.diagnosticExported'))}>{operation === 'diagnostic-export' ? t('settings.exportingDiagnostic') : t('settings.exportDiagnostic')}</button><button disabled={Boolean(operation)} onClick={() => void runOperation('export', () => window.nocturne.data.export(), t('settings.backupExported'))}>{operation === 'export' ? t('settings.exporting') : t('settings.exportData')}</button><button disabled={Boolean(operation)} onClick={() => void restoreBackup()}>{operation === 'import' ? t('settings.restoring') : t('settings.restoreBackup')}</button></div></SettingsSection>}
        </main>
      </div>
      <footer className={`settings-footer ${discardAction ? 'confirm-discard' : ''} ${saveError ? 'has-error' : ''}`}>{discardAction ? <><span role="alert"><strong>{t('settings.discardChanges')}</strong> {t('settings.unsavedFields')}</span><div className="modal-actions"><button onClick={() => setDiscardAction(null)}>{t('settings.continueEditing')}</button><button className="danger" onClick={confirmDiscard}>{t('settings.discard')}</button></div></> : <><span role={saveError ? 'alert' : undefined}>{saveError || (settingsDirty ? t('settings.unsavedChanges') : t('settings.noPendingChanges'))}</span><div className="modal-actions"><button disabled={saving} onClick={() => requestExit()}>{t('settings.cancel')}</button><button className="primary" disabled={saving || !settingsDirty} onClick={() => void save()}>{saving ? t('settings.saving') : t('settings.save')}</button></div></>}</footer>
    </div>
  </div>
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) { return <section className="settings-section"><h3>{title}</h3>{children}</section> }
