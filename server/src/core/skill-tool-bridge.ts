export const SKILL_TOOL_REQUEST_PREFIX = '[LEON_SKILL_TOOL_REQUEST]'
export const SKILL_TOOL_RESULT_PREFIX = '[LEON_SKILL_TOOL_RESULT]'
export const SKILL_TOOL_REQUEST_TIMEOUT_MS = 15 * 60 * 1_000

export interface SkillToolExecutionInput {
  toolId: string
  toolkitId?: string
  functionName: string
  toolInput?: string
  parsedInput?: Record<string, unknown>
  executionTarget?: 'any' | 'link'
}

export interface SkillToolExecutionResult<
  TOutput extends Record<string, unknown> = Record<string, unknown>
> {
  status: 'success' | 'error' | 'not_available' | 'invalid_input'
  message: string
  data: {
    tool_id: string
    toolkit_id: string | null
    function_name: string | null
    input: string | null
    parsed_input: Record<string, unknown> | null
    output: TOutput
  }
  toolLabel?: string | undefined
}

export interface SkillToolRequest {
  requestId: string
  input: SkillToolExecutionInput
}

export interface SkillToolResponse {
  requestId: string
  result: SkillToolExecutionResult
}

/** Parse one prefixed JSON bridge message without treating it as skill output. */
export function parseSkillToolBridgeMessage<T>(
  line: string,
  prefix: string
): T | null {
  if (!line.startsWith(prefix)) {
    return null
  }

  try {
    return JSON.parse(line.slice(prefix.length).trim()) as T
  } catch {
    return null
  }
}
