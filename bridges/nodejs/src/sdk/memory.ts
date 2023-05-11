import path from 'node:path'

import { SKILL_PATH } from '@bridge/constants'

const dynamicImport = new Function('specifier', 'return import(specifier)')

export class Memory {
  private readonly memoryPath: string
  private readonly name: string
  public low: any

  constructor(name: string) {
    this.name = name
    this.memoryPath = path.join(SKILL_PATH, 'memory', `${this.name}.json`)
  }

  public async load(): Promise<Memory> {
    const { Low } = await dynamicImport('lowdb')
    const { JSONFile } = await dynamicImport('lowdb/node')
    const adapter = new JSONFile(this.memoryPath)

    this.low = new Low(adapter, { [this.name]: [] })

    await this.low.read()

    return this
  }

  /**
   * Create record
   * @param record The record to create
   * @example createOne({ id: 0, title: 'hello world' })
   */
  public async createOne<T>(record: T): Promise<T> {
    this.low.data[this.name].push(record)

    await this.low.write()

    return record
  }

  /**
   * Create records
   * @param records The records to create
   * @example createMany([{ id: 0, title: 'hello world' }, { id: 1, title: 'hello world' }])
   */
  public async createMany<T>(records: T[]): Promise<T[]> {
    this.low.data[this.name].push(...records)

    await this.low.write()

    return records
  }

  /**
   * Find a record
   * @param filter The filter to apply
   * @example findOne({ id: 0 })
   */
  public async findOne<T>(filter: Partial<T>): Promise<T | undefined> {
    return this.low.data[this.name].find((record: any) => {
      return Object.entries(filter).every(([key, value]) => {
        return record[key] === value
      })
    })
  }

  /**
   * Find records
   * @param filter The filter to apply
   * @example findMany({ id: 0 })
   */
  public async findMany<T>(filter: Partial<T>): Promise<T[]> {
    return this.low.data[this.name].filter((record: any) => {
      return Object.entries(filter).every(([key, value]) => {
        return record[key] === value
      })
    })
  }
}
