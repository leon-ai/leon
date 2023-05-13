import path from 'node:path'
import fs from 'node:fs'

import { SKILL_PATH } from '@bridge/constants'

export class Memory {
  private readonly memoryPath: string
  private readonly name: string

  constructor(name: string) {
    this.memoryPath = path.join(SKILL_PATH, 'memory', `${name}.json`)
    this.name = name
  }

  /**
   * Get the memory
   */
  public async getMemory(): Promise<Record<string, unknown>> {
    return this.read()
  }

  /**
   * Get a value from the memory
   * @param key The key to get
   * @example get('key') // { name: 'Leon' }
   */
  public async get<T>(key: string): Promise<T> {
    const memory = await this.read()

    return memory[key] as T
  }

  /**
   * Set a value in the memory
   * @param key The key to set
   * @param value The value to set
   * @example set('key', { name: 'Leon' })
   */
  public async set<T>(key: string, value: T): Promise<void> {
    const memory = await this.read()
    memory[key] = value

    await this.write(memory)
  }

  /**
   * Delete a value from the memory
   * @param key The key to delete
   * @example delete('key')
   */
  public async delete(key: string): Promise<void> {
    const memory = await this.read()
    delete memory[key]

    await this.write(memory)
  }

  /**
   * Clear the memory
   * @example clear()
   */
  public async clear(): Promise<void> {
    await this.write({})
  }

  /**
   * Read the memory
   */
  private async read(): Promise<Record<string, unknown>> {
    try {
      if (!fs.existsSync(this.memoryPath)) {
        await this.clear()
      }

      return JSON.parse(await fs.promises.readFile(this.memoryPath, 'utf-8'))
    } catch (e) {
      console.error(`Error while reading memory for ${this.name}:`, e)
      return {}
    }
  }

  /**
   * Write the memory
   * @param memory The memory to write
   */
  private async write(memory: Record<string, unknown>): Promise<void> {
    try {
      await fs.promises.writeFile(
        this.memoryPath,
        JSON.stringify(memory, null, 2)
      )
    } catch (e) {
      console.error(`Error while writing memory for ${this.name}:`, e)
    }
  }
}
