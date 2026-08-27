import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, GitBranch } from 'lucide-react'
import type { GitInfo } from '../../types'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'

export function GitPanel({ activeId, gitInfo, onRefresh, onError, onNotify }: { activeId: string | null; gitInfo: GitInfo; onRefresh(): void; onError(value: string): void; onNotify(value: string): void }) {
  const { t } = useI18n()
  const visibleFiles = useMemo(() => gitInfo.files.slice(0, 500), [gitInfo.files])
  const [commitMessage, setCommitMessage] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const initializedForRef = useRef<string | null>(null)
  const [committing, setCommitting] = useState(false)
  useEffect(() => {
    const available = new Set(gitInfo.files.map((file) => file.path))
    setSelected((current) => initializedForRef.current === activeId ? current.filter((file) => available.has(file)) : visibleFiles.map((file) => file.path))
    initializedForRef.current = activeId
  }, [activeId, gitInfo.files, visibleFiles])
  const toggle = (file: string) => setSelected((current) => current.includes(file) ? current.filter((item) => item !== file) : [...current, file])
  const commit = async () => {
    if (!activeId || !commitMessage.trim() || !selected.length || committing) return
    setCommitting(true)
    try { await window.nocturne.git.commit(activeId, commitMessage, selected); setCommitMessage(''); onRefresh(); onNotify(t('git.commitCreated')) }
    catch (error) { onError(errorMessage(error)) }
    finally { setCommitting(false) }
  }
  return <div className="git-panel"><div className="diff-title"><GitBranch size={14}/>Git · {gitInfo.branch}<span>{selected.length}/{gitInfo.files.length}</span></div>
    {gitInfo.diffTruncated && <p className="git-diff-warning" role="status">{t('git.diffLarge')}</p>}
    {(gitInfo.filesTruncated || gitInfo.files.length > visibleFiles.length) && <p className="git-diff-warning" role="status">{t('git.filesLarge')}</p>}
    <div className="git-file-list">{visibleFiles.map((file) => <label key={file.path}><input type="checkbox" checked={selected.includes(file.path)} onChange={() => toggle(file.path)}/><span className="git-file-status">{file.status}</span><span title={file.path}>{file.path}</span></label>)}</div>
    {!gitInfo.files.length && <p className="git-clean">{t('git.clean')}</p>}
    <div className="commit-row"><label className="sr-only" htmlFor="commit-message">{t('git.commitMessage')}</label><input id="commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t('git.commitMessage')} disabled={committing}/><button aria-label={committing ? t('git.creatingCommit') : t('git.createCommitWithSelectedFiles')} title={committing ? `${t('git.creatingCommit')}…` : t('git.createCommitWithSelectedFiles')} disabled={committing || !commitMessage.trim() || !selected.length} onClick={commit}><Check size={13}/></button></div>
  </div>
}
