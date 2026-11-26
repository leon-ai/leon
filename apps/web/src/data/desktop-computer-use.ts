import {
  DESKTOP_COMPUTER_USE_PATH,
  type DesktopComputerUseApproval,
  type DesktopComputerUseSetup
} from '../../../../bridges/runtime/contracts/desktop-client'

/**
 * Reads the remote server address from the local Desktop host before sign-in.
 */
export async function getDesktopComputerUseSetup(signal: AbortSignal): Promise<DesktopComputerUseSetup | null> {
  const response = await fetch(DESKTOP_COMPUTER_USE_PATH, { signal })

  return response.ok ? await response.json() as DesktopComputerUseSetup | null : null
}

/**
 * Requests native enrollment only from a deliberate setup or chat action.
 */
export async function enableDesktopComputerUse(approval: DesktopComputerUseApproval): Promise<boolean> {
  const response = await fetch(DESKTOP_COMPUTER_USE_PATH, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval })
  })
  const result = await response.json().catch(() => null) as { enabled?: boolean, message?: string } | null
  if (!response.ok || typeof result?.enabled !== 'boolean') {
    throw new Error(result?.message || 'I could not enable computer use.')
  }

  return result.enabled
}
