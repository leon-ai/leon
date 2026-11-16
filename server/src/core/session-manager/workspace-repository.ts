import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

import type { Workspace, WorkspaceInput, WorkspaceSummary } from '@@/bridges/runtime/contracts/workspace'

/**
 * Stores one profile's project context without owning conversation execution.
 */
export class WorkspaceRepository {
  public constructor(private readonly db: Database) {}

  /**
   * Reads bounded workspace metadata independently of paginated session history.
   */
  public list(): WorkspaceSummary[] {
    return this.db.prepare(`SELECT w.payload,
      count(s.id) AS session_count, max(s.activity_at) AS activity,
      coalesce(max(s.pinned), 0) AS child_pinned
      FROM workspaces w LEFT JOIN conversation_sessions s
        ON json_extract(s.payload, '$.workspaceId') = w.id
      GROUP BY w.id ORDER BY coalesce(max(s.activity_at), json_extract(w.payload, '$.createdAt')) DESC, w.id DESC`)
      .all().map((row) => {
        const workspace = JSON.parse(String(row['payload'])) as Workspace

        return { ...workspace, isExplicitlyPinned: workspace.isPinned === true,
          isPinned: workspace.isPinned === true || Boolean(row['child_pinned']), sessionCount: Number(row['session_count']),
          lastActivityAt: Number(row['activity'] ?? workspace.createdAt) }
      })
  }

  /**
   * Resolves the authoritative brief and resources for one project identity.
   */
  public get(id: string): Workspace | null {
    const row = this.db.prepare('SELECT payload FROM workspaces WHERE id = ?').get(id)

    return row ? JSON.parse(String(row['payload'])) as Workspace : null
  }

  /**
   * Creates durable context with a theme-aware neutral identity by default.
   */
  public create(input: WorkspaceInput): Workspace {
    const now = Date.now()
    const workspace: Workspace = {
      ...input, name: input.name.trim(), id: randomUUID(),
      color: input.color ?? 'default',
      createdAt: now, updatedAt: now
    }
    this.db.prepare('INSERT INTO workspaces(id, payload) VALUES (?, ?)')
      .run(workspace.id, JSON.stringify(workspace))

    return workspace
  }

  /**
   * Replaces editable context while retaining identity and creation time.
   */
  public update(id: string, input: WorkspaceInput): Workspace {
    const current = this.get(id)
    if (!current) {
      throw new Error('Workspace not found.')
    }

    const workspace = { ...current, ...input, name: input.name.trim(),
      color: input.color ?? current.color, updatedAt: Date.now() }
    this.db.prepare('UPDATE workspaces SET payload = ? WHERE id = ?')
      .run(JSON.stringify(workspace), id)

    return workspace
  }

  /**
   * Pins the workspace independently of pins inherited from its conversations.
   */
  public setPinned(id: string, isPinned: boolean): Workspace {
    const current = this.get(id)
    if (!current) {
      throw new Error('Workspace not found.')
    }
    const workspace = { ...current, isPinned, updatedAt: Date.now() }
    this.db.prepare('UPDATE workspaces SET payload = ? WHERE id = ?')
      .run(JSON.stringify(workspace), id)

    return workspace
  }

  /**
   * Detaches conversations and removes the registration in one transaction.
   * External folders and conversation history remain independently owned.
   */
  public remove(id: string): string[] {
    return this.db.transaction(() => {
      const sessions = this.db.prepare(`SELECT id FROM conversation_sessions
        WHERE json_extract(payload, '$.workspaceId') = ?`).all(id)
      this.db.prepare(`UPDATE conversation_sessions SET payload = json_remove(payload, '$.workspaceId')
        WHERE json_extract(payload, '$.workspaceId') = ?`).run(id)
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)

      return sessions.map((session) => String(session['id']))
    })()
  }
}
