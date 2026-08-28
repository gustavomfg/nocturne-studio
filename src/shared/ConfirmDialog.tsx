/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useDialogA11y } from './useDialogA11y'
import { useI18n } from './i18n'

interface Confirmation { title: string; description: string; confirmLabel: string; danger?: boolean; resolve(value: boolean): void }

export function useConfirmDialog() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const pendingRef = useRef<Confirmation['resolve'] | null>(null)
  useEffect(() => () => { pendingRef.current?.(false); pendingRef.current = null }, [])
  const confirm = (options: Omit<Confirmation, 'resolve'>) => new Promise<boolean>((resolve) => {
    pendingRef.current?.(false)
    pendingRef.current = resolve
    setConfirmation({ ...options, resolve })
  })
  const close = (result: boolean) => { pendingRef.current?.(result); pendingRef.current = null; setConfirmation(null) }
  return { confirm, dialog: confirmation ? <ConfirmDialog value={confirmation} onClose={close}/> : null }
}

function ConfirmDialog({ value, onClose }: { value: Confirmation; onClose(result: boolean): void }) {
  const { t } = useI18n()
  const dialogRef = useDialogA11y<HTMLDivElement>(() => onClose(false))
  return createPortal(<div className="modal-backdrop confirmation-backdrop" onMouseDown={() => onClose(false)}><div ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
    <span className={`confirmation-icon ${value.danger ? 'danger' : ''}`}><AlertTriangle size={19}/></span><div><h2 id="confirmation-title">{value.title}</h2><p id="confirmation-description">{value.description}</p></div>
    <footer><button onClick={() => onClose(false)}>{t('settings.cancel')}</button><button className={value.danger ? 'danger' : 'primary'} onClick={() => onClose(true)}>{value.confirmLabel}</button></footer>
  </div></div>, document.body)
}
