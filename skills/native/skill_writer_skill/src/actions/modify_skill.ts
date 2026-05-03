import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import OpenCodeTool from '@tools/coding_development/opencode'
import { buildSkillPrompt, getContextFiles } from '../lib/skill-prompt'

interface SkillWriterSettings extends Record<string, unknown> {
  opencode_openrouter_model?: string
}

export const run: ActionFunction = async function (_params: ActionParams) {
  try {
    const description = _params.utterance
    const targetPath = process.cwd()
    const skillsRoot = path.join(targetPath, 'skills')
    const bridge = await inferBridgeFromExistingSkill(description, skillsRoot)

    const settings = new Settings<SkillWriterSettings>()
    const provider = 'openrouter'
    const model = (await settings.get('opencode_openrouter_model')) as
      | string
      | undefined

    leon.answer({ key: 'modifying_skill', data: { provider } })

    // Context files for OpenCode to learn from (choose based on bridge)
    const contextFiles = getContextFiles(bridge)

    // Enhanced description with tool guidance
    const enhancedDescription = buildSkillPrompt(description, 'modify')

    const opencodeTool = await ToolManager.initTool(OpenCodeTool)

    const skillOptions: Parameters<typeof opencodeTool.generateSkill>[0] = {
      description: enhancedDescription,
      provider,
      target_path: targetPath,
      context_files: contextFiles,
      bridge
    }

    if (model) {
      skillOptions.model = model
    }

    const response = await opencodeTool.generateSkill(skillOptions)

    if (!response.success) {
      leon.answer({
        key: 'generation_failed',
        data: { error: response.error || 'Unknown error' }
      })
      return
    }

    leon.answer({
      key: 'skill_modified',
      data: {
        provider: response.provider_used || provider,
        model: response.model_used || model || 'default'
      }
    })
  } catch (error: unknown) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    throw error
  }
}

const inferBridgeFromExistingSkill = async (
  description: string,
  skillsRoot: string
): Promise<'nodejs' | 'python'> => {
  const skillDir = await findMatchingSkillDirectory(description, skillsRoot)
  if (!skillDir) return 'nodejs'

  try {
    const skillJsonPath = path.join(skillsRoot, skillDir, 'skill.json')
    const skillData = JSON.parse(
      await fs.promises.readFile(skillJsonPath, 'utf-8')
    )
    return skillData.bridge === 'python' ? 'python' : 'nodejs'
  } catch {
    return 'nodejs'
  }
}

const findMatchingSkillDirectory = async (
  description: string,
  skillsRoot: string
): Promise<string | undefined> => {
  const descriptionLower = description.toLowerCase()

  let entries: fs.Dirent[] = []
  try {
    entries = await fs.promises.readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return undefined
  }

  const skillDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('_skill'))
    .map((entry) => entry.name)

  if (skillDirs.length === 1) {
    return skillDirs[0]
  }

  for (const skillDir of skillDirs) {
    const skillDirLower = skillDir.toLowerCase()
    const skillBase = skillDirLower.replace(/_skill$/, '')
    if (
      descriptionLower.includes(skillDirLower) ||
      (skillBase && descriptionLower.includes(skillBase))
    ) {
      return skillDir
    }
  }

  return undefined
}
