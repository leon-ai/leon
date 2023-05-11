import path from 'node:path'

import { SKILL_PATH } from '@bridge/constants'

const dynamicImport = new Function('specifier', 'return import(specifier)')

export class Memory {
  private readonly memoryPath: string
  private readonly name: string
  private memory: any

  constructor(name: string) {
    this.name = name
    this.memoryPath = path.join(SKILL_PATH, 'memory', `${this.name}.json`)
  }

  public async load(): Promise<Memory> {
    const { Low } = await dynamicImport('lowdb')
    const { JSONFile } = await dynamicImport('lowdb/node')
    const adapter = new JSONFile(this.memoryPath)

    this.memory = new Low(adapter, { [this.name]: [] })

    await this.memory.read()

    return this
  }

  /**
   * Insert record to memory
   * @param record
   * @example insertOne({ id: 0, title: 'hello world' })
   */
  public async insertOne<T>(record: T): Promise<T> {
    this.memory.data[this.name].push(record)

    await this.memory.write()

    return record
  }
}
