import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import OpenCodeTool from '@tools/coding_development/opencode'
import { buildSkillPrompt, getContextFiles } from '../lib/skill-prompt'

interface SkillWriterSettings extends Record<string, unknown> {
  opencode_openrouter_model?: string
}

const inferSkillNameFromFiles = (files: string[]): string | undefined => {
  for (const file of files) {
    const [root] = file.split(/[\\/]/)
    if (root && root.endsWith('_skill')) {
      return root
    }
  }
  return undefined
}

const getSkillDirectories = async (
  skillsRoot: string
): Promise<Set<string>> => {
  try {
    const entries = await fs.promises.readdir(skillsRoot, {
      withFileTypes: true
    })
    return new Set(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('_skill'))
        .map((entry) => entry.name)
    )
  } catch {
    return new Set()
  }
}

const getNewestSkillDirectory = async (
  skillsRoot: string,
  exclude: Set<string>
): Promise<string | undefined> => {
  try {
    const entries = await fs.promises.readdir(skillsRoot, {
      withFileTypes: true
    })
    const candidates = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.endsWith('_skill') &&
        !exclude.has(entry.name)
    )

    if (candidates.length === 0) return undefined

    const candidatesWithStats = await Promise.all(
      candidates.map(async (entry) => {
        const stat = await fs.promises.stat(path.join(skillsRoot, entry.name))
        return { name: entry.name, mtimeMs: stat.mtimeMs }
      })
    )

    candidatesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return candidatesWithStats[0]?.name
  } catch {
    return undefined
  }
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  try {
    const description = _params.utterance
    const bridge =
      (paramsHelper.getActionArgument('bridge') as string | undefined) ||
      'nodejs'

    // Validate bridge parameter
    if (bridge !== 'nodejs' && bridge !== 'python') {
      leon.answer({
        key: 'invalid_bridge',
        data: { bridge }
      })

      return
    }

    const settings = new Settings<SkillWriterSettings>()
    const provider = 'openrouter'
    const model = (await settings.get('opencode_openrouter_model')) as
      | string
      | undefined

    leon.answer({ key: 'generating_skill', data: { provider } })

    const targetPath = process.cwd()
    const skillsRoot = path.join(targetPath, 'skills')
    const existingSkills = await getSkillDirectories(skillsRoot)

    // Context files for OpenCode to learn from (choose based on bridge)
    const contextFiles = getContextFiles(bridge)

    // Enhanced description with tool guidance
    const enhancedDescription = buildSkillPrompt(description, 'create')

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

    // Extract created files info
    const filesCreated = response.files_created || []
    const inferredSkillName = inferSkillNameFromFiles(filesCreated)
    const newestSkillName = await getNewestSkillDirectory(
      skillsRoot,
      existingSkills
    )

    leon.answer({
      key: 'skill_created',
      data: {
        skill_name: inferredSkillName || newestSkillName || 'new_skill',
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
