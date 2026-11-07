import { Lexer, type Token, type Tokens } from 'marked'

function readTokens(tokens: Token[]): string {
  return tokens.map((token) => {
    if (token.type === 'list') {
      return (token.items as Tokens.ListItem[]).map((item) => readTokens(item.tokens)).join('\n')
    }
    if (token.type === 'table') {
      const table = token as Tokens.Table
      return [table.header, ...table.rows]
        .map((row) => row.map((cell) => readTokens(cell.tokens)).join(', ')).join('\n')
    }
    if (token.type === 'space' || token.type === 'br' || token.type === 'hr') {
      return '\n'
    }
    if ('tokens' in token && Array.isArray(token.tokens)) {
      const text = readTokens(token.tokens as Token[])
      return token.type === 'paragraph' || token.type === 'heading' || token.type === 'blockquote'
        ? `${text}\n` : text
    }

    return 'text' in token ? String(token.text) : ''
  }).join('')
}

/**
 * Preserves readable prose and link labels for speech, without reading Markdown
 * markers or hidden link destinations. HTML cleanup remains owned by the caller.
 */
export function markdownToText(markdown: string): string {
  return readTokens(Lexer.lex(markdown)).trim()
}
