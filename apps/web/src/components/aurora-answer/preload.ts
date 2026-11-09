import type { AnswerPart } from '../../../../../aurora/src/v2/contracts/answer'
import { prefetchModule } from '@/utils/prefetch'

/**
 * Warms only rendering code required by the newest fetched reply. Importing a
 * sandbox runtime does not create a document or execute generated source.
 */
export function prefetchAnswerRendering(message: { message: string, answerParts?: AnswerPart[] } | undefined): void {
  if (!message) {
    return
  }
  prefetchModule(() => import('@/components/markdown-content'))
  const surfaces = message.answerParts?.filter((part) => part.kind === 'ui') ?? []
  if (!surfaces.length) {
    return
  }
  prefetchModule(() => import('./aurora-surface'))
  const nodes = surfaces.flatMap((part) => Object.values(part.surface?.spec?.elements ?? {}))
  if (nodes.some((node) => node?.type === 'Generated')) {
    prefetchModule(() => import('./generated/generated-frame'))
  }
  if (nodes.some((node) => node?.type === 'Chart')) {
    prefetchModule(() => import('./chart-widget'))
    prefetchModule(() => import('../../../../../aurora/src/v2/widgets/chart-engine'))
    prefetchModule(() => import('../../../../../aurora/src/v2/widgets/chart-series'))
  }
}
