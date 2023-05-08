import path from 'node:path'
import fs from 'node:fs'

import { command } from 'execa'

import { isFileEmpty } from '@/utilities'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

/**
 * Install Node.js skills packages on setup
 * 1. Browse skills
 * 2. If skill is Node.js, then verify if an installation is needed
 * 3. If install is needed, then install npm packages
 */
export default async function () {
  try {
    LogHelper.info('Installing Node.js skills npm packages...')

    const skillDomains = await SkillDomainHelper.getSkillDomains()

    for (const currentDomain of skillDomains.values()) {
      const skillKeys = Object.keys(currentDomain.skills)

      // Browse skills
      for (let i = 0; i < skillKeys.length; i += 1) {
        const skillFriendlyName = skillKeys[i]
        const currentSkill = currentDomain.skills[skillFriendlyName]

        if (currentSkill.bridge === 'nodejs') {
          const skillSRCPath = path.join(currentSkill.path, 'src')
          const skillPackageJSONPath = path.join(skillSRCPath, 'package.json')

          if (fs.existsSync(skillPackageJSONPath)) {
            const isPackageJSONEmpty = await isFileEmpty(skillPackageJSONPath)

            if (!isPackageJSONEmpty) {
              const packageJSONMtime = (
                await fs.promises.stat(skillPackageJSONPath)
              ).mtime
              const lastSkillNPMInstallFilePath = path.join(
                skillSRCPath,
                '.last-skill-npm-install'
              )

              if (fs.existsSync(lastSkillNPMInstallFilePath)) {
                const lastSkillNPMInstallTime = new Date(
                  Number(
                    await fs.promises.readFile(
                      lastSkillNPMInstallFilePath,
                      'utf8'
                    )
                  )
                )

                if (packageJSONMtime <= lastSkillNPMInstallTime) {
                  LogHelper.success(
                    `"${skillFriendlyName}" skill npm packages are up-to-date`
                  )
                  continue
                }
              }

              LogHelper.info(
                `Installing npm packages for the "${skillFriendlyName}" skill...`
              )

              await command(
                `npm install --package-lock=false --prefix ${skillSRCPath}`,
                {
                  shell: true,
                  stdio: 'inherit'
                }
              )
              await fs.promises.writeFile(
                lastSkillNPMInstallFilePath,
                `${Date.now()}`
              )

              LogHelper.success(
                `"${skillFriendlyName}" skill npm packages installed`
              )
            }
          }
        }
      }
    }

    LogHelper.success('npm packages for Node.js skills installed')
  } catch (e) {
    LogHelper.error(
      `Failed to install Node.js skills third-party dependencies: ${e}`
    )
  }
}
