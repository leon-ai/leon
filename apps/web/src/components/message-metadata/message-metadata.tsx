import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { clsx } from 'clsx'

import { ActivityTimestamp } from '@/components/activity-timestamp'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { Dropdown } from '@/components/dropdown'
import { Icon } from '@/components/icon'
import { ScrollContainer } from '@/components/scroll-container'
import { Tooltip } from '@/components/tooltip'
import type { ConversationMetrics } from '@/data/conversation'

import './message-metadata.sass'

const TOKEN_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0
})
const RATE_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})
const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const METRIC_ROW_HEIGHT_PX = 40
const METRICS_CHROME_HEIGHT_PX = 10
const METRICS_WIDTH_PX = 340

interface MetricRow {
  label: string
  value: string
  icon: string
}

interface MessageMetadataProps {
  role: 'owner' | 'leon'
  text: string
  timestamp?: number | undefined
  metrics?: ConversationMetrics | undefined
}

function isCount(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0
}

// Missing provider accounting is unknown, not zero; cache coverage describes
// observed calls rather than promising that every request reported its usage.
function getMetricRows(metrics: ConversationMetrics | undefined): MetricRow[] {
  if (!metrics) {
    return []
  }

  const rows: MetricRow[] = []
  const counts = [
    ['in', metrics.inputTokens],
    ['out', metrics.outputTokens],
    ['total', metrics.totalTokens]
  ] as const
  const tokenCounts: string[] = []

  for (const [label, value] of counts) {
    if (isCount(value)) {
      tokenCounts.push(`${TOKEN_FORMATTER.format(value)} ${label}`)
    }
  }

  if (tokenCounts.length) {
    rows.push({
      label: 'Tokens',
      value: tokenCounts.join(' · '),
      icon: 'copper-coin-line'
    })
  }

  const accounting = metrics.usageAccounting

  if (
    isCount(accounting?.cachedInputTokens) &&
    isCount(accounting?.cacheReadCompletionCount) &&
    accounting.cacheReadCompletionCount > 0
  ) {
    const complete = accounting.cacheReadCompletionCount === metrics.completionCount &&
      isCount(metrics.inputTokens) && metrics.inputTokens > 0
    const coverage = complete
      ? `${PERCENT_FORMATTER.format(100 * accounting.cachedInputTokens / metrics.inputTokens!)}%`
      : 'partial'
    rows.push({
      label: 'Cached input tokens',
      value: `${TOKEN_FORMATTER.format(accounting.cachedInputTokens)} (${coverage})`,
      icon: 'database-line'
    })
  }

  const speed = isCount(metrics.tokensPerSecond) && metrics.tokensPerSecond > 0
    ? metrics.tokensPerSecond
    : metrics.averagedPhaseTokensPerSecond

  if (isCount(speed) && speed > 0) {
    rows.push({
      label: 'Tokens per second',
      value: RATE_FORMATTER.format(speed),
      icon: 'flashlight-line'
    })
  }

  if (isCount(metrics.contextUsedTokens)) {
    let value = `${metrics.contextUsageEstimated ? '~' : ''}${TOKEN_FORMATTER.format(metrics.contextUsedTokens)}`
    if (isCount(metrics.contextWindowTokens) && metrics.contextWindowTokens > 0) {
      value += ` / ${TOKEN_FORMATTER.format(metrics.contextWindowTokens)}`
      if (isCount(metrics.contextUsagePercent)) {
        value += ` (${PERCENT_FORMATTER.format(metrics.contextUsagePercent)}%)`
      }
    } else {
      value += ' tokens'
    }
    rows.push({ label: 'Context usage', value, icon: 'database-2-line' })
  }

  return rows
}

function MessageInfo({ rows, open }: { rows: MetricRow[], open: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read-only popovers still need a keyboard destination for scrolling and Escape.
    if (open && document.activeElement?.matches(':focus-visible')) {
      viewport.current?.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <ScrollContainer
      className="message-info"
      scrollRef={viewport}
      tabIndex={0}
      aria-label="Recorded token metrics"
      style={{ '--message-info-row-height': `${METRIC_ROW_HEIGHT_PX}px` } as CSSProperties}
    >
      {rows.length ? (
        <dl className="message-info-list">
          {rows.map((row) => (
            <div className="message-info-row" key={row.label}>
              <dt><Icon name={row.icon} />{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="message-info-empty">No usage data recorded.</p>}
    </ScrollContainer>
  )
}

/**
 * Reveals message-only copy and recorded metadata without changing feed geometry.
 */
export const MessageMetadata = memo(function MessageMetadata({
  role,
  text,
  timestamp,
  metrics
}: MessageMetadataProps) {
  const [infoOpen, setInfoOpen] = useState(false)
  const rows = role === 'leon' ? getMetricRows(metrics) : []
  const date = <ActivityTimestamp timestamp={timestamp} />

  return (
    <div
      className={clsx('message-metadata', `message-metadata-${role}`, {
        'message-metadata-open': infoOpen
      })}
      role="group"
      aria-label={role === 'owner' ? 'Owner message actions' : 'Answer actions'}
    >
      {role === 'owner' && date}
      <CopyButton text={text} label="Copy message" tooltipPosition="top" tone="muted" />
      {role === 'leon' && (
        <Dropdown
          open={infoOpen}
          onOpenChange={setInfoOpen}
          preferredPlacement="top"
          contentLabel="Turn info"
          className="message-info-dropdown"
          width={METRICS_WIDTH_PX}
          height={Math.max(1, rows.length) * METRIC_ROW_HEIGHT_PX + METRICS_CHROME_HEIGHT_PX}
          content={(_close, open) => <MessageInfo rows={rows} open={open} />}
        >
          {(open, contentId) => (
            <Tooltip message="Turn info" position="top" disabled={open} blurOnClick={false}>
              <Button
                iconName="information"
                tone="muted"
                ariaLabel="Turn info"
                ariaExpanded={open}
                ariaControls={open ? contentId : undefined}
                ariaHasPopup="dialog"
              />
            </Tooltip>
          )}
        </Dropdown>
      )}
      {role === 'leon' && date}
    </div>
  )
})
