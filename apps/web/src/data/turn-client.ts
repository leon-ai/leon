import { DESKTOP_META_NAME } from '../../../../bridges/runtime/contracts/desktop-client'
import {
  TURN_CLIENT_OS_HEADER,
  TURN_CLIENT_TYPE_HEADER,
  TurnClientOS,
  TurnClientType
} from '../../../../bridges/runtime/contracts/turn-client'

const OS_MARKERS: ReadonlyArray<readonly [TurnClientOS, RegExp]> = [
  [TurnClientOS.IOS, /\b(?:ios|iphone|ipad|ipod)\b/i],
  [TurnClientOS.Android, /\bandroid\b/i],
  [TurnClientOS.ChromeOS, /\b(?:chrome os|cros)\b/i],
  [TurnClientOS.Windows, /\bwindows\b/i],
  [TurnClientOS.MacOS, /\b(?:macos|mac os|macintosh)\b/i],
  [TurnClientOS.Linux, /\blinux\b/i]
]

function platformOS(client: Navigator): TurnClientOS {
  const { userAgentData } = client as Navigator & { userAgentData?: { platform?: string } }
  const platform = userAgentData?.platform ?? ''
  const os = OS_MARKERS.find(([, marker]) => marker.test(platform))?.[0] ??
    OS_MARKERS.find(([, marker]) => marker.test(client.userAgent))?.[0] ?? TurnClientOS.Unknown

  // Safari on an iPad can present a Mac user agent when requesting desktop sites.
  return os === TurnClientOS.MacOS && client.maxTouchPoints > 1 ? TurnClientOS.IOS : os
}

/**
 * Labels an owner command at its origin, using the desktop host marker and an OS family.
 */
export function turnClientHeaders(): Record<string, string> {
  const desktop = Boolean(document.querySelector(`meta[name="${DESKTOP_META_NAME}"]`))

  return {
    [TURN_CLIENT_TYPE_HEADER]: desktop ? TurnClientType.Desktop : TurnClientType.Web,
    [TURN_CLIENT_OS_HEADER]: platformOS(navigator)
  }
}
