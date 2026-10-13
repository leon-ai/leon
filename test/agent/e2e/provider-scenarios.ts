export const PROVIDER_SCENARIOS = [
  {
    id: 'direct_answer',
    testName: 'answers a direct request without tools',
    buildInput: (): string =>
      'Hi Leon, just doing a quick check since I switched your LLM provider. What do you reply if I tell you "ping"?'
  },
  {
    id: 'weather',
    testName: 'retrieves weather with the weather tool',
    buildInput: (): string => 'What\'s the weather like today in Shenzhen?'
  },
  {
    id: 'file_instructions',
    testName: 'reads and follows file instructions',
    buildInput: (assetPath: string): string =>
      `There is a file waiting for you in ${assetPath}, do what it asks you to do.`
  },
  {
    id: 'coding_bug',
    testName: 'fixes a coding bug and verifies the repository',
    buildInput: (root: string): string =>
      `Fix the addition bug in ${root} directly using Leon's tools. Reproduce the failing test, fix the implementation, run the project test and review the diff. Follow repository instructions and preserve existing owner changes.`
  },
  {
    id: 'coding_multiple_files',
    testName: 'fixes multiple coding files while respecting instructions and owner changes',
    buildInput: (root: string): string =>
      `Fix the receipt in ${root} directly using Leon's tools: a 10% discount on [100, 200] must produce "Total: 270.00". Reproduce the failing test, fix the source functions, run the project test and review the diff. Follow applicable repository instructions and preserve existing owner changes.`
  },
  {
    id: 'coding_session',
    testName: 'fixes coding behavior while managing an interactive shell session',
    buildInput: (root: string): string =>
      `Fix the greeting in ${root} directly using Leon's tools. Reproduce the failing project test. Before editing, start pnpm run dev with shell.startSession, read SESSION_READY, and send Ada followed by a newline. Fix the source so that the greeting is "Hello, Ada!". Send Ada again and verify the corrected output in the same running session, run the project test and review the diff. Stop the session before finishing. Follow repository instructions and preserve existing owner changes.`
  }
] as const

export type ProviderScenario = (typeof PROVIDER_SCENARIOS)[number]
export type ProviderScenarioId = ProviderScenario['id']

/**
 * Resolves a CLI scenario identifier to its shared E2E definition.
 */
export function getProviderScenario(
  scenarioId: string | undefined
): ProviderScenario | null {
  return PROVIDER_SCENARIOS.find((scenario) => scenario.id === scenarioId) || null
}
