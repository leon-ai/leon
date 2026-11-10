// Interface glyphs inherit the text color. Catalog logos belong to their packages
// and must not replace these monochrome icons in tool activities.
export const ASSET_ICONS: Readonly<Record<string, { path: string, service?: boolean }>> = {
  discord: { path: 'img/icons/discord.svg', service: true },
  github: { path: 'img/icons/github.svg', service: true },
  'grok-ai': { path: 'img/icons/grok-ai.svg', service: true },
  'qwen-ai': { path: 'img/icons/qwen-ai.svg', service: true },
  openai: { path: 'img/icons/openai.svg', service: true },
  spotify: { path: 'img/icons/spotify.svg', service: true },
  youtube: { path: 'img/icons/youtube.svg', service: true },
  notion: { path: 'img/icons/notion.svg', service: true },
  'github-note': { path: 'img/alerts/note.svg' },
  'github-tip': { path: 'img/alerts/tip.svg' },
  'github-important': { path: 'img/alerts/important.svg' },
  'github-warning': { path: 'img/alerts/warning.svg' },
  'github-caution': { path: 'img/alerts/caution.svg' }
}
