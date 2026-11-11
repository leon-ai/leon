import fs from 'node:fs'
import path from 'node:path'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { FileHelper } from '@/helpers/file-helper'

export class ContextStateStore<T> {
  private readonly stateFilePath: string

  public constructor(
    stateFilename: string,
    private readonly fallback: T,
    private readonly directoryPath = getProfilePaths().context
  ) {
    this.stateFilePath = path.join(this.directoryPath, stateFilename)
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
      FileHelper.writeAtomicJSONSync(this.stateFilePath, state)
    } catch {
      // Ignore state persistence failures.
    }
  }

  private clone(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }
}
