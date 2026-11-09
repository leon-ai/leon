import type { ConnectionSetupDescriptor } from '../../../../aurora/src/contracts/connection-setup'
import type { ConversationRecord } from './conversation'

const MAXIMUM_PROVIDER_LENGTH = 256

/**
 * Accepts only the known server connection envelope and its persisted legacy
 * shape, without enabling arbitrary components or trusting a supplied session.
 */
export function getConnectionSetupDescriptor(widget: ConversationRecord['widget']): ConnectionSetupDescriptor | undefined {
  if (widget?.widget !== 'ConnectionWidget') {
    return undefined
  }

  const props = widget.componentTree?.['props'] as { children?: unknown } | undefined
  const children = Array.isArray(props?.children) ? props.children : []
  const setup = children.find((item) => item && typeof item === 'object' && item.component === 'ConnectionSetup')
  const provider: unknown = widget.connection?.provider ?? setup?.props?.provider
  if (typeof provider !== 'string' || !provider || provider.length > MAXIMUM_PROVIDER_LENGTH) {
    return undefined
  }

  return { provider,
    ...(typeof widget.connection?.name === 'string' ? { name: widget.connection.name } : {}),
    ...(typeof widget.connection?.iconName === 'string' ? { iconName: widget.connection.iconName } : {}) }
}
