import { UPDATE_CHANGELOG_SECTIONS, type UpdateSnapshot } from '../../bridges/runtime/contracts/updates'

const highlights = `Keep your projects close, with shared context and a calmer place to pick up your work.

### A shared home for each project

Group related sessions with a **brief and folders**, so I can help with the right context.

### Small details, smoother conversations

Folder browsing and familiar controls make it easier to stay focused.
`
const changelog = {
  new: '- Create workspaces with a shared brief and up to three folders.',
  improvements: '- Browse folders with clear navigation and responsive feedback.',
  fixes: '- Keep dialogs usable on smaller screens.',
  removed: '- Remove the old Docs sidebar link.'
}

export const UPDATE_FIXTURE: UpdateSnapshot = {
  check: {
    currentVersion: '1.0.0-beta.10+dev', channel: 'development', canInstall: true, reason: null,
    release: {
      tag: 'v1.0.0-beta.11', version: '1.0.0-beta.11', title: 'A little more room for your projects',
      publishedAt: '2026-11-17T04:00:00Z', url: 'https://github.com/leon-ai/leon/releases/tag/v1.0.0-beta.11',
      highlights, changelog,
      markdown: `${highlights}\n## Full changelog\n\n${UPDATE_CHANGELOG_SECTIONS.map((scope) => `### ${scope.label}\n\n${changelog[scope.id]}\n`).join('\n')}`
    }
  },
  state: null
}

const release = UPDATE_FIXTURE.check!.release!

export const PUBLISHED_UPDATE_FIXTURE = {
  tag_name: release.tag, name: release.title, published_at: release.publishedAt, body: release.markdown,
  html_url: release.url, draft: false, prerelease: true
}
