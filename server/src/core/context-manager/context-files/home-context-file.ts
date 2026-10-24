import path from 'node:path'

import {
  BIN_PATH,
  CODEBASE_PATH,
  GLOBAL_DATA_PATH,
  LEON_HOME_PATH,
  LEON_TOOLKITS_PATH,
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
    const toolAssetsPath = path.join(LEON_TOOLKITS_PATH, '<toolkit>', 'assets')
    const toolManifestPath = path.join(TOOLS_PATH, '<toolkit>', '<tool>', 'tool.json')

    return [
      `> My home: ${LEON_HOME_PATH} (${path.relative(LEON_HOME_PATH, BIN_PATH)}: managed runtimes; ${path.relative(LEON_HOME_PATH, toolAssetsPath)}: tool binaries/assets). My active profile: ${profilePaths.root} (context, memory, sessions, logs, tools and skills). My codebase: ${codebasePath} (${path.relative(codebasePath, toolManifestPath)}: built-in tool manifests); task-relative files use the local working directory.`,
      '# HOME',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Default local working directory: ${workspacePath}`,
      '## My Home',
      `- Home path: ${LEON_HOME_PATH}`,
      `- Managed runtimes path: ${BIN_PATH}`,
      `- Managed tool binaries and assets: ${toolAssetsPath}`,
      `- Models path: ${MODELS_PATH}`,
      `- Temp path: ${TMP_PATH}`,
      '## My Active Profile',
      `- Profile name: ${profilePaths.name}`,
      `- Profile path: ${profilePaths.root}`,
      `- Context path: ${profilePaths.context}`,
      `- Memory path: ${profilePaths.memory}`,
      `- Sessions path: ${profilePaths.sessions}`,
      `- Logs path: ${profilePaths.logs}`,
      `- Profile tools path: ${profilePaths.tools}`,
      `- Profile skills path: ${profilePaths.skills}`,
      '## My Codebase',
      `- Codebase path: ${codebasePath}`,
      `- Built-in skills path: ${SKILLS_PATH}`,
      `- Built-in tools path: ${TOOLS_PATH}`,
      `- Built-in tool manifests: ${toolManifestPath}`,
      `- Global data path: ${GLOBAL_DATA_PATH}`,
      `- Server source path: ${serverSourcePath}`,
      `- Server core runtime path: ${SERVER_CORE_PATH}`
    ].join('\n')
  }
}
