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
  }
] as const

export type ProviderScenario = (typeof PROVIDER_SCENARIOS)[number]
export type ProviderScenarioId = ProviderScenario['id']

/** Resolves a CLI scenario identifier to its shared E2E definition. */
export function getProviderScenario(
  scenarioId: string | undefined
): ProviderScenario | null {
  return PROVIDER_SCENARIOS.find((scenario) => scenario.id === scenarioId) || null
}
