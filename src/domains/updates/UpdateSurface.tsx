import { UpdateToast } from './UpdateToast'
import { useUpdates } from './useUpdateStore'

export function UpdateSurface() {
  const { state, download, retry, install } = useUpdates()
  return <UpdateToast state={state} onDownload={() => { void download() }} onRetry={() => { void retry() }} onInstall={() => { void install() }}/>
}
