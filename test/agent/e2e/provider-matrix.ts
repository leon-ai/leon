/**
 * Keep the provider matrix in one place so the Vitest spec and subprocess
 * runner stay in sync.
 */
export const PROVIDER_MATRIX = [
  {
    provider: 'llamacpp',
    requiredEnv: 'LEON_LLAMACPP_BASE_URL',
    llmTarget: 'llamacpp'
  },
  {
    provider: 'openrouter',
    requiredEnv: 'LEON_OPENROUTER_API_KEY',
    llmTarget: 'openrouter/z-ai/glm-5-turbo'
  },
  {
    provider: 'openai',
    requiredEnv: 'LEON_OPENAI_API_KEY',
    llmTarget: 'openai/gpt-5.6-terra'
  },
  {
    provider: 'anthropic',
    requiredEnv: 'LEON_ANTHROPIC_API_KEY',
    llmTarget: 'anthropic/claude-haiku-4-5'
  },
  {
    provider: 'moonshotai',
    requiredEnv: 'LEON_MOONSHOTAI_API_KEY',
    llmTarget: 'moonshotai/kimi-k2.5'
  },
  {
    provider: 'zai',
    requiredEnv: 'LEON_ZAI_API_KEY',
    llmTarget: 'zai/glm-5-turbo'
  },
  {
    provider: 'minimax',
    requiredEnv: 'LEON_MINIMAX_API_KEY',
    llmTarget: 'minimax/MiniMax-M3'
  }
] as const

export type AgentProvider = (typeof PROVIDER_MATRIX)[number]['provider']

export const PROVIDER_REQUIRED_ENV = Object.fromEntries(
  PROVIDER_MATRIX.map(({ provider, requiredEnv }) => [provider, requiredEnv])
) as Record<AgentProvider, string>
