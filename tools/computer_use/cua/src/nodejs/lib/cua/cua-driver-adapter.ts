import type {
  CuaExecutionContext as ToolExecutionContext,
  ComputerUseDriver
} from '../types'

import { CuaDesktopSetup, CuaDesktopSetupPendingError, CuaDesktopSetupState, isCuaWaylandSession } from './cua-desktop-setup'
import { CuaWaylandCaptureAdapter } from './cua-wayland-capture'

import {
  CUA_TELEMETRY_ENABLED_ENV,
  CUA_X11_UINPUT_SAFETY_ENV
} from '../constants'
import { shouldUseCuaSafeX11Input } from '../computer-use-coordinate-mapper'

const CUA_MAX_SESSION_TTL_SECONDS = 28_800n
const CUA_MAX_IDLE_TTL_SECONDS = 1_800n

/**
 * Creates the configured Cua adapter without exposing it to the provider.
 */
export async function createCuaDriverAdapter(
  input: ToolExecutionContext,
  desktopSetup = new CuaDesktopSetup()
): Promise<ComputerUseDriver> {
  if (await desktopSetup.ensure(input.onProgress) === CuaDesktopSetupState.ActivationPending) {
    throw new CuaDesktopSetupPendingError()
  }
  process.env[CUA_TELEMETRY_ENABLED_ENV] ??= 'false'
  if (shouldUseCuaSafeX11Input(process.platform, process.env)) {
    // Cua currently keys its MPX/uinput crash guard to KDE; apply its XTEST
    // fallback to every local X11 session because the X server is shared.
    process.env[CUA_X11_UINPUT_SAFETY_ENV] = 'true'
  }
  const { CuaDriver, SessionPermissionMode } = await import('@trycua/cua-driver')
  const options = {
    claudeCodeCompatibility: false,
    authorization: {
      allowedModes: [SessionPermissionMode.Standard],
      compatibilityMode: SessionPermissionMode.Standard,
      unrestrictedAcknowledged: false,
      maxSessionTtlSeconds: CUA_MAX_SESSION_TTL_SECONDS,
      maxIdleTtlSeconds: CUA_MAX_IDLE_TTL_SECONDS
    }
  }
  const driver = CuaDriver.createConfigured(options) as unknown as ComputerUseDriver
  const gnomeWayland = isCuaWaylandSession(process.platform, process.env) &&
    process.env['XDG_CURRENT_DESKTOP']?.toLowerCase().split(':').includes('gnome') &&
    process.env['CUA_DRIVER_RS_ENABLE_WAYLAND'] === '1'
  return gnomeWayland ? new CuaWaylandCaptureAdapter(driver) : driver
}
