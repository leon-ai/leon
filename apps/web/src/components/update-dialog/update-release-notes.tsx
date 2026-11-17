import { lazy, Suspense } from 'react'

import { Loader } from '@/components/loader'
import { FeedAnimationProvider } from '@/components/streaming-text'
import { UPDATE_CHANGELOG_SECTIONS, type ReleaseChangeScope } from '../../../../../bridges/runtime/contracts/updates'

const MarkdownContent = lazy(() => import('@/components/markdown-content').then((module) => ({ default: module.MarkdownContent })))

/**
 * Shares settled, selectable release notes between independent update products.
 * Markdown engines load only while the owner is reading an update view.
 */
export function UpdateReleaseNotes({ id, summary, changelog }: {
  id: string
  summary: string
  changelog?: Record<ReleaseChangeScope, string>
}) {
  return <FeedAnimationProvider historicalIds={[`${id}:`]}>
    <Suspense fallback={<Loader label="Opening release notes…" />}>
      {summary ? <div className="update-highlights"><MarkdownContent animationId={`${id}:summary`} text={summary} /></div>
        : <p className="update-description">Release notes haven’t been published for this version yet.</p>}
      {changelog && <details className="update-changelog">
        <summary>Full changelog</summary>
        <div>{UPDATE_CHANGELOG_SECTIONS.map((scope) => changelog[scope.id] && <section key={scope.id} aria-label={scope.label}>
          <h4>{scope.label}</h4>
          <MarkdownContent animationId={`${id}:${scope.id}`} text={changelog[scope.id]} />
        </section>)}</div>
      </details>}
    </Suspense>
  </FeedAnimationProvider>
}
