import { useEffect, useRef, type RefObject } from 'react'
import { useAppStore } from '../store'
import { isBusy } from './format'

interface AppShortcutActions {
  isInteractionLocked(): boolean
  onCancel(): void | Promise<unknown>
  onCreateConversation(): void | Promise<unknown>
  onSelectWorkspace(): void | Promise<unknown>
  searchRef: RefObject<HTMLInputElement | null>
  composerRef: RefObject<HTMLTextAreaElement | null>
  onHelp(): void
}

export function useAppShortcuts(actions: AppShortcutActions) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const current = actionsRef.current
      if (event.key === '?' && !isTextEntryTarget(event.target) && !document.querySelector('[aria-modal="true"]')) {
        event.preventDefault()
        current.onHelp()
        return
      }
      if (!(event.ctrlKey || event.metaKey)) {
        if (event.key === 'Escape' && isBusy(useAppStore.getState().status) && !document.querySelector('[aria-modal="true"]')) void current.onCancel()
        return
      }
      if (document.querySelector('[aria-modal="true"]')) return
      if (current.isInteractionLocked()) return
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void current.onCreateConversation() }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); void current.onSelectWorkspace() }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); current.searchRef.current?.focus() }
      if (event.key === 'Enter') { event.preventDefault(); current.composerRef.current?.form?.requestSubmit() }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [])
}

function isTextEntryTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.isContentEditable || (element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)))
}
