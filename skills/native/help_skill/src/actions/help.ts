import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

const NATIVE_SKILLS_PATH = path.join(process.cwd(), 'skills', 'native')

interface Skill {
  name: string
  description: string
}

export const run: ActionFunction = async function () {
  let list = ''
  const skillFolders = (await fs.promises.readdir(NATIVE_SKILLS_PATH))
    .filter((folder) => folder.endsWith('_skill'))
    .sort()

  for (const skillFolder of skillFolders) {
    const skillPath = path.join(NATIVE_SKILLS_PATH, skillFolder, 'skill.json')
    if (!fs.existsSync(skillPath)) {
      continue
    }

    const { name: skillName, description } = JSON.parse(
      await fs.promises.readFile(skillPath, {
        encoding: 'utf8'
      })
    ) as Skill

    list += `<li>${skillName}: ${description}</li>`
  }

  await leon.answer({
    key: 'help_introduction',
    data: {
      list
    }
  })
}
