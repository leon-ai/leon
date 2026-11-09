import { createContext, lazy, Suspense, useContext, useMemo, useState, useLayoutEffect } from 'react'
import { JSONUIProvider, Renderer, type ComponentRenderProps } from '@json-render/react'
import type { Spec } from '@json-render/core'
import { BooleanChoiceWidget, ChoiceWidget, FormWidget, DataTableWidget, ComparisonWidget } from '../../../../../aurora/src/v2'
import { isAuroraSpec, isAuroraSubmission, type AuroraNode, type AuroraSurface, type AuroraValues } from '../../../../../aurora/src/v2/contracts/answer'
import type { Artifact } from '../../../../../server/src/core/artifacts/artifact-types'
import { ConversationDetailsContext } from '@/data/conversation-details'
import { useAuroraSubmission } from '@/data/aurora'
import { useTabDraft } from '@/data/tab-draft'
import { ArtifactAttachments } from '@/components/artifact-attachments'
import { MarkdownContent } from '@/components/markdown-content'
import { AuroraFallback, RetiredResults, type AuroraViewProps } from './aurora-fallback'
import { isGeneratedState } from '../../../../../aurora/src/v2/contracts/generated'
import { VisualLayout } from '@/components/visual-layout/visual-layout'

const ChartWidget = lazy(() => import('./chart-widget'))

const SurfaceContext = createContext<{ surface: AuroraSurface, artifacts: Artifact[], active: boolean } | null>(null)

function InteractiveNode({ nodeId }: { nodeId: string }) {
  const context = useContext(SurfaceContext)!
  const owner = useContext(ConversationDetailsContext)
  const { surface } = context
  const node = surface.spec.elements[nodeId]!
  const receipt = Object.hasOwn(surface.receipts, nodeId) ? surface.receipts[nodeId] : undefined
  const [draft, setDraft] = useTabDraft('aurora-draft', [owner?.sessionId, owner?.messageId, surface.id, nodeId, surface.revision])
  const request = useAuroraSubmission(owner?.sessionId ?? '', owner?.messageId ?? '', surface.id, nodeId, surface.revision)
  let initial: AuroraValues | undefined = receipt?.values
  if (initial === undefined && draft) {
    try {
      const value: unknown = JSON.parse(draft)
      if (isAuroraSubmission(node, value, 'draft')) {
        initial = value
      }
    } catch {
      // An unavailable or invalid local draft must not prevent answering.
    }
  }
  const readOnly = !owner || surface.status !== 'ready' || owner.latestOwnerMessageId !== surface.ownerMessageId
  const shared = { submitted: Boolean(receipt), readOnly,
    onSubmit: async (values: AuroraValues): Promise<void> => {
      await request.mutateAsync(values)
      setDraft('')
    },
    onDraftChange: (values: AuroraValues): void => setDraft(JSON.stringify(values))
  }

  return <div className="aurora-answer-interaction">
    {node.type === 'BooleanChoice' ? <BooleanChoiceWidget {...node.props} {...shared}
      {...(typeof initial === 'boolean' ? { initialValue: initial } : {})} /> :
      node.type === 'Choice' ? <ChoiceWidget {...node.props} {...shared}
        {...(Array.isArray(initial) ? { initialValue: initial } : {})} /> :
        node.type === 'Form' ? <FormWidget {...node.props} {...shared}
          {...(initial && typeof initial === 'object' && !Array.isArray(initial) ? { initialValues: initial } : {})} /> : null}
    {readOnly && !receipt && <p className="aurora-feedback">{surface.status === 'draft' && context.active ? 'Getting this ready…' : 'This question is no longer active.'}</p>}
  </div>
}

function NativeNode({ element, children }: ComponentRenderProps) {
  const context = useContext(SurfaceContext)!
  const owner = useContext(ConversationDetailsContext)
  const nodeId = String(element.props['auroraNodeId'])
  const node: AuroraNode = context.surface.spec.elements[nodeId]!

  if (node.type === 'Stack') {
    return <div className="aurora-answer-stack">{children}</div>
  }
  if (node.type === 'Text') {
    return <MarkdownContent animationId={`${owner?.messageId ?? context.surface.id}:${context.surface.id}:${nodeId}`}
      text={node.props.text} active={context.active} />
  }
  if (node.type === 'Artifacts') {
    return <ArtifactAttachments title={node.props.title}
      artifacts={context.artifacts.filter((artifact) => node.props.artifactIds.includes(artifact.id))} />
  }
  if (node.type === 'Results') {
    return <RetiredResults {...node.props} />
  }
  if (node.type === 'DataTable') {
    return <DataTableWidget {...node.props} />
  }
  if (node.type === 'Comparison') {
    return <ComparisonWidget {...node.props} />
  }
  if (node.type === 'Chart') {
    return <ChartNodeView nodeId={nodeId} />
  }
  if (node.type === 'Generated') {
    return <AuroraFallback {...context} />
  }

  const receipt = Object.hasOwn(context.surface.receipts, nodeId) ? context.surface.receipts[nodeId] : undefined

  // Revisions replace unfinished forms; a receipt restores the accepted values
  // even when another browser answered while this one held a local draft.
  return <InteractiveNode key={`${context.surface.revision}:${receipt?.commandId ?? 'draft'}`} nodeId={nodeId} />
}

function ChartNodeView({ nodeId }: { nodeId: string }) {
  const { surface } = useContext(SurfaceContext)!
  const owner = useContext(ConversationDetailsContext)
  const [ready, setReady] = useState(false)
  const node = surface.spec.elements[nodeId]!
  if (node.type !== 'Chart') {
    return null
  }

  return <VisualLayout identity={`${owner?.sessionId}:${owner?.messageId}:${surface.id}:${surface.revision}:${nodeId}`}
    estimatedHeight="440px" label="Drawing the chart…" ready={ready}>
    <Suspense fallback={null}><ChartWidget {...node.props} onReady={() => setReady(true)} /></Suspense>
  </VisualLayout>
}

const REGISTRY = { Stack: NativeNode, Text: NativeNode, BooleanChoice: NativeNode, Choice: NativeNode, Form: NativeNode,
  Artifacts: NativeNode, Generated: NativeNode, Results: NativeNode, DataTable: NativeNode, Comparison: NativeNode, Chart: NativeNode }

/**
 * Renders the approved catalog only. Internal node identity is added after validation;
 * model-supplied events, expressions and arbitrary element props are never enabled.
 */
export default function AuroraSurfaceView({ surface, artifacts, active, fallbackText, onReady }: AuroraViewProps) {
  useLayoutEffect(() => onReady?.(), [onReady])
  const valid = useMemo(() => isAuroraSpec(surface.spec), [surface.spec])
  const spec = useMemo<Spec>(() => valid ? ({ root: surface.spec.root,
    elements: Object.fromEntries(Object.entries(surface.spec.elements).map(([id, node]) =>
      [id, { ...node, props: { ...node.props, auroraNodeId: id } }])) }) : { root: '', elements: {} }, [surface.spec, valid])
  const context = useMemo(() => ({ surface, artifacts, active }), [surface, artifacts, active])

  if (!valid) {
    return <AuroraFallback surface={surface} artifacts={artifacts} active={active} fallbackText={fallbackText} textOnly />
  }

  return <SurfaceContext value={context}>
    <JSONUIProvider registry={REGISTRY}><Renderer spec={spec} registry={REGISTRY} /></JSONUIProvider>
  </SurfaceContext>
}
