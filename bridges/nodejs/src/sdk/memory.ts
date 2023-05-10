import path from 'node:path'

import { SKILL_PATH, MEMORY } from '@bridge/constants'

const dynamicImport = new Function('specifier', 'return import(specifier)')

export class Memory {
  private static instance: Memory
  public Low: any
  public JSONFile: any

  constructor() {
    if (!Memory.instance) {
      Memory.instance = this
    }
  }

  public async init(): Promise<any> {
    this.Low = (await dynamicImport('lowdb')).Low
    this.JSONFile = (await dynamicImport('lowdb/node')).JSONFile

    return {
      Low: this.Low,
      JSONFile: this.JSONFile
    }
  }
}

export class Database {
  private dbPath: string
  private name: string
  private db: any

  constructor(name: string) {
    console.log('MEMORY', MEMORY)

    this.name = name
    this.dbPath = path.join(SKILL_PATH, 'memory', `${this.name}.json`)

    console.log('MEMORY.JSONFile', MEMORY.JSONFile)

    const adapter = new MEMORY.JSONFile(this.dbPath)

    this.db = new MEMORY.Low(adapter, {})
  }

  public async get(name: string): Promise<any> {
    await this.db.read()

    console.log('this.db', this.db)

    return this.db.data[name]
  }
}
