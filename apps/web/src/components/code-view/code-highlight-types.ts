export const MAXIMUM_CODE_LINE_CHARACTERS = 2_048
export const CODE_PREVIEW_LINES = 16

export interface CodeToken {
  content: string
  color?: string
}

export interface HighlightRequest {
  id: string
  revision: number
  text?: string
  language?: string
}

export interface HighlightResponse {
  id: string
  revision: number
  lines: CodeToken[][] | null
}
