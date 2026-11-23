export const TURN_CLIENT_TYPE_HEADER = 'x-leon-client-type'
export const TURN_CLIENT_OS_HEADER = 'x-leon-client-os'

export enum TurnClientType {
  Web = 'web',
  Desktop = 'desktop',
  Mobile = 'mobile',
  Other = 'other',
  Unknown = 'unknown'
}

export enum TurnClientOS {
  Windows = 'windows',
  MacOS = 'macos',
  Linux = 'linux',
  IOS = 'ios',
  Android = 'android',
  ChromeOS = 'chromeos',
  Other = 'other',
  Unknown = 'unknown'
}

export interface TurnClient {
  type: TurnClientType
  os: TurnClientOS
}
