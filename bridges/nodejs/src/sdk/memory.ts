import path from 'node:path'
import fs from 'node:fs'

import { SKILL_PATH } from '@bridge/constants'

interface MemoryOptions<T> {
  name: string
  defaultMemory: T
}

export class Memory<T> {
  private readonly memoryPath: string
  private readonly name: string
  private readonly defaultMemory: T

  constructor(options: MemoryOptions<T>) {
    const { name, defaultMemory } = options
    this.name = name
    this.defaultMemory = defaultMemory
    this.memoryPath = path.join(SKILL_PATH, 'memory', `${options.name}.json`)
  }

  /**
   * Clear the memory
   * @example clear()
   */
  public async clear(): Promise<void> {
    await this.write(this.defaultMemory)
  }

  /**
   * Read the memory
   */
  public async read(): Promise<T> {
    try {
      if (!fs.existsSync(this.memoryPath)) {
        await this.clear()
      }
      return JSON.parse(await fs.promises.readFile(this.memoryPath, 'utf-8'))
    } catch (error) {
      console.error(`Error while reading memory for ${this.name}:`, error)
      throw error
    }
  }

  /**
   * Write the memory
   * @param memory The memory to write
   */
  public async write(memory: T): Promise<void> {
    try {
      await fs.promises.writeFile(
        this.memoryPath,
        JSON.stringify(memory, null, 2)
      )
    } catch (error) {
      console.error(`Error while writing memory for ${this.name}:`, error)
      throw error
    }
  }
}
