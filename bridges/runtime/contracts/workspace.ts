/**
 * Profile-owned project context shared by the host and its clients.
 */
export enum WorkspaceResourceKind {
  Folder = 'folder',
  Link = 'link'
}

export const ACCENT_COLORS = [
  { id: 'blue', label: 'Leon blue' },
  { id: 'pink', label: 'Leonie pink' },
  { id: 'green', label: 'Green' },
  { id: 'violet', label: 'Violet' },
  { id: 'orange', label: 'Orange' },
  { id: 'rouge', label: 'Rouge' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'teal', label: 'Teal' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'rose', label: 'Rose' },
  { id: 'amber', label: 'Amber' },
  { id: 'lime', label: 'Lime' }
] as const

export const WORKSPACE_COLORS = [
  { id: 'default', label: 'Default' },
  ...ACCENT_COLORS.filter((color) => !['rouge', 'rose', 'amber', 'lime'].includes(color.id))
] as const

export type AccentColor = (typeof ACCENT_COLORS)[number]['id']
// Existing saved accents remain readable even when no longer offered as choices.
export type WorkspaceColor = AccentColor | 'default'

export const WORKSPACE_LIMITS = {
  name: 80,
  brief: 4_000,
  resources: 24,
  folders: 3,
  resourceLabel: 120,
  resourceLocation: 2_048
} as const

export interface WorkspaceResource {
  kind: WorkspaceResourceKind
  label: string
  location: string
  device?: string
}

export interface Workspace {
  id: string
  name: string
  brief: string
  resources: WorkspaceResource[]
  color: WorkspaceColor
  isPinned?: boolean
  createdAt: number
  updatedAt: number
}

export interface WorkspaceInput {
  name: string
  brief: string
  resources: WorkspaceResource[]
  color?: WorkspaceColor
}

export interface WorkspaceSummary extends Workspace {
  isExplicitlyPinned?: boolean
  sessionCount: number
  runningSessionCount?: number
  lastActivityAt: number
}
