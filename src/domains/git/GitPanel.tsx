import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, GitBranch } from 'lucide-react'
import type { GitInfo } from '../../types'
import { errorMessage } from '../../shared/format'
import { useConfirmDialog } from '../../shared/ConfirmDialog'
import { useI18n } from '../../shared/i18n'

export function GitPanel({ activeId, gitInfo, onRefresh, onError, onNotify }: { activeId: string | null; gitInfo: GitInfo; onRefresh(): void; onError(value: string): void; onNotify(value: string): void }) {
  const { t } = useI18n()
  const visibleFiles = useMemo(() => gitInfo.files.slice(0, 500), [gitInfo.files])
  const [commitMessage, setCommitMessage] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const initializedForRef = useRef<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const confirmation = useConfirmDialog()
  useEffect(() => {
    const available = new Set(gitInfo.files.map((file) => file.path))
    setSelected((current) => initializedForRef.current === activeId ? current.filter((file) => available.has(file)) : [])
    initializedForRef.current = activeId
  }, [activeId, gitInfo.files, visibleFiles])
  const toggle = (file: string) => setSelected((current) => current.includes(file) ? current.filter((item) => item !== file) : [...current, file])
  const allSelected = visibleFiles.length > 0 && selected.length === visibleFiles.length
  const toggleAll = () => setSelected(allSelected ? [] : visibleFiles.map((file) => file.path))
  const commit = async () => {
    if (!activeId || !commitMessage.trim() || !selected.length || committing) return
    const shownFiles = selected.slice(0, 5).join(', ')
    const filesLabel = selected.length > 5 ? `${shownFiles} + ${selected.length - 5}` : shownFiles
    if (!await confirmation.confirm({
      title: t('git.commitConfirmTitle'),
      description: t('git.commitConfirmDescription', { branch: gitInfo.branch, count: selected.length, files: filesLabel }),
      confirmLabel: t('git.createCommit'),
    })) return
    setCommitting(true)
    try { await window.nocturne.git.commit(activeId, commitMessage, selected); setCommitMessage(''); onRefresh(); onNotify(t('git.commitCreated')) }
    catch (error) { onError(errorMessage(error)) }
    finally { setCommitting(false) }
  }
  return <><div className="git-panel"><div className="diff-title"><GitBranch size={14}/><span>Git · {gitInfo.branch}</span><span>{selected.length}/{gitInfo.files.length}</span></div>
    {gitInfo.diffTruncated && <p className="git-diff-warning" role="status">{t('git.diffLarge')}</p>}
    {(gitInfo.filesTruncated || gitInfo.files.length > visibleFiles.length) && <p className="git-diff-warning" role="status">{t('git.filesLarge')}</p>}
    <div className="git-selection-bar" role="group" aria-label={t('git.selectionSummary')}><span>{t('git.selectedCount', { selected: selected.length, total: visibleFiles.length })}</span><div><button type="button" onClick={toggleAll} disabled={!visibleFiles.length || allSelected}>{t('git.selectAll')}</button><button type="button" onClick={() => setSelected([])} disabled={!selected.length}>{t('git.clearSelection')}</button></div></div>
    <div className="git-file-list">{visibleFiles.map((file) => <label key={file.path}><input type="checkbox" checked={selected.includes(file.path)} onChange={() => toggle(file.path)}/><span className="git-file-status">{file.status}</span><span title={file.path}>{file.path}</span></label>)}</div>
    {!gitInfo.files.length && <p className="git-clean">{t('git.clean')}</p>}
    <div className="commit-row"><label className="sr-only" htmlFor="commit-message">{t('git.commitMessage')}</label><input id="commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t('git.commitMessage')} disabled={committing}/><button aria-label={committing ? t('git.creatingCommit') : t('git.createCommitWithSelectedFiles')} title={committing ? `${t('git.creatingCommit')}…` : t('git.createCommitWithSelectedFiles')} disabled={committing || !commitMessage.trim() || !selected.length} onClick={commit}><Check size={13}/></button></div>
  </div>{confirmation.dialog}</>
}
