import path from 'node:path'

import {
  CODEBASE_PATH,
  GLOBAL_DATA_PATH,
  MODELS_PATH,
  SERVER_CORE_PATH,
  SKILLS_PATH,
  TMP_PATH,
  TOOLS_PATH
} from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'

export class HomeContextFile extends ContextFile {
  public readonly filename = 'HOME.md'
  public readonly ttlMs: number

  public constructor(ttlMs: number) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const codebasePath = CODEBASE_PATH
    const workspacePath = path.resolve(process.env['LEON_WORKSPACE_PATH'] || process.cwd())
    const profilePaths = getProfilePaths()
    const serverSourcePath = path.join(codebasePath, 'server', 'src')

    return [
      `> Codebase, profile and runtime directories. Leon codebase rooted at ${codebasePath}; task-relative files use the local working directory.`,
      '# HOME',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Codebase path: ${codebasePath}`,
      `- Default local working directory: ${workspacePath}`,
      `- Skills path: ${SKILLS_PATH}`,
      `- Tools path: ${TOOLS_PATH}`,
      `- Global data path: ${GLOBAL_DATA_PATH}`,
      `- Models path: ${MODELS_PATH}`,
      `- Context path: ${profilePaths.context}`,
      `- Server source path: ${serverSourcePath}`,
      `- Server core runtime path: ${SERVER_CORE_PATH}`,
      `- Logs path: ${profilePaths.logs}`,
      `- Temp path: ${TMP_PATH}`
    ].join('\n')
  }
}
