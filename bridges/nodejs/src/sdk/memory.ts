import path from 'node:path'

import { SKILL_PATH } from '@bridge/constants'

const dynamicImport = new Function('specifier', 'return import(specifier)')

export class Memory {
  private DATABASE_PATH = path.join(SKILL_PATH, 'memory', 'database.json')

  public async test(): Promise<void> {
    const { Low } = await dynamicImport('lowdb')
    const { JSONFile } = await dynamicImport('lowdb/node')
    const adapter = new JSONFile(this.DATABASE_PATH)
    const defaultData = { posts: [] }
    const database = new Low(adapter, defaultData)
    await database.read()
  }
}
