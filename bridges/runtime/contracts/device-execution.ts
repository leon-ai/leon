export enum ToolExecutionTarget {
  Core = 'core',
  Device = 'device'
}

export const DEVICE_CREDENTIAL_HEADER = 'x-leon-device-credential'
export const DEVICE_SELECTION_HEADER = 'x-leon-device-id'
export const CORE_DEVICE_SELECTION = '$core'
export const COMPUTER_USE_TOOLKIT_ID = 'computer_use'
export const COMPUTER_USE_TOOL_ID = 'cua'
export const COMPUTER_USE_DEVICE_TOOL = `${COMPUTER_USE_TOOLKIT_ID}.${COMPUTER_USE_TOOL_ID}`
export const DESKTOP_SATELLITE_ENV = 'LEON_DESKTOP_SATELLITE'
export const DESKTOP_SATELLITE_READY = 'leon:desktop-satellite:ready'
export const DESKTOP_SATELLITE_REJECTED = 'leon:desktop-satellite:rejected'

export interface DeviceGrant {
  id: string
  profile: string
  credential: string
  tools: string[]
}
