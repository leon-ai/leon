import path from 'node:path'

import {
  CODEBASE_PATH,
  GLOBAL_DATA_PATH,
  MODELS_PATH,
  PROFILE_CONTEXT_PATH,
  PROFILE_LOGS_PATH,
  SERVER_CORE_PATH,
  SKILLS_PATH,
  TMP_PATH,
  TOOLS_PATH
} from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { ContextFile } from '@/core/context-manager/context-file'

export class HomeContextFile extends ContextFile {
  public readonly filename = 'HOME.md'
  public readonly ttlMs: number

  public constructor(ttlMs: number) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const codebasePath = CODEBASE_PATH
    const serverSourcePath = path.join(codebasePath, 'server', 'src')

    return [
      `> Workspace paths and runtime directories. Leon workspace rooted at ${codebasePath}. Key folders for skills, toolkits, models, logs and runtime temp are available.`,
      '# HOME',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Codebase path: ${codebasePath}`,
      `- Skills path: ${SKILLS_PATH}`,
      `- Tools path: ${TOOLS_PATH}`,
      `- Global data path: ${GLOBAL_DATA_PATH}`,
      `- Models path: ${MODELS_PATH}`,
      `- Context path: ${PROFILE_CONTEXT_PATH}`,
      `- Server source path: ${serverSourcePath}`,
      `- Server core runtime path: ${SERVER_CORE_PATH}`,
      `- Logs path: ${PROFILE_LOGS_PATH}`,
      `- Temp path: ${TMP_PATH}`
    ].join('\n')
  }
}
