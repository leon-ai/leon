import path from 'node:path'

import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { ProfileHelper } from '@/helpers/profile-helper'
import { SkillFormat, SkillOrigin } from '@/types'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { setCatalogInstalled } from './activation'
import { catalogPresentation } from './presentation'
import type { SkillCatalogEntry } from './types'

/**
 * Adapts existing native/Agent Skill discovery without introducing a second
 * execution manager or enabling the tools a skill may mention.
 */
export class SkillCatalog {
  private mutations: Promise<unknown> = Promise.resolve()

  /**
   * Includes disabled packages without loading their instructions into a model.
   */
  public async list(): Promise<SkillCatalogEntry[]> {
    const entries: SkillCatalogEntry[] = []

    for (const descriptor of SkillDomainHelper.listAllSkillDescriptorsSync()) {
      const owned = descriptor.origin === SkillOrigin.Owner
      const installed = SkillDomainHelper.isSkillInstalled(descriptor)
      entries.push({
        id: descriptor.id,
        name: descriptor.name,
        description: descriptor.description,
        version: descriptor.version,
        kind: descriptor.format === SkillFormat.AgentSkill ? 'agent' : 'native',
        iconName: descriptor.iconName,
        installed,
        owned,
        enabled: installed && !ProfileHelper.isSkillDisabled(descriptor.id),
        ...await catalogPresentation(
          descriptor.catalog ?? {}, descriptor.path, !owned,
          `skills/${encodeURIComponent(descriptor.id)}`
        )
      })
    }

    return entries
  }

  /**
   * Serializes explicit owner changes while preserving availability policy and
   * leaving dependent tools and accounts untouched.
   */
  public async act(id: string, action: 'install' | 'enable' | 'disable' | 'remove'): Promise<void> {
    const change = this.mutations.catch(() => undefined).then(async () => {
      const descriptor = SkillDomainHelper.getSkillDescriptorSync(id, { includeDisabled: true })
      if (!descriptor) {
        throw new Error('This skill is not available.')
      }
      if (action === 'install' || action === 'remove') {
        if (descriptor.origin === SkillOrigin.Owner || descriptor.catalog?.distribution !== 'extension') {
          throw new Error('Disable this skill instead. Only bundled extensions can be added or removed here.')
        }
        const root = descriptor.format === SkillFormat.AgentSkill ? getProfilePaths().agentSkills : getProfilePaths().nativeSkills
        if (action === 'install' && descriptor.format === SkillFormat.LeonNative) {
          const [{ default: syncSkillDependencies }, { default: setupSkillSettings }] = await Promise.all([
            import('@@/scripts/setup/setup-skills/sync-skill-dependencies'),
            import('@@/scripts/setup/setup-skills/setup-skills-settings')
          ])
          const config = SkillDomainHelper.getNewSkillConfigSync(id, { includeDisabled: true })!
          const context = { path: descriptor.path, bridge: config.bridge }
          await syncSkillDependencies(id, context)
          await setupSkillSettings(id, context, root)
        }
        await setCatalogInstalled(path.join(root, descriptor.id), action === 'install')
      } else {
        if (!SkillDomainHelper.isSkillInstalled(descriptor)) {
          throw new Error('Add this skill first.')
        }
        if (ProfileHelper.hasSkillAllowlist()) {
          throw new Error('This profile uses an allow-only list. Update that list with /skill before changing this skill.')
        }
        if (action === 'enable') {
          await ProfileHelper.enableSkill(id)
        } else {
          await ProfileHelper.disableSkill(id)
        }
      }
    })
    this.mutations = change
    await change
  }
}

export const SKILL_CATALOG = createProfileServiceProxy('SKILL_CATALOG', () => new SkillCatalog())
