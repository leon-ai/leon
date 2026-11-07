import { Marked } from 'marked'

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHTML(text),
    image: ({ text }) => escapeHTML(text),
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens)
      let url
      try {
        url = new URL(href)
      } catch {
        return text
      }

      if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) {
        return text
      }

      return `<a href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer" class="clickable-url">${text}</a>`
    }
  }
})

/**
 * Keeps the legacy client readable when the shared agent emits Markdown, without
 * allowing model-authored HTML or automatic external image requests.
 */
export function formatMarkdown(message) {
  return markdown.parse(message)
}
