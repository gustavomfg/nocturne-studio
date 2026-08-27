import type { ComponentProps, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { safeExternalUrl } from './markdownSecurity'
import { getCurrentLanguage, translate } from './i18n'

function SafeLink({ href, children }: ComponentProps<'a'>) {
  const external = safeExternalUrl(href)
  const language = getCurrentLanguage()
  const label = translate(language, 'common.linkNotAllowed')
  return external ? <a href={external} target="_blank" rel="noreferrer noopener">{children}</a> : <span className="blocked-markdown-link" title={label}>{children}</span>
}

function BlockedImage({ alt }: ComponentProps<'img'>) {
  const language = getCurrentLanguage()
  const label = translate(language, 'common.markdownImageBlocked')
  return <span className="blocked-markdown-link" title={label}>{alt || translate(language, 'common.imageBlocked')}</span>
}

export function SafeMarkdown({ children }: { children: ReactNode }) {
  return <ReactMarkdown components={{ a: SafeLink, img: BlockedImage }}>{String(children ?? '')}</ReactMarkdown>
}
