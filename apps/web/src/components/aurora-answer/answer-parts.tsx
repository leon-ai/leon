import { lazy, Suspense, useState } from 'react'
import { parseMarkdownIntoBlocks } from 'streamdown'
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

function omitRepeatedQuestion(text: string, questionTitles: string[]): string {
  const trimmed = text.trimEnd()
  if (!questionTitles.some((title) => trimmed.endsWith(title))) {
    return text
  }

  // Require a complete Markdown block so the same words in a list, code block, or longer paragraph stay visible.
  const lastBlock = parseMarkdownIntoBlocks(trimmed).at(-1)
  if (lastBlock && questionTitles.includes(lastBlock) && trimmed.endsWith(lastBlock)) {
    return trimmed.slice(0, -lastBlock.length).trimEnd()
  }

  return text
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
  const clarifications = parts.flatMap((part) =>
    part.kind === 'ui' && part.surface.purpose === 'clarification' && part.surface.status === 'ready' ? [part.surface] : []
  )
  const questionTitles = clarifications.flatMap(({ spec }) => Object.values(spec.elements).flatMap((node) =>
    node.type === 'BooleanChoice' || node.type === 'Choice' || node.type === 'Form' ? [node.props.title] : []
  ))

  // Older clarifications saved the explanation on the message itself.
  const restoreClarification = clarifications.length > 0 && fallbackText.trim().length > 0 &&
    !parts.some((part) => part.kind === 'text')
  const orderedParts = restoreClarification
    ? [{ id: `${animationId}:clarification`, kind: 'text' as const, text: fallbackText }, ...parts]
    : parts

  return <div className="answer-parts">{orderedParts.map((part) => {
    if (part.kind === 'text') {
      const text = omitRepeatedQuestion(part.text, questionTitles)

      return text ? <MarkdownContent key={part.id} animationId={`${animationId}:${part.id}`} text={text} active={active} /> : null
    }
    if (part.kind === 'artifacts') {
      return <ArtifactAttachments key={part.id} artifacts={artifacts.filter((artifact) => part.artifactIds.includes(artifact.id))} />
    }

    return <VisualPart key={`${part.id}:${part.surface.revision}`} part={part} artifacts={artifacts}
      active={active} fallbackText={fallbackText} animationId={animationId} />
  })}</div>
}
