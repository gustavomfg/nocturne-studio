import { useCallback, useState } from 'react'
import type { AppSettings } from '../../types'
import { errorMessage } from '../../shared/format'
import { translate, useI18n } from '../../shared/i18n'

const defaultSettings: AppSettings = {
  model: '',
  sandbox: 'workspace-write',
  approvalPolicy: 'on-request',
  diagnosticMode: false,
  theme: 'dark',
  language: 'pt-BR',
}

export function normalizeSettings(value: AppSettings): AppSettings {
  return {
    ...defaultSettings,
    ...value,
    model: value.model || '',
    sandbox: value.sandbox === 'read-only' ? 'read-only' : 'workspace-write',
    approvalPolicy: value.approvalPolicy === 'untrusted' ? 'untrusted' : 'on-request',
    diagnosticMode: value.diagnosticMode === true,
    theme: value.theme === 'light' ? 'light' : 'dark',
    language: value.language === 'en' ? 'en' : 'pt-BR',
  }
}

interface SettingsControllerOptions {
  onClose(): void
  onNotify(message: string): void
}

export function useSettingsController({ onClose, onNotify }: SettingsControllerOptions) {
  const { setLanguage } = useI18n()
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)

  const initializeSettings = useCallback((value: AppSettings) => {
    const normalized = normalizeSettings(value)
    setSettings(normalized)
    setLanguage(normalized.language ?? 'pt-BR')
  }, [setLanguage])

  const saveSettings = useCallback(async (next: AppSettings) => {
    try {
      const saved = await window.nocturne.settings.set(next)
      const updated = normalizeSettings({ ...next, ...saved })
      setSettings(updated)
      setLanguage(updated.language ?? 'pt-BR')
      onClose()
      onNotify(translate(updated.language ?? 'pt-BR', 'common.saved'))
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  }, [onClose, onNotify, setLanguage])

  const saveCodexModel = useCallback(async (model: string) => {
    try {
      const saved = await window.nocturne.settings.set({ model })
      setSettings((current) => normalizeSettings({ ...current, ...saved }))
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  }, [])

  return { settings, initializeSettings, saveSettings, saveCodexModel }
}
