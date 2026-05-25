export const LEON_RESTART_EXIT_CODE = 77

type ShutdownHandler = (exitCode?: number) => void

let shutdownHandler: ShutdownHandler | null = null

export function setShutdownHandler(handler: ShutdownHandler): void {
  shutdownHandler = handler
}

export function requestShutdown(exitCode = 0): void {
  if (shutdownHandler) {
    shutdownHandler(exitCode)
    return
  }

  process.exit(exitCode)
}
