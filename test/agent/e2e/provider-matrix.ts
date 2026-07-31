/**
 * Keep the provider matrix in one place so the Vitest spec and subprocess
 * runner stay in sync.
 */
export const PROVIDER_MATRIX = [
  {
    provider: 'llamacpp',
    requiredEnv: 'LEON_LLAMACPP_BASE_URL',
    llmTarget: 'llamacpp',
    // The concrete local model is discovered at runtime, so its capabilities
    // cannot be selected from the curated remote-model catalog here.
    reasoning: null
  },
  {
    provider: 'openrouter',
    requiredEnv: 'LEON_OPENROUTER_API_KEY',
    llmTarget: 'openrouter/qwen/qwen3.6-flash',
    reasoning: 'none'
  },
  {
    provider: 'openai',
    requiredEnv: 'LEON_OPENAI_API_KEY',
    llmTarget: 'openai/gpt-5.6-terra',
    reasoning: 'low'
  },
  {
    provider: 'anthropic',
    requiredEnv: 'LEON_ANTHROPIC_API_KEY',
    llmTarget: 'anthropic/claude-haiku-4-5',
    reasoning: 'none'
  },
  {
    provider: 'moonshotai',
    requiredEnv: 'LEON_MOONSHOTAI_API_KEY',
    llmTarget: 'moonshotai/kimi-k2.6',
    reasoning: 'none'
  },
  {
    provider: 'zai',
    requiredEnv: 'LEON_ZAI_API_KEY',
    llmTarget: 'zai/glm-5-turbo',
    reasoning: 'none'
  },
  {
    provider: 'minimax',
    requiredEnv: 'LEON_MINIMAX_API_KEY',
    llmTarget: 'minimax/MiniMax-M3',
    reasoning: 'none'
  }
] as const

export type AgentProvider = (typeof PROVIDER_MATRIX)[number]['provider']

export const PROVIDER_REQUIRED_ENV = Object.fromEntries(
  PROVIDER_MATRIX.map(({ provider, requiredEnv }) => [provider, requiredEnv])
) as Record<AgentProvider, string>
