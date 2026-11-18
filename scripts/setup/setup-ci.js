const CI_RUNTIME_VARIABLES = [
  'LEON_NODE_PATH',
  'LEON_PNPM_PATH',
  'LEON_PYTHON_PATH',
  'LEON_UV_PATH'
]

/**
 * Reuse explicitly supplied verification runtimes on any CI provider. Jobs
 * without the complete set still exercise managed runtime and TCP setup.
 */
export function shouldUseCIRuntimes(environment = process.env) {
  return environment.CI === 'true' && CI_RUNTIME_VARIABLES.every((key) =>
    Boolean(environment[key]?.trim())
  )
}

/**
 * Cold installations must provision runtimes even when their parent job
 * supplies verification overrides. Keep the CI marker for noninteractive work.
 */
export function getFullInstallEnvironment(environment = process.env) {
  const result = { ...environment }

  for (const key of CI_RUNTIME_VARIABLES) {
    delete result[key]
  }

  return result
}
