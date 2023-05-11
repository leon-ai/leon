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
    return this.low.data[this.name].filter((record: T) => {
      return this.isMatch(record, filter)
    })
  }

  /**
   * Check if a record match a filter
   * @param record The record to check
   * @param filter The filter to apply
   * @example isMatch({ id: 0, title: 'hello world' }, { id: 0 })
   */
  private isMatch<T>(record: any, filter: Partial<T>): boolean {
    if (Array.isArray(record) && Array.isArray(filter)) {
      return record.some((item) => {
        return filter.some((filterItem) => {
          return this.isMatch(item, filterItem)
        })
      })
    } else if (typeof record === 'object' && typeof filter === 'object') {
      return Object.entries(filter).every(([key, value]) => {
        if (typeof value === 'object') {
          return this.isMatch(record[key], value as Partial<T>)
        } else {
          return record[key] === value
        }
      })
    } else {
      return record === filter
    }
  }

  /**
   * Update a record
   * @param filter The filter to apply
   * @param update The update to apply
   */
  public async updateOne<T, U>(
    filter: Partial<T>,
    update: Partial<U>
  ): Promise<T | undefined> {
    const record = await this.findOne(filter)

    if (!record) {
      return
    }

    Object.assign(record, update)

    await this.low.write()

    return record
  }

  public async updateMany<T, U>(
    filter: Partial<T>,
    update: Partial<U>
  ): Promise<T[] | undefined> {
    const records = await this.findMany(filter)

    if (!records) {
      return
    }

    records.forEach((record: any) => {
      Object.assign(record, update)
    })

    await this.low.write()

    return records
  }
}
