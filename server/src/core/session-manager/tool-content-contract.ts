export const TOOL_CONTENT_PREVIEW_CHARACTERS = 16_384

export interface ToolContentPart {
  text: string
  totalCharacters: number
  truncated: boolean
  language: string
}

export interface ToolCallContents {
  input: ToolContentPart
  output: ToolContentPart
  commandOutput?: ToolContentPart
  displayOutput?: ToolContentPart
  hasChanges: boolean
  diffTruncated: boolean
}
