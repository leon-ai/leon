import { lazy, Suspense, useState } from 'react'
import type { AnswerPart } from '../../../../../aurora/src/v2/contracts/answer'
import type { Artifact } from '../../../../../server/src/core/artifacts/artifact-types'
import { MarkdownContent } from '@/components/markdown-content'
import { ArtifactAttachments } from '@/components/artifact-attachments'
import { AuroraBoundary, AuroraFallback } from './aurora-fallback'
import { VisualLayout } from '@/components/visual-layout/visual-layout'

import './answer-parts.sass'

const AuroraSurfaceView = lazy(() => import('./aurora-surface').catch(() => ({
  default: AuroraFallback
})))

function VisualPart({ part, artifacts, active, fallbackText, animationId }: {
  part: Extract<AnswerPart, { kind: 'ui' }>
  artifacts: Artifact[]
  active: boolean | undefined
  fallbackText: string
  animationId: string
}) {
  const [ready, setReady] = useState(false)
  const props = { surface: part.surface, artifacts, active: active ?? false, fallbackText,
    onReady: () => setReady(true) }
  const node = part.surface.spec.elements[part.surface.spec.root]
  const estimatedHeight = node?.type === 'Generated' ?
    `calc(${node.props.height ?? 360}px + var(--button-md-icon-only-size) + var(--space-sm) * 2 + var(--line-height-sm))` : undefined

  return <VisualLayout identity={`${animationId}:${part.id}:${part.surface.revision}`} ready={ready}
    {...(estimatedHeight ? { estimatedHeight } : {})}>
    <AuroraBoundary fallback={<AuroraFallback {...props} />}>
      <Suspense fallback={null}><AuroraSurfaceView {...props} /></Suspense>
    </AuroraBoundary>
  </VisualLayout>
}

/**
 * Keeps Markdown, visual surfaces and files in their recorded answer order.
 */
export function AnswerParts({ parts, artifacts, animationId, active, fallbackText }: {
  parts: AnswerPart[]
  artifacts: Artifact[]
  animationId: string
  active: boolean | undefined
  fallbackText: string
}) {
  return <div className="answer-parts">{parts.map((part) => {
    if (part.kind === 'text') {
      return <MarkdownContent key={part.id} animationId={`${animationId}:${part.id}`} text={part.text} active={active} />
    }
    if (part.kind === 'artifacts') {
      return <ArtifactAttachments key={part.id} artifacts={artifacts.filter((artifact) => part.artifactIds.includes(artifact.id))} />
    }

    return <VisualPart key={`${part.id}:${part.surface.revision}`} part={part} artifacts={artifacts}
      active={active} fallbackText={fallbackText} animationId={animationId} />
  })}</div>
}
