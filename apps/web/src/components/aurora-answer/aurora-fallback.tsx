import { Component, useLayoutEffect, type ReactNode } from 'react'
import type { AuroraSurface } from '../../../../../aurora/src/v2/contracts/answer'
import type { Artifact } from '../../../../../server/src/core/artifacts/artifact-types'
import { MarkdownContent } from '@/components/markdown-content'
import { ArtifactAttachments } from '@/components/artifact-attachments'
import type { RetiredResultsData } from '../../../../../aurora/src/v2/contracts/presentation'

/**
 * Keeps retired result nodes readable without reinstating a generation widget.
 */
export function RetiredResults({ title, description, items }: RetiredResultsData) {
  return <section aria-label={title}>
    <p>{title}</p>
    {description && <p>{description}</p>}
    <ul>{items.map((item) => <li key={item.id}>{item.title}
      {item.description && ` — ${item.description}`}{item.url && ` (${item.url})`}
      {item.source && ` — ${item.source}`}</li>)}</ul>
  </section>
}

export interface AuroraViewProps {
  surface: AuroraSurface
  artifacts: Artifact[]
  active: boolean
  fallbackText?: string | undefined
  onReady?: () => void
}

/**
 * Keeps the owner's question readable without the optional native rendering engine.
 * Plain React text cannot enable generated controls, actions or executable content.
 */
export function AuroraFallback({ surface, artifacts, fallbackText, onReady, textOnly = false }: AuroraViewProps & { textOnly?: boolean }) {
  useLayoutEffect(() => onReady?.(), [onReady])
  const seen = new Set<string>()
  const content: ReactNode[] = []
  const elements = surface.spec?.elements

  function visit(id: string): void {
    if (!elements || seen.has(id) || !Object.hasOwn(elements, id)) {
      return
    }
    seen.add(id)
    const node = elements[id]
    if (!node?.props) {
      return
    }
    if (node.type === 'Stack') {
      if (Array.isArray(node.children)) {
        node.children.forEach(visit)
      }
    } else if (node.type === 'Text' && typeof node.props.text === 'string') {
      content.push(<MarkdownContent key={id} animationId={`${surface.id}:${id}:fallback`} text={node.props.text} />)
    } else if (node.type === 'Artifacts') {
      content.push(<ArtifactAttachments key={id} title={node.props.title}
        artifacts={artifacts.filter((artifact) => Array.isArray(node.props.artifactIds) && node.props.artifactIds.includes(artifact.id))} />)
    } else if (node.type === 'Generated') {
      content.push(<section key={id} aria-label={node.props.title}>
        <p>{node.props.title}</p><p style={{ whiteSpace: 'pre-wrap' }}>{node.props.fallback}</p>
      </section>)
    } else if (node.type === 'Results') {
      content.push(<RetiredResults key={id} {...node.props} />)
    } else if (node.type === 'DataTable' || node.type === 'Comparison' || node.type === 'Chart') {
      const lines = node.type === 'DataTable' ? node.props.rows.map((row) => node.props.columns
        .map((column) => `${column.label}: ${String(row.values[column.key] ?? '—')}`).join(' · ')) :
        node.type === 'Comparison' ? node.props.options.map((option) => `${option.title}: ${node.props.criteria
          .map((criterion) => `${criterion.label}: ${String(option.values[criterion.key] ?? '—')}`).join(' · ')}`) :
          node.props.categories.map((category, index) => `${category}: ${node.props.series
            .map((series) => `${series.label} ${series.values[index]}${node.props.unit ? ` ${node.props.unit}` : ''}`).join(' · ')}`)
      content.push(<section key={id} aria-label={node.props.title}>
        <p>{node.props.title}</p><p style={{ whiteSpace: 'pre-wrap' }}>{lines.join('\n')}</p>
      </section>)
    } else if (node.type === 'BooleanChoice' || node.type === 'Choice' || node.type === 'Form') {
      const receipt = surface.receipts?.[id]
      content.push(<section key={id} aria-label={node.props.title}>
        <p>{node.props.title}</p>
        {node.props.description && <p>{node.props.description}</p>}
        {node.type === 'BooleanChoice' ? <p>Yes / No</p> : node.type === 'Choice' ? <ul>
          {Array.isArray(node.props.options) && node.props.options.map((option) => <li key={option.value}>{option.label}{option.description && ` — ${option.description}`}</li>)}
        </ul> : <ul>{Array.isArray(node.props.fields) && node.props.fields.map((field) => <li key={field.name}>
          {field.label}{field.required ? ' (required)' : ''}
          {Array.isArray(field.options) && field.options.length ? `: ${field.options.map((option) => option.label).join(', ')}` : ''}
        </li>)}</ul>}
        {receipt && <p>Already answered.</p>}
      </section>)
    }
  }

  if (!textOnly && elements && typeof elements === 'object') {
    visit(surface.spec.root)
  }

  return <div className="aurora-answer-stack">
    <p className="aurora-feedback">I couldn’t display the interactive version. You can still read it here and reply below.</p>
    {content.length ? content : <MarkdownContent animationId={`${surface.id}:fallback`} text={fallbackText ?? 'Please ask me to show this answer again.'} />}
  </div>
}

/**
 * A failed optional surface must not remove the surrounding conversation.
 */
export class AuroraBoundary extends Component<{ children: ReactNode, fallback: ReactNode }, { failed: boolean }> {
  public override state = { failed: false }

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  public override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
