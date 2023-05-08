import path from 'node:path'

import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { PYTHON_BRIDGE_SRC_PATH } from '@/constants'

/**
 * Manage Node.js skills npm packages
 * npm run skill-package {command} {domain}:{skill} {npm package}
 */
;(async () => {
  LoaderHelper.start()

  const { argv } = process
  const givenCommand = argv[2]?.toLowerCase()
  const givenSkill = argv[3]?.toLowerCase()
  const givenPackage = argv[4]?.toLowerCase()
  const supportedCommands = ['install', 'uninstall']
  const commands = {
    install: {
      runningText: 'Installing',
      doneText: 'installed',
      command: 'install'
    },
    uninstall: {
      runningText: 'Uninstalling',
      doneText: 'uninstalled',
      command: 'uninstall'
    }
  }

  if (
    !givenCommand ||
    !givenSkill ||
    !givenPackage ||
    !givenSkill.includes(':')
  ) {
    LogHelper.error(
      'Missing skill name or package name. The command should be: "npm run skill-package {command} {domain}:{skill} {npm package}"'
    )
    process.exit(1)
  }
  if (!supportedCommands.includes(givenCommand)) {
    LogHelper.error(
      `Unsupported command "${givenCommand}". Supported commands are: ${supportedCommands.join(
        ', '
      )}`
    )
    process.exit(1)
  }

  const commandObject = commands[givenCommand]
  const [domainName, skillName] = givenSkill.split(':')
  const skillPath = SkillDomainHelper.getSkillPath(domainName, skillName)
  const skillInfo = await SkillDomainHelper.getSkillInfo(domainName, skillName)
  const skillSRCPath = path.join(skillPath, 'src')

  if (skillInfo.bridge === 'python') {
    const libPath = path.join(skillSRCPath, 'lib')
    const pythonBridgePipfilePath = path.join(PYTHON_BRIDGE_SRC_PATH, 'Pipfile')

    LogHelper.error(
      `The "${givenSkill}" skill is a Python skill.
Hence, you should manually download the "${givenPackage}" package and put it in the "${libPath}" folder.
Or, you can verify whether the "${givenPackage}" package is already available via the "${pythonBridgePipfilePath}" file.`
    )
    process.exit(1)
  }

  try {
    LogHelper.info(
      `${commandObject.runningText} "${givenPackage}" npm package for the "${givenSkill}" skill ("${skillSRCPath}")...`
    )

    await command(
      `npm ${commandObject.command} --package-lock=false --save-exact=true --prefix ${skillSRCPath} ${givenPackage}`,
      {
        shell: true,
        stdio: 'inherit'
      }
    )

    LogHelper.success(
      `Successfully ${commandObject.doneText} "${givenPackage}" npm package in "${skillSRCPath}"`
    )
  } catch (e) {
    LogHelper.error(
      `Failed to ${commandObject.command} "${givenPackage}" npm package in "${skillSRCPath}": ${e}`
    )
  } finally {
    LoaderHelper.stop()
  }
})()
