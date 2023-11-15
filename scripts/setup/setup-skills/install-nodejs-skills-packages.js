import path from 'node:path'
import fs from 'node:fs'

import { command } from 'execa'

import { isFileEmpty } from '@/utilities'
import { LogHelper } from '@/helpers/log-helper'

/**
 * Install Node.js skills packages on setup
 * 1. If skill is Node.js, then verify if an installation is needed
 * 2. If install is needed, then install npm packages
 */
export default async function (skillFriendlyName, currentSkill) {
  if (currentSkill.bridge === 'nodejs') {
    const skillSRCPath = path.join(currentSkill.path, 'src')
    const skillPackageJSONPath = path.join(skillSRCPath, 'package.json')

    if (fs.existsSync(skillPackageJSONPath)) {
      const isPackageJSONEmpty = await isFileEmpty(skillPackageJSONPath)

      if (!isPackageJSONEmpty) {
        const packageJSONMtime = (await fs.promises.stat(skillPackageJSONPath))
          .mtime
        const lastSkillNPMInstallFilePath = path.join(
          skillSRCPath,
          '.last-skill-npm-install'
        )

        if (fs.existsSync(lastSkillNPMInstallFilePath)) {
          const lastSkillNPMInstallTime = new Date(
            Number(
              await fs.promises.readFile(lastSkillNPMInstallFilePath, 'utf8')
            )
          )

          if (packageJSONMtime <= lastSkillNPMInstallTime) {
            LogHelper.success(
              `"${skillFriendlyName}" skill npm packages are up-to-date`
            )

            return
          }
        }

        LogHelper.info(
          `Installing npm packages for the "${skillFriendlyName}" skill...`
        )

        await command(
          `cd ${skillSRCPath} && npm install --package-lock=false`,
          {
            shell: true
          }
        )
        await fs.promises.writeFile(
          lastSkillNPMInstallFilePath,
          `${Date.now()}`
        )

        LogHelper.success(`"${skillFriendlyName}" skill npm packages installed`)
      }
    }
  }
}
