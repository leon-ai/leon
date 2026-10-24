import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

function mergeMissingSettings(
  defaultSettings: Record<string, unknown>,
  existingSettings: Record<string, unknown>
): Record<string, unknown> {
  const mergedSettings = { ...existingSettings }

  for (const [key, defaultValue] of Object.entries(defaultSettings)) {
    const existingValue = existingSettings[key]

    if (!Object.prototype.hasOwnProperty.call(existingSettings, key)) {
      mergedSettings[key] = defaultValue
      continue
    }

    if (isPlainObject(defaultValue) && isPlainObject(existingValue)) {
      mergedSettings[key] = mergeMissingSettings(defaultValue, existingValue)
    }
  }

  return mergedSettings
}

/**
 * Paths supplied by the host keep persistence independent of runtime ownership.
 */
export interface ToolSettingsPaths {
  settings: string
  sample: string
}

/**
 * Preserve owner values while filling defaults and atomically saving tool settings.
 */
export class ToolSettingsStore {
  private static readonly cache = new Map<string, Record<string, unknown>>()

  /**
   * Read fresh owner edits when requested; cache only within the exact settings path.
   */
  public static load(
    paths: ToolSettingsPaths,
    defaults: Record<string, unknown> = {},
    refresh = false
  ): Record<string, unknown> {
    if (!refresh && this.cache.has(paths.settings)) {
      return this.cache.get(paths.settings)!
    }

    const defaultSettings = existsSync(paths.sample)
      ? JSON.parse(readFileSync(paths.sample, 'utf8')) as Record<string, unknown>
      : defaults
    const exists = existsSync(paths.settings)
    const ownerSettings = exists
      ? JSON.parse(readFileSync(paths.settings, 'utf8')) as Record<string, unknown>
      : {}
    const settings = mergeMissingSettings(defaultSettings, ownerSettings)

    if (!exists || JSON.stringify(settings) !== JSON.stringify(ownerSettings)) {
      this.persist(paths.settings, settings)
    }

    this.cache.set(paths.settings, settings)
    return settings
  }

  /**
   * Merge edits against fresh settings without replacing unrelated owner fields.
   */
  public static save(paths: ToolSettingsPaths, values: Record<string, unknown>): void {
    const settings = { ...this.load(paths, {}, true), ...values }
    this.persist(paths.settings, settings)
    this.cache.set(paths.settings, settings)
  }

  /**
   * Secrets must never be exposed through a partial or publicly readable replacement.
   */
  private static persist(filename: string, settings: Record<string, unknown>): void {
    mkdirSync(dirname(filename), { recursive: true })
    const temporaryPath = `${filename}.${randomUUID()}.tmp`

    try {
      writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), {
        mode: 0o600,
        flag: 'wx'
      })
      renameSync(temporaryPath, filename)
    } finally {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath)
      }
    }
  }
}
