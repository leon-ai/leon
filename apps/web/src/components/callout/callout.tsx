import { Callout as AuroraCallout, type CalloutProps as AuroraCalloutProps } from '../../../../../aurora/src/v2/components/callout/callout'
import { Icon } from '@/components/icon'

export type { CalloutVariant } from '../../../../../aurora/src/v2/components/callout/callout'
export type CalloutProps = Omit<AuroraCalloutProps, 'icon'>

const CALLOUT_ICONS = {
  info: 'lightbulb-line',
  warning: 'error-warning-line',
  danger: 'hand-line'
} as const

/**
 * Pairs each guidance variant with its local interface icon.
 */
export function Callout({ variant = 'info', ...props }: CalloutProps) {
  return <AuroraCallout {...props} variant={variant} icon={<Icon name={CALLOUT_ICONS[variant]} />} />
}
