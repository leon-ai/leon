import path from 'node:path'

import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'

import { SKILL_PATH } from '@bridge/constants'

export class Memory {
  public async test(): Promise<void> {
    // const __dirname = dirname(fileURLToPath(import.meta.url))
    const file = path.join(SKILL_PATH, 'memory', 'db.json')

    const adapter = new JSONFile(file)
    const defaultData = { posts: [] }
    const db = new Low(adapter, defaultData)

    await db.read()
  }
}
