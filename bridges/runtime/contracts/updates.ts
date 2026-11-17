import { UpdatePhase } from './update-status.js'

export { UpdatePhase, UpdateStage, LEON_UPDATE_EXIT_CODE } from './update-status.js'

export interface UpdateStep {
  id: string
  status: 'running' | 'completed' | 'failed'
  downloadedBytes: number | null
  totalBytes: number | null
  details: string[]
}

export const UPDATE_CHANGELOG_SECTIONS = [
  { id: 'new', label: 'New', headings: ['new', 'features', 'new features'] },
  { id: 'improvements', label: 'Improvements', headings: ['improvements', 'improved'] },
  { id: 'fixes', label: 'Fixes', headings: ['fixes', 'fixed', 'bug fixes'] },
  { id: 'removed', label: 'Removed', headings: ['removed'] }
] as const

export type ReleaseChangeScope = typeof UPDATE_CHANGELOG_SECTIONS[number]['id']

export interface UpdateRelease {
  tag: string
  version: string
  title: string
  publishedAt: string
  markdown: string
  highlights: string
  changelog: Record<ReleaseChangeScope, string>
  url: string
}

export interface UpdateState {
  id: string
  phase: typeof UpdatePhase[keyof typeof UpdatePhase]
  version: string
  error: string | null
  steps?: UpdateStep[]
  progress?: { phase: string, downloadedBytes: number | null, totalBytes: number | null } | null
}

export interface UpdateCheck {
  currentVersion: string
  channel: 'stable' | 'development'
  release: UpdateRelease | null
  canInstall: boolean
  reason: string | null
}

export interface UpdateSnapshot {
  check: UpdateCheck | null
  state: UpdateState | null
}

export interface DesktopUpdateSnapshot {
  supported: boolean
  currentVersion: string
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'failed'
  version: string | null
  releaseNotes: string
  progress: { downloadedBytes: number, totalBytes: number } | null
  error: string | null
  reason: string | null
}

export interface GitUpdateJob extends UpdateState {
  root: string
  expectedHead: string
  revision: string
  pnpm: string
  profile: string
}

export interface RuntimeUpdateJob extends UpdateState {
  kind: 'runtime'
  root: string
  installation: string
  expectedVersion: string
  profile: string
  asset: {
    name: string
    version: string
    platform: string
    bytes: number
    sha256: string
    url: string
  }
}

export type UpdateJob = GitUpdateJob | RuntimeUpdateJob
