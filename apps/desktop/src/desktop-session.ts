const LINUX_SESSION_VARIABLES = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'XAUTHORITY',
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'DESKTOP_SESSION',
  'XDG_DATA_HOME',
  'XDG_DATA_DIRS',
  'XDG_CONFIG_HOME',
  'XDG_CONFIG_DIRS'
] as const

/**
 * Passes the launching user's Linux graphical session to native workers.
 * Resolve these at launch since display sockets change across sign-ins.
 */
export function desktopSessionEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (process.platform !== 'linux') {
    return {}
  }

  return Object.fromEntries(LINUX_SESSION_VARIABLES.flatMap((name) => {
    const value = environment[name]

    return value ? [[name, value]] : []
  }))
}
