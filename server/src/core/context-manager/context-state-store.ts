import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_CONTEXT_PATH } from '@/constants'

export class ContextStateStore<T> {
  private readonly stateFilePath: string

  public constructor(stateFilename: string, private readonly fallback: T) {
    this.stateFilePath = path.join(PROFILE_CONTEXT_PATH, stateFilename)
  }

  public load(): T {
    if (!fs.existsSync(this.stateFilePath)) {
      return this.clone(this.fallback)
    }

    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf8')
      return JSON.parse(raw) as T
    } catch {
      return this.clone(this.fallback)
    }
  }

  public save(state: T): void {
    try {
      fs.mkdirSync(PROFILE_CONTEXT_PATH, { recursive: true })
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8')
    } catch {
      // Ignore state persistence failures.
    }
  }

  private clone(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }
}
