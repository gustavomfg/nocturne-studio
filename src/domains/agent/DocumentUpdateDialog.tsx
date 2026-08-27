import { createPortal } from 'react-dom'
import { FileText, X } from 'lucide-react'
import type { DocumentUpdatePreview } from '../../types'
import { useDialogA11y } from '../../shared/useDialogA11y'
import { useI18n } from '../../shared/i18n'

interface Props {
  preview: DocumentUpdatePreview
  busy: boolean
  onClose(): void
  onApply(strategy: 'append' | 'replace'): void
}

export function DocumentUpdateDialog({ preview, busy, onClose, onApply }: Props) {
  const { t } = useI18n()
  const dialogRef = useDialogA11y<HTMLElement>(onClose)
  const exists = preview.expectedHash !== null
  return createPortal(
    <div className="preview-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <section
        ref={dialogRef}
        className="document-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-update-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><FileText size={18}/><span><strong id="document-update-title">{exists ? t('docs.reviewUpdate') : t('docs.reviewNew')}</strong><small>{preview.name}</small></span></div>
          <button disabled={busy} aria-label={t('docs.closeComparison')} title={t('common.close')} onClick={onClose}><X size={17}/></button>
        </header>
        <div className="document-update-body">
          <p>{t('docs.compareBeforeWrite')}</p>
          <div className="document-update-comparison">
            <section>
              <h3>{exists ? t('docs.currentDocument') : t('docs.newFile')}</h3>
              <pre>{exists ? preview.existing : t('docs.fileMissing')}</pre>
            </section>
            <section>
              <h3>{t('docs.proposedContent')}</h3>
              <pre>{preview.generated}</pre>
            </section>
          </div>
        </div>
        <footer>
          <button disabled={busy} onClick={onClose}>{t('settings.cancel')}</button>
          {exists && <button disabled={busy} onClick={() => onApply('append')}>{busy ? t('docs.applying') : t('docs.append')}</button>}
          <button className="primary" disabled={busy} onClick={() => onApply('replace')}>{busy ? t('docs.applying') : exists ? t('docs.replace') : t('docs.create')}</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
