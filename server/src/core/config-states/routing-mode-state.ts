import { LEON_ROUTING_MODE } from '@/constants'
import { ProfileHelper } from '@/helpers/profile-helper'
import { RoutingMode } from '@/types'

const DEFAULT_ROUTING_MODE = RoutingMode.Smart
const ROUTING_MODE_ENV_KEY = 'LEON_ROUTING_MODE'
const SUPPORTED_ROUTING_MODES = Object.values(RoutingMode)

export function normalizeRoutingMode(
  routingMode: string | null | undefined
): RoutingMode | null {
  const normalizedRoutingMode = String(routingMode || '').trim().toLowerCase()

  return SUPPORTED_ROUTING_MODES.includes(normalizedRoutingMode as RoutingMode)
    ? (normalizedRoutingMode as RoutingMode)
    : null
}

export class RoutingModeState {
  private routingMode: RoutingMode =
    normalizeRoutingMode(LEON_ROUTING_MODE) || DEFAULT_ROUTING_MODE

  public getRoutingMode(): RoutingMode {
    return this.routingMode
  }

  public getSupportedRoutingModes(): RoutingMode[] {
    return [...SUPPORTED_ROUTING_MODES]
  }

  public async setRoutingMode(routingMode: string): Promise<RoutingMode> {
    const normalizedRoutingMode = normalizeRoutingMode(routingMode)

    if (!normalizedRoutingMode) {
      throw new Error(`Unsupported routing mode "${routingMode}".`)
    }

    this.routingMode = normalizedRoutingMode
    process.env[ROUTING_MODE_ENV_KEY] = normalizedRoutingMode

    await ProfileHelper.updateDotEnvVariable(
      ROUTING_MODE_ENV_KEY,
      normalizedRoutingMode
    )

    return normalizedRoutingMode
  }
}
