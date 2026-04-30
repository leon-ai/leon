import path from 'node:path'

import {
  syncNodejsSourceDependencies,
  syncPythonSourceDependencies
} from '../sync-source-dependencies'

/**
 * Sync skill dependencies only when a skill is installed, updated, or its
 * dependency manifest changes.
 */
export default async function syncSkillDependencies(
  _skillFriendlyName,
  currentSkill
) {
  const skillSRCPath = path.join(currentSkill.path, 'src')

  if (currentSkill.bridge === 'nodejs') {
    await syncNodejsSourceDependencies(skillSRCPath)

    return
  }

  if (currentSkill.bridge === 'python') {
    await syncPythonSourceDependencies(skillSRCPath)
  }
}
