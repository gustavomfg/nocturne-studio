import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Globe,
  Laptop,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react'
import type { ProviderDiagnostic } from '../../../shared/ai/provider'
import type {
  ProviderConfigurationInput,
  ProviderConfigurationSummary,
} from '../../../shared/ai/providerConfiguration'
import type { ModelDescriptor, ModelReference } from '../../../shared/ai/model'
import type { CodexAccountStatus } from '../../../shared/types'
import type { CodexModel } from '../../../shared/codexModels'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'

type Step = 'list' | 'service' | 'auth' | 'model' | 'codex-model'

interface ServicePreset {
  id: string
  name: string
  icon: typeof Bot
  baseUrl: string
  authType: 'account' | 'api-key' | 'local'
}

const presets: ServicePreset[] = [
  { id: 'codex', name: 'Conta ChatGPT', icon: UserRound, baseUrl: '', authType: 'account' },
  { id: 'openai', name: 'OpenAI API', icon: Sparkles, baseUrl: 'https://api.openai.com/v1', authType: 'api-key' },
  { id: 'deepseek', name: 'DeepSeek', icon: Brain, baseUrl: 'https://api.deepseek.com', authType: 'api-key' },
  { id: 'openrouter', name: 'OpenRouter', icon: Bot, baseUrl: 'https://openrouter.ai/api/v1', authType: 'api-key' },
  { id: 'ollama', name: 'Ollama', icon: Laptop, baseUrl: 'http://127.0.0.1:11434/v1', authType: 'local' },
  { id: 'other', name: 'Outro', icon: Globe, baseUrl: '', authType: 'api-key' },
]
interface AIConnectionPageProps {
  workspaceId: string
  onNotify(message: string): void
  onCodexModelChange(modelId: string): Promise<void>
}

export function AIConnectionPage({
  workspaceId,
  onNotify,
  onCodexModelChange,
}: AIConnectionPageProps) {
  const { t } = useI18n()
  const [services, setServices] = useState<ProviderConfigurationSummary[]>([])
  const [codexAccount, setCodexAccount] = useState<CodexAccountStatus | null>(null)
  const [codexModels, setCodexModels] = useState<CodexModel[]>([])
  const [codexModelId, setCodexModelId] = useState('')
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel | null>(null)
  const [step, setStep] = useState<Step>('list')
  const [selectedPreset, setSelectedPreset] = useState<ServicePreset | null>(null)
  const [credential, setCredential] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [models, setModels] = useState<ModelDescriptor[]>([])
  const [selectedModel, setSelectedModel] = useState<ModelReference | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [loadingCodexModels, setLoadingCodexModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [diagnosingId, setDiagnosingId] = useState<string | null>(null)
  const [providerDiagnostics, setProviderDiagnostics] = useState<Record<string, ProviderDiagnostic>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      window.nocturne.providers.list(),
      window.nocturne.codex.status(),
      window.nocturne.settings.get(),
    ])
      .then(([items, account, settings]) => {
        if (!active) return
        setServices(items)
        setCodexAccount(account)
        setCodexModelId(settings.model || '')
      })
      .catch((failure) => { if (active) setError(errorMessage(failure)) })
    return () => { active = false }
  }, [])

  const resetWizard = () => {
    setStep('list')
    setSelectedPreset(null)
    setCredential('')
    setCustomUrl('')
    setModels([])
    setSelectedModel(null)
    setSelectedCodexModel(null)
    setShowAdvanced(false)
    setError(null)
  }

  const openCodexModels = async () => {
    if (loadingCodexModels) return
    setStep('codex-model')
    setLoadingCodexModels(true)
    setError(null)
    try {
      const available = await window.nocturne.codex.models()
      setCodexModels(available)
      setSelectedCodexModel(
        available.find((model) => model.model === codexModelId)
        ?? available.find((model) => model.isDefault)
        ?? available[0]
        ?? null,
      )
      if (available.length === 0) {
        setError(t('ai.noAccountModels'))
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setLoadingCodexModels(false)
    }
  }

  const pickService = (preset: ServicePreset) => {
    setSelectedPreset(preset)
    setCustomUrl('')
    setCredential('')
    setShowAdvanced(false)
    setStep('auth')
    setError(null)
  }

  const connect = async () => {
    if (!selectedPreset || connecting) return
    setConnecting(true)
    setError(null)
    try {
      if (selectedPreset.authType === 'account') {
        const account = await window.nocturne.codex.login()
        setCodexAccount(account)
        onNotify(t('ai.connectedChatGpt'))
        setConnecting(false)
        await openCodexModels()
        return
      }
      const effectiveUrl = customUrl.trim() || selectedPreset.baseUrl
      if (selectedPreset.authType === 'api-key' && !credential.trim()) {
        setError(t('ai.enterApiKey'))
        setConnecting(false)
        return
      }
      if (selectedPreset.id === 'other' && !effectiveUrl) {
        setError(t('ai.enterServiceUrl'))
        setConnecting(false)
        return
      }
      const config: ProviderConfigurationInput = {
        providerType: 'openai-compatible',
        displayName: selectedPreset.name,
        source: selectedPreset.id === 'ollama' ? 'local' : 'remote',
        baseUrl: effectiveUrl,
        enabled: true,
        requiresAuthentication: selectedPreset.authType === 'api-key',
        timeoutMs: 30_000,
      }
      const saved = await window.nocturne.providers.create(config, credential || undefined)
      await window.nocturne.models.refresh(saved.id)
      const catalog = await window.nocturne.models.list()
      const available = catalog.filter((m) => m.providerId === saved.id)
      setModels(available)
      setServices((current) => [saved, ...current])
      if (available.length > 0) {
        setSelectedModel({ providerId: saved.id, modelId: available[0].modelId })
      }
      setStep('model')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setConnecting(false)
    }
  }

  const disconnectCodex = async () => {
    if (connecting) return
    setConnecting(true)
    setError(null)
    try {
      setCodexAccount(await window.nocturne.codex.logout())
      onNotify(t('ai.disconnectedChatGpt'))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setConnecting(false)
    }
  }

  const saveAndBind = async () => {
    if (!selectedPreset || !selectedModel || saving) return
    if (!workspaceId) {
      setError(t('ai.selectWorkspace'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await window.nocturne.models.setBindings({
        workspaceId,
        defaultBinding: selectedModel,
      })
      onNotify(t('ai.usingModel', { model: selectedModel.modelId }))
      resetWizard()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  const saveCodexModel = async () => {
    if (!selectedCodexModel || saving) return
    setSaving(true)
    setError(null)
    try {
      await onCodexModelChange(selectedCodexModel.model)
      setCodexModelId(selectedCodexModel.model)
      onNotify(t('ai.usingCodexModel', { model: selectedCodexModel.displayName }))
      resetWizard()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (confirmRemove !== id) { setConfirmRemove(id); return }
    setRemovingId(id)
    setError(null)
    try {
      await window.nocturne.providers.remove(id)
      setServices((current) => current.filter((item) => item.id !== id))
      setConfirmRemove(null)
      onNotify(t('ai.connectionRemoved'))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setRemovingId(null)
    }
  }

  const diagnose = async (id: string) => {
    if (diagnosingId) return
    setDiagnosingId(id)
    setError(null)
    try {
      const diagnostic = await window.nocturne.providers.diagnose(id)
      setProviderDiagnostics((current) => ({ ...current, [id]: diagnostic }))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setDiagnosingId(null)
    }
  }

  return <div className="ai-page">
    {error && <div className="provider-feedback error" role="alert">{error}</div>}

    {step === 'list' && <>
      <div className="ai-list-header">
        <h4 className="ai-list-heading">{t('ai.connect')}</h4>
        <p className="ai-list-sub">{t('ai.connectHint')}</p>
      </div>

      {codexAccount && codexAccount.state !== 'ready' && <CodexStatusSummary value={codexAccount}/>}

      {(codexAccount?.authenticated || services.length > 0) && <div className="ai-list-connections">
        {codexAccount?.authenticated && <div className="ai-list-row">
          <div className="ai-list-row-info">
            <span className="ai-list-dot"/>
            <span><strong>{t('ai.chatGptAccount')}</strong><small>Codex CLI {codexAccount.version}{codexModelId ? ` · ${codexModelId}` : ''}</small></span>
          </div>
          <div className="ai-list-row-actions">
            <button
              className="ai-list-config"
              aria-label={t('ai.chooseCodexModel')}
              disabled={loadingCodexModels || connecting}
              onClick={() => void openCodexModels()}
            >{loadingCodexModels ? <LoaderCircle className="spin" size={13}/> : <Bot size={13}/>}</button>
            <button
              className="ai-list-remove"
              aria-label={t('ai.disconnectChatGpt')}
              disabled={connecting}
              onClick={() => void disconnectCodex()}
            >{connecting ? <LoaderCircle className="spin" size={13}/> : <Trash2 size={13}/>}</button>
          </div>
        </div>}
        {services.map((service) => {
          const diagnostic = providerDiagnostics[service.id]
          return <div key={service.id} className="ai-list-provider">
            <div className="ai-list-row">
              <div className="ai-list-row-info">
                <span className={`ai-list-dot ${diagnostic?.availability.status ?? ''}`}/>
                <span><strong>{service.displayName}</strong><small>{service.baseUrl}</small></span>
              </div>
              <div className="ai-list-row-actions">
                <button
                  className="ai-list-config"
                  aria-label={`${t('ai.diagnose')} ${service.displayName}`}
                  disabled={Boolean(diagnosingId)}
                  onClick={() => void diagnose(service.id)}
                >{diagnosingId === service.id ? <LoaderCircle className="spin" size={13}/> : <Activity size={13}/>}</button>
                <button
                  className="ai-list-remove"
                  aria-label={`${t('common.remove')} ${service.displayName}`}
                  disabled={removingId === service.id}
                  onClick={() => void remove(service.id)}
                >{removingId === service.id ? <LoaderCircle className="spin" size={13}/> : <Trash2 size={13}/>}</button>
              </div>
            </div>
            {diagnostic && <ProviderDiagnosticSummary value={diagnostic}/>}
          </div>
        })}
      </div>}

      <button className="ai-add-btn" onClick={() => setStep('service')}>
        <Plus size={16}/> {t('ai.addConnection')}
      </button>
    </>}

    {step === 'service' && <div className="ai-step-box">
      <div className="ai-step-top">
        <button className="ai-step-back" aria-label={t('ai.back')} onClick={() => setStep('list')}><ArrowLeft size={16}/></button>
        <div className="ai-step-copy"><strong>{t('ai.chooseAccess')}</strong><small>{t('ai.chooseAccessHint')}</small></div>
      </div>
      <div className="ai-service-list">
        {presets.map((preset) => {
          const Icon = preset.icon
          return <button key={preset.id} className="ai-service-opt" onClick={() => pickService(preset)}>
            <span className="ai-service-mark"><Icon size={17}/></span>
            <span className="ai-service-name">{presetName(preset, t)}</span>
            <ArrowLeft className="ai-service-arrow" size={14}/>
          </button>
        })}
      </div>
    </div>}

    {step === 'auth' && selectedPreset && <div className="ai-auth">
      <button type="button" className="ai-auth-back" onClick={() => setStep('service')}>
        <ArrowLeft size={14}/> {presetName(selectedPreset, t)}
      </button>
      <p className="ai-auth-desc">{
        selectedPreset.authType === 'account'
          ? t('ai.accountBrowser')
          : selectedPreset.authType === 'local'
          ? t('ai.connectLocal', { service: presetName(selectedPreset, t) })
          : selectedPreset.id === 'other'
            ? t('ai.enterKeyAndUrl')
            : t('ai.pasteProviderKey', { service: presetName(selectedPreset, t) })
      }</p>

      {selectedPreset.authType === 'account' && codexAccount && !codexAccount.installed && (
        <p className="ai-local-note">{t('ai.installCodex', { minimum: codexAccount.minimumVersion, recommended: codexAccount.recommendedVersion })}</p>
      )}
      {selectedPreset.authType === 'account' && codexAccount?.installed && !codexAccount.compatible && (
        <p className="ai-local-note">
          {t('ai.codexIncompatible', { version: codexAccount.version || t('common.unknown'), minimum: codexAccount.minimumVersion })}
        </p>
      )}
      {selectedPreset.authType === 'account' && codexAccount?.state === 'internal-error' && (
        <p className="ai-local-note" role="alert">{codexAccount.error}</p>
      )}

      {selectedPreset.authType === 'api-key' && <>
        <input
          className="ai-input"
          type="password"
          autoComplete="new-password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder={
            selectedPreset.id === 'openai'
              ? 'Ex.: sk-proj-...'
              : selectedPreset.id === 'deepseek'
                ? 'Ex.: sk-...'
                : selectedPreset.id === 'openrouter'
                  ? 'Ex.: sk-or-v1-...'
                  : selectedPreset.id === 'other'
              ? t('ai.pasteApiKey')
              : t('ai.apiKey')
          }
        />
        {selectedPreset.id === 'other' && (
          <input
            className="ai-input"
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder={t('ai.customUrlExample')}
          />
        )}
        {selectedPreset.id !== 'other' && (
          <div className="ai-advanced">
            <button type="button" className="ai-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              <ChevronDown size={11} className={`ai-chevron${showAdvanced ? ' open' : ''}`}/>
              {t('ai.advanced')}
            </button>
            {showAdvanced && (
              <input
                className="ai-input"
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder={t('ai.customUrl')}
              />
            )}
          </div>
        )}
      </>}

      {selectedPreset.authType === 'local' && (
        <p className="ai-local-note">
          {t('ai.localRunning', { service: presetName(selectedPreset, t) })}
        </p>
      )}

      <button
        className="ai-connect-btn"
        disabled={connecting || (selectedPreset.authType === 'account' && (!codexAccount?.installed || !codexAccount.compatible || codexAccount.protocolCompatible === false))}
        onClick={() => void connect()}
      >
        {connecting
          ? <><LoaderCircle className="spin" size={15}/> {t('ai.connecting')}</>
          : selectedPreset.authType === 'account' ? t('ai.signInChatGpt') : t('ai.connect')}
      </button>
    </div>}

    {step === 'model' && selectedPreset && <div className="ai-step-box">
      <div className="ai-step-top">
        <button className="ai-step-back" aria-label={t('ai.back')} onClick={() => setStep('auth')}><ArrowLeft size={16}/></button>
        <div className="ai-step-copy"><strong>{t('ai.chooseModel')}</strong><small>{t('ai.chooseModelHint')}</small></div>
      </div>
      <div className="ai-step-body">
        {connecting
          ? <div className="ai-searching"><LoaderCircle className="spin" size={20}/><span>{t('ai.searchingModels')}</span></div>
          : <>
              {models.length === 0
                ? <p className="ai-no-models">{t('ai.noModels')}</p>
                : <div className="ai-model-list">{models.map((m) => (
                    <button
                      key={`${m.providerId}/${m.modelId}`}
                      className={`ai-model-opt ${selectedModel?.modelId === m.modelId ? 'active' : ''}`}
                      disabled={m.availability !== 'available'}
                      onClick={() => setSelectedModel({ providerId: m.providerId, modelId: m.modelId })}
                    >
                      <Check size={14} className="ai-model-check"/>
                      <span className="ai-model-name">{m.displayName}</span>
                    </button>
                  ))}</div>}
            </>}
      </div>
      <div className="ai-step-foot">
        {!workspaceId && <span className="ai-workspace-required">{t('ai.selectWorkspace')}</span>}
        <button disabled={saving || !selectedModel || !workspaceId} className="ai-use-btn" onClick={() => void saveAndBind()}>
          {saving ? t('settings.saving') : t('ai.useModel')}
        </button>
      </div>
    </div>}

    {step === 'codex-model' && <div className="ai-step-box">
      <div className="ai-step-top">
        <button className="ai-step-back" aria-label={t('ai.back')} onClick={() => setStep('list')}><ArrowLeft size={16}/></button>
        <div className="ai-step-copy"><strong>{t('ai.codexModel')}</strong><small>{t('ai.codexModelHint')}</small></div>
      </div>
      <div className="ai-step-body">
        {loadingCodexModels
          ? <div className="ai-searching"><LoaderCircle className="spin" size={20}/><span>{t('ai.searchingModels')}</span></div>
          : codexModels.length === 0
            ? <p className="ai-no-models">{t('ai.noAccountModels')}</p>
            : <div className="ai-model-list">{codexModels.map((model) => (
                <button
                  key={model.model}
                  className={`ai-model-opt ${selectedCodexModel?.model === model.model ? 'active' : ''}`}
                  onClick={() => setSelectedCodexModel(model)}
                >
                  <Check size={14} className="ai-model-check"/>
                  <span className="ai-model-name">{model.displayName}</span>
                  {model.isDefault && <small>{t('ai.recommended')}</small>}
                </button>
              ))}</div>}
      </div>
      <div className="ai-step-foot">
        <button disabled={saving || !selectedCodexModel} className="ai-use-btn" onClick={() => void saveCodexModel()}>
          {saving ? t('settings.saving') : t('ai.useModel')}
        </button>
      </div>
    </div>}

    {confirmRemove && <div className="modal-backdrop" onMouseDown={() => setConfirmRemove(null)}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label={t('ai.confirmRemoval')} onMouseDown={(event) => event.stopPropagation()}>
        <p>{t('ai.confirmRemove')}</p>
        <div className="modal-actions">
          <button onClick={() => setConfirmRemove(null)}>{t('settings.cancel')}</button>
          <button className="danger" onClick={() => void remove(confirmRemove)}>{t('common.remove')}</button>
        </div>
      </div>
    </div>}
  </div>
}

function presetName(preset: ServicePreset, t: (key: string) => string) {
  return preset.id === 'codex' ? t('ai.chatGptAccount') : preset.id === 'other' ? t('ai.other') : preset.name
}

function CodexStatusSummary({ value }: { value: CodexAccountStatus }) {
  const { t } = useI18n()
  const message = {
    'not-installed': t('ai.codexNotInstalled', { version: value.recommendedVersion }),
    'not-authenticated': t('ai.codexNotAuthenticated'),
    incompatible: t('ai.codexIncompatible', { version: value.version ?? t('common.unknown'), minimum: value.minimumVersion }),
    'internal-error': value.error ?? t('ai.codexInternalError'),
    ready: '',
  }[value.state]
  return <div
    className={`provider-feedback ${value.state === 'not-authenticated' ? '' : 'error'}`}
    role={value.state === 'internal-error' ? 'alert' : 'status'}
  >
    {message}
  </div>
}

function ProviderDiagnosticSummary({ value }: { value: ProviderDiagnostic }) {
  const { t } = useI18n()
  const authentication = {
    'not-required': t('ai.notRequired'),
    configured: t('ai.configured'),
    missing: t('ai.missing'),
    rejected: t('ai.rejected'),
  }[value.authentication]
  const compatibility = {
    compatible: t('ai.compatible'),
    incompatible: t('ai.incompatible'),
    unknown: t('ai.notChecked'),
  }[value.compatibility]
  return <div className="provider-diagnostic" role="status">
    <div className="provider-diagnostic-grid">
      <span><small>{t('ai.status')}</small><strong>{value.availability.status}</strong></span>
      <span><small>{t('ai.connectivity')}</small><strong>{value.connectivity === 'connected' ? t('ai.connected') : value.connectivity === 'unreachable' ? t('ai.unreachable') : t('ai.notChecked')}</strong></span>
      <span><small>{t('ai.authentication')}</small><strong>{authentication}</strong></span>
      <span><small>{t('ai.compatibility')}</small><strong>{compatibility}</strong></span>
      <span><small>{t('ai.protocol')}</small><strong>{value.definition.protocol} {value.definition.version ?? ''}</strong></span>
      <span><small>{t('ai.response')}</small><strong>{value.latencyMs} ms</strong></span>
    </div>
    <div className="provider-capabilities" aria-label={t('ai.providerCapabilities')}>
      {value.definition.capabilities.modelDiscovery && <small>{t('ai.models')}</small>}
      {value.definition.capabilities.streaming && <small>{t('ai.streaming')}</small>}
      {value.definition.capabilities.toolCalling && <small>{t('ai.tools')}</small>}
      {value.definition.capabilities.cancellation && <small>{t('ai.cancellation')}</small>}
    </div>
    {value.definition.limitations.notes.length > 0 && <p>{value.definition.limitations.notes.join(' ')}</p>}
    {value.recentErrors.length > 0 && <details><summary>{t('ai.recentErrors', { count: value.recentErrors.length })}</summary><ul>{value.recentErrors.map((error) => <li key={`${error.occurredAt}-${error.message}`}>{error.message}</li>)}</ul></details>}
  </div>
}
