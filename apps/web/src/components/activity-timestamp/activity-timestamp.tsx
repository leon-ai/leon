import { Tooltip } from '@/components/tooltip'
import { formatMetricTimestamp, formatFullMetricTimestamp } from '@/utils/format-date'

import './activity-timestamp.sass'

/**
 * Shows recorded start times without making activity text a tooltip trigger or
 * changing its selection. Missing historical timestamps remain undisplayed.
 */
export function ActivityTimestamp({ timestamp }: { timestamp: number | undefined }) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return null
  }
  const label = formatMetricTimestamp(timestamp)
  if (!label) {
    return null
  }

  return (
    <Tooltip
      className="activity-timestamp"
      blurOnClick={false}
      message={() => formatFullMetricTimestamp(timestamp)}
      position="top"
    >
      <time className="activity-metadata" dateTime={new Date(timestamp).toISOString()} tabIndex={0}>
        {label}
      </time>
    </Tooltip>
  )
}
