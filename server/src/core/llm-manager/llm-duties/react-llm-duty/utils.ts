export const formatFilePath = (filePath: string): string => {
  return `[FILE_PATH]${filePath}[/FILE_PATH]`
}

export function parseToolCallArguments(
  rawArguments: string
): Record<string, unknown> | null {
  if (!rawArguments || typeof rawArguments !== 'string') {
    return null
  }

  const trimmed = rawArguments.trim()
  if (!trimmed) {
    return null
  }

  const candidates: string[] = [trimmed]
  const strippedCodeFence = trimmed
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()

  if (strippedCodeFence && strippedCodeFence !== trimmed) {
    candidates.push(strippedCodeFence)
  }

  const extracted = extractJsonSubstring(strippedCodeFence)
  if (extracted && !candidates.includes(extracted)) {
    candidates.push(extracted)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Continue with next candidate
    }
  }

  return null
}

export function extractJsonSubstring(input: string): string | null {
  const firstBrace = input.indexOf('{')
  const firstBracket = input.indexOf('[')
  let startIndex = -1
  let endIndex = -1

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIndex = Math.min(firstBrace, firstBracket)
  } else {
    startIndex = Math.max(firstBrace, firstBracket)
  }

  if (startIndex === -1) {
    return null
  }

  if (input[startIndex] === '{') {
    endIndex = input.lastIndexOf('}')
  } else {
    endIndex = input.lastIndexOf(']')
  }

  if (endIndex <= startIndex) {
    return null
  }

  return input.slice(startIndex, endIndex + 1)
}

export function extractFinalAnswerFromToolResult(toolExecutionResult: {
  status: string
  data?: {
    output?: Record<string, unknown>
  }
}): string | null {
  if (toolExecutionResult.status !== 'success') {
    return null
  }

  const output = toolExecutionResult.data?.output || {}
  const nestedResult = output['result']
  const candidates = [
    output,
    nestedResult && typeof nestedResult === 'object' && !Array.isArray(nestedResult)
      ? nestedResult as Record<string, unknown>
      : null
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    for (const key of ['final_answer', 'answer']) {
      const answer = candidate[key]
      if (typeof answer === 'string' && answer.trim()) {
        return answer
      }
    }
  }

  return null
}

export function validateToolInput(
  toolInput: string,
  parameters: Record<string, unknown> | null
): {
  isValid: boolean
  message?: string
  repairedToolInput?: string
  parsedValue?: Record<string, unknown>
} {
  if (!parameters) {
    return {
      isValid: false,
      message: 'No parameters schema found for this function.'
    }
  }

  let parsed: unknown = null
  let parsedFromRepair: { repaired: string, value: unknown } | null = null
  try {
    parsed = JSON.parse(toolInput)
  } catch {
    parsedFromRepair = tryRepairToolInput(toolInput)
    if (!parsedFromRepair) {
      return {
        isValid: false,
        message: 'tool_input must be valid JSON.'
      }
    }
    parsed = parsedFromRepair.value
  }

  const validateSchema = (
    schema: Record<string, unknown>,
    value: unknown
  ): boolean => {
    if (schema['oneOf'] && Array.isArray(schema['oneOf'])) {
      return schema['oneOf'].some((candidate) => {
        if (candidate && typeof candidate === 'object') {
          return validateSchema(candidate as Record<string, unknown>, value)
        }
        return false
      })
    }

    const schemaType = schema['type']
    if (schemaType === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false
      }

      const required = Array.isArray(schema['required'])
        ? (schema['required'] as string[])
        : []
      for (const key of required) {
        if (!(key in (value as Record<string, unknown>))) {
          return false
        }
      }

      const properties = schema['properties']
      if (properties && typeof properties === 'object') {
        for (const [key, propSchema] of Object.entries(properties)) {
          if (
            key in (value as Record<string, unknown>) &&
            propSchema &&
            typeof propSchema === 'object'
          ) {
            const propValue = (value as Record<string, unknown>)[key]
            if (
              !validateSchema(
                propSchema as Record<string, unknown>,
                propValue
              )
            ) {
              return false
            }
          }
        }
      }

      return true
    }

    if (schemaType === 'array') {
      if (!Array.isArray(value)) {
        return false
      }
      const items = schema['items']
      if (items && typeof items === 'object') {
        return value.every((item) =>
          validateSchema(items as Record<string, unknown>, item)
        )
      }
      return true
    }

    if (schemaType === 'string') {
      return typeof value === 'string'
    }
    if (schemaType === 'number') {
      return typeof value === 'number' && Number.isFinite(value)
    }
    if (schemaType === 'boolean') {
      return typeof value === 'boolean'
    }

    return true
  }

  const isValid = validateSchema(parameters, parsed)
  if (!isValid) {
    return {
      isValid: false,
      message: 'tool_input does not match the function parameters schema.'
    }
  }

  const result: {
    isValid: boolean
    repairedToolInput?: string
    parsedValue?: Record<string, unknown>
  } = {
    isValid: true
  }
  if (parsedFromRepair?.repaired) {
    result.repairedToolInput = parsedFromRepair.repaired
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    result.parsedValue = parsed as Record<string, unknown>
  }
  return result
}

export function tryRepairToolInput(
  toolInput: string
): { repaired: string, value: unknown } | null {
  const repaired = repairJsonStringLiterals(toolInput)
  if (repaired === toolInput) {
    return null
  }

  try {
    const value = JSON.parse(repaired)
    return { repaired, value }
  } catch {
    return null
  }
}

export function repairJsonStringLiterals(input: string): string {
  let inString = false
  let escaped = false
  let result = ''

  const isValidEscape = (char: string): boolean => {
    return (
      char === '"' ||
      char === '\\' ||
      char === '/' ||
      char === 'b' ||
      char === 'f' ||
      char === 'n' ||
      char === 'r' ||
      char === 't' ||
      char === 'u'
    )
  }

  const nextNonSpace = (value: string, start: number): string => {
    for (let i = start; i < value.length; i += 1) {
      const char = value[i]
      if (char && !/\s/.test(char)) {
        return char
      }
    }
    return ''
  }

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (!inString) {
      if (char === '"') {
        inString = true
      }
      result += char
      continue
    }

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === '\\') {
      const nextChar = input[i + 1]
      if (nextChar && isValidEscape(nextChar)) {
        result += char
        escaped = true
        continue
      }
      result += '\\\\'
      continue
    }

    if (char === '"') {
      const nextChar = nextNonSpace(input, i + 1)
      const isTerminator =
        nextChar === '' ||
        nextChar === ',' ||
        nextChar === '}' ||
        nextChar === ']' ||
        nextChar === ':'
      if (isTerminator) {
        inString = false
        result += char
        continue
      }
      result += '\\"'
      continue
    }

    result += char
  }

  return result
}
