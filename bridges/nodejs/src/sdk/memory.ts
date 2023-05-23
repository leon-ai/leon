import path from 'node:path'
import fs from 'node:fs'

import { SKILL_PATH, SKILLS_PATH } from '@bridge/constants'

interface MemoryOptions<T> {
  name: string
  defaultMemory?: T
}

export class Memory<T = unknown> {
  private readonly memoryPath: string | undefined
  private readonly name: string
  private readonly defaultMemory: T | undefined

  constructor(options: MemoryOptions<T>) {
    const { name, defaultMemory } = options

    this.name = name
    this.defaultMemory = defaultMemory

    if (name.includes(':') && name.split(':').length === 3) {
      const [domainName, skillName, memoryName] = name.split(':')
      const memoryPath = path.join(
        SKILLS_PATH,
        domainName as string,
        skillName as string,
        'memory',
        `${memoryName}.json`
      )

      if (fs.existsSync(memoryPath)) {
        this.memoryPath = memoryPath
      }
    } else {
      this.memoryPath = path.join(SKILL_PATH, 'memory', `${options.name}.json`)
    }
  }

  /**
   * Clear the memory and set it to the default memory value
   * @example clear()
   */
  public async clear(): Promise<void> {
    if (this.defaultMemory) {
      await this.write(this.defaultMemory)
    } else {
      throw new Error(
        `You cannot clear the memory "${this.name}" as it belongs to another skill`
      )
    }
  }

  /**
   * Read the memory
   * @example read()
   */
  public async read(): Promise<T> {
    if (!this.memoryPath) {
      throw new Error(
        `You cannot read the memory "${this.name}" as it belongs to another skill which haven't written to this memory yet`
      )
    }

    try {
      if (!fs.existsSync(this.memoryPath)) {
        await this.clear()
      }

      return JSON.parse(await fs.promises.readFile(this.memoryPath, 'utf-8'))
    } catch (e) {
      console.error(`Error while reading memory for "${this.name}":`, e)
      throw e
    }
  }

  /**
   * Write the memory
   * @param memory The memory to write
   * @example write({ foo: 'bar' }) // { foo: 'bar' }
   */
  public async write(memory: T): Promise<T> {
    if (this.defaultMemory && this.memoryPath) {
      try {
        await fs.promises.writeFile(
          this.memoryPath,
          JSON.stringify(memory, null, 2)
        )

        return memory
      } catch (e) {
        console.error(`Error while writing memory for "${this.name}":`, e)
        throw e
      }
    } else {
      throw new Error(
        `You cannot write into the memory "${this.name}" as it belongs to another skill`
      )
    }
  }
}
