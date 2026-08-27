import { useEffect, useState } from 'react'
import { Brain, Check, Copy, ExternalLink, Eye, FolderOpen, MoonStar, Settings, X } from 'lucide-react'
import type { AppSettings, FilePreview, WorkspaceMemory } from '../../types'
import { errorMessage, formatBytes, relativeTime } from '../../shared/format'
import { useDialogA11y } from '../../shared/useDialogA11y'
import { SafeMarkdown } from '../../shared/SafeMarkdown'
import { useI18n } from '../../shared/i18n'

export function OnboardingDialog({ workspace, onWorkspace, onSettings, onDismiss, onComplete }: { settings: AppSettings; status: string; workspace: string; onWorkspace(): void; onSettings(): void; onRecheck?(): Promise<void>; onDismiss(): void; onComplete(): void }) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const [aiReady, setAiReady] = useState(false)
  const dialogRef = useDialogA11y<HTMLDivElement>(onDismiss)
  const hasWorkspace = Boolean(workspace)
  useEffect(() => {
    let active = true
    void Promise.all([
      window.nocturne.providers.list(),
      workspace ? window.nocturne.models.bindings(workspace) : Promise.resolve(null),
      window.nocturne.codex.status(),
    ]).then(([providers, bindings, codex]) => {
      if (!active) return
      const providerReady = Boolean(
        bindings?.defaultBinding
        && providers.some((provider) => (
          provider.id === bindings.defaultBinding?.providerId && provider.enabled
        )),
      )
      setAiReady(Boolean(
        providerReady
        || (
          codex.installed
          && codex.compatible
          && codex.authenticated
          && codex.authenticationMethod === 'chatgpt'
        ),
      ))
    }).catch(() => {
      if (active) setAiReady(false)
    })
    return () => {
      active = false
    }
  }, [workspace])
  const items = [
    { title: t('onboarding.aiAccess'), ok: aiReady, required: true, body: aiReady ? t('onboarding.aiConnected') : t('onboarding.chooseAi'), fix: t('onboarding.openAiSettings') },
    { title: t('onboarding.execution'), ok: aiReady, required: true, body: aiReady ? t('onboarding.backendReady') : t('onboarding.finishConnection'), fix: t('onboarding.finishAiConnection') },
    { title: t('onboarding.firstWorkspace'), ok: hasWorkspace, required: true, body: hasWorkspace ? t('onboarding.workspaceReady') : t('onboarding.chooseWorkspace'), fix: t('onboarding.selectProjectFolder') },
    { title: t('onboarding.approvals'), ok: true, required: true, body: t('onboarding.approvalsBody'), fix: '' },
  ]
  const current = items[step]
  const blockers = items.filter((item) => item.required && !item.ok).length
  return <div className="modal-backdrop"><div ref={dialogRef} className="settings-dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" tabIndex={-1}>
    <div className="modal-title"><MoonStar size={18}/><strong id="onboarding-title">{t('onboarding.title')}</strong><button onClick={onDismiss}>{t('onboarding.notNow')}</button></div>
    <div className={`readiness-summary ${blockers ? 'pending' : 'ready'}`} role="status"><span>{blockers ? t('onboarding.stepsNeedAttention', { count: blockers }) : t('onboarding.ready')}</span><small>{blockers ? t('onboarding.pendingCanExit') : t('onboarding.allComplete')}</small></div>
    <div className="onboarding-progress" role="progressbar" aria-valuemin={1} aria-valuemax={items.length} aria-valuenow={step + 1} aria-label={t('onboarding.progress')}>{items.map((_, index) => <span key={index} className={index <= step ? 'active' : ''}/>)}</div>
    <div className={`onboarding-check ${current.ok ? 'ok' : 'failed'}`} aria-hidden="true">{current.ok ? <Check size={18}/> : <X size={18}/>}</div><h2>{current.title}</h2><p>{current.body}</p>
    {!current.ok && current.fix && <code className="onboarding-fix">{current.fix}</code>}
    {!current.ok && step < 2 && <div className="onboarding-remediation"><button onClick={onSettings}><Settings size={15}/>{t('nav.openSettings')}</button></div>}
    {step === 2 && !hasWorkspace && <button className="onboarding-workspace" onClick={onWorkspace}><FolderOpen size={15}/>{t('memory.chooseWorkspace')}</button>}
    <div className="modal-actions"><button disabled={step === 0} onClick={() => setStep(step - 1)}>{t('onboarding.back')}</button><button className="primary" onClick={() => step === items.length - 1 ? blockers ? setStep(items.findIndex((item) => item.required && !item.ok)) : onComplete() : setStep(step + 1)}>{step === items.length - 1 ? blockers ? t('onboarding.reviewPending', { count: blockers }) : t('onboarding.complete') : t('onboarding.continue')}</button></div>
  </div></div>
}

export function MemoryDialog({ value, onClose, onOpenBrain, onSave }: { value: WorkspaceMemory; onClose(): void; onOpenBrain(): void; onSave(content: string, rules: string): void | Promise<void> }) {
  const { t, language } = useI18n()
  const [content, setContent] = useState(value.content)
  const [rules, setRules] = useState(value.rules)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = content !== value.content || rules !== value.rules
  const requestClose = () => { if (dirty && !saving) setConfirmDiscard(true); else onClose() }
  const save = async () => { if (saving || !dirty) return; setSaving(true); setSaveError(null); try { await onSave(content, rules) } catch (error) { setSaveError(errorMessage(error)) } finally { setSaving(false) } }
  const dialogRef = useDialogA11y<HTMLDivElement>(requestClose)
  return <div className="modal-backdrop" onMouseDown={requestClose}><div ref={dialogRef} className="settings-dialog memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-title"><Brain size={17}/><strong id="memory-title">{t('memory.context')}</strong><button aria-label={`${t('common.close')} ${t('memory.context')}`} title={t('common.close')} onClick={requestClose}><X size={16}/></button></div>
    <p className="memory-description">{t('memory.description')} <b>.nocturne/</b>, {t('memory.descriptionSuffix')}</p><button disabled={dirty || saving} onClick={onOpenBrain}><Brain size={15}/>{t('memory.openBrain')}</button>{value.project && <div className="project-summary"><strong>{value.project.name}</strong><small>{value.project.primaryLanguage} · {value.project.stack.join(', ') || t('memory.unknownStack')}</small></div>}
    <label>{t('memory.memoryAndDecisions')}<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={20_000}/></label><label>{t('memory.rulesAndPatterns')}<textarea value={rules} onChange={(event) => setRules(event.target.value)} maxLength={20_000}/></label>
    <div className={`memory-footer ${confirmDiscard ? 'confirm-discard' : ''} ${saveError ? 'has-error' : ''}`}>{confirmDiscard ? <><span role="alert"><strong>{t('memory.discard')}</strong><small>{t('memory.unsaved')}</small></span><div className="modal-actions"><button onClick={() => setConfirmDiscard(false)}>{t('settings.continueEditing')}</button><button className="danger" onClick={onClose}>{t('settings.discard')}</button></div></> : <><small role={saveError ? 'alert' : undefined}>{saveError || `${(content.length + rules.length).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')} ${t('memory.characters')} · ${value.updatedAt ? `${t('memory.updated')} ${relativeTime(value.updatedAt, language)}` : t('memory.notSaved')}`}</small><div className="modal-actions"><button disabled={saving} onClick={requestClose}>{t('settings.cancel')}</button><button className="primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? t('settings.saving') : t('memory.save')}</button></div></>}</div>
  </div></div>
}

export function PreviewDialog({ preview, activeId, onClose, onError, onNotify }: { preview: FilePreview; activeId: string | null; onClose(): void; onError(value: string): void; onNotify(value: string): void }) {
  const { t } = useI18n()
  const dialogRef = useDialogA11y<HTMLElement>(onClose)
  const [copying, setCopying] = useState(false)
  const open = async (action: 'editor' | 'folder') => { if (!activeId || !preview.filePath) return; try { await window.nocturne.files.open(activeId, preview.filePath, action); onNotify(action === 'folder' ? t('common.openFolder') : t('common.openFile')) } catch (error) { onError(errorMessage(error)) } }
  const copy = async () => { if (copying) return; setCopying(true); try { await window.nocturne.clipboard.writeText(preview.content); onNotify(t('common.copied')) } catch (error) { onError(errorMessage(error)) } finally { setCopying(false) } }
  return <div className="preview-backdrop" onMouseDown={onClose}><section ref={dialogRef} className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><Eye size={16}/><span><strong id="preview-title">{preview.name}</strong><small>{formatBytes(preview.size)}{preview.filePath && ` · ${preview.filePath}`}</small></span></div><div>{preview.kind !== 'image' && <button disabled={copying} onClick={() => void copy()} aria-label={copying ? t('common.copying') : t('common.copy')} title={t('common.copy')}><Copy size={15}/></button>}{preview.filePath && <><button onClick={() => void open('folder')} aria-label={t('common.openFolderAction')} title={t('common.openFolderAction')}><FolderOpen size={15}/></button><button onClick={() => void open('editor')} aria-label={t('common.openFileAction')} title={t('common.openFileAction')}><ExternalLink size={15}/></button></>}<button onClick={onClose} aria-label={t('common.closePreview')} title={t('common.close')}><X size={17}/></button></div></header>
    <div className={`preview-content ${preview.kind}`}>{preview.kind === 'image' ? <img src={preview.content} alt={preview.name}/> : preview.kind === 'markdown' ? <SafeMarkdown>{preview.content}</SafeMarkdown> : <pre><code>{preview.content}</code></pre>}</div>
  </section></div>
}
