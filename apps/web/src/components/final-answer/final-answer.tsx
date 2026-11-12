import { MarkdownContent } from '@/components/markdown-content'
import { MessageMetadata } from '@/components/message-metadata'
import type { ConversationMetrics } from '@/data/conversation'
import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'
import type { ConnectionSetupDescriptor } from '../../../../../aurora/src/contracts/connection-setup'
import { Loader } from '@/components/loader'
import { AnswerParts } from '@/components/aurora-answer/answer-parts'
import type { AnswerPart } from '../../../../../aurora/src/v2/contracts/answer'
import type { Artifact } from '../../../../../server/src/core/artifacts/artifact-types'
import { ArtifactAttachments } from '@/components/artifact-attachments'
import { ToolPreparation } from '@/components/tool-call/tool-preparation'
import type { ToolPreparationSnapshot } from '../../../../../aurora/src/v2/contracts/preparation'

import './final-answer.sass'

const FINAL_ANSWER_ANIMATION_DELAY = 1_000
const ConnectionSetupCard = lazy(() => import('@/components/connection-setup/connection-setup'))

interface FinalAnswerProps {
  animationId: string
  children: string
  parts?: AnswerPart[] | undefined
  artifacts?: Artifact[] | undefined
  connections?: ConnectionSetupDescriptor[] | undefined
  timestamp?: number | undefined
  metrics?: ConversationMetrics | undefined
  footer?: ReactNode
  active?: boolean | undefined
  preparations?: { id: string, preparation: ToolPreparationSnapshot }[] | undefined
}

export function FinalAnswer({
  animationId,
  children,
  timestamp,
  metrics,
  footer,
  active,
  parts,
  connections,
  preparations,
  artifacts = []
}: FinalAnswerProps) {
  return (
    <div className="final-answer">
      <section className="final-answer-body" aria-label="Leon’s final answer">
        {preparations?.map(({ id, preparation }) => <ToolPreparation key={id} preparation={preparation} />)}
        {parts?.length ? <AnswerParts parts={parts} artifacts={artifacts} animationId={animationId} active={active} fallbackText={children} /> : <>
        <MarkdownContent
          animationId={animationId}
          active={active}
          startDelay={FINAL_ANSWER_ANIMATION_DELAY}
          text={children}
        />
        {artifacts.length > 0 && <ArtifactAttachments artifacts={artifacts} />}
        </>}
        {connections?.map((connection) => <Suspense key={connection.provider}
          fallback={<Loader size="sm" label="Getting connection setup ready…" />}>
          <ConnectionSetupCard connection={connection} />
        </Suspense>)}
      </section>
      {footer}
      <MessageMetadata role="leon" text={children} timestamp={timestamp} metrics={metrics} />
    </div>
  )
}
