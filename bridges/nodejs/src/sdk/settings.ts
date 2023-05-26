import path from 'node:path'
import fs from 'node:fs'

import { SKILL_PATH } from '@bridge/constants'

export class Settings<T extends Record<string, unknown>> {
  private readonly settingsPath: string
  private readonly settingsSamplePath: string

  public constructor() {
    this.settingsPath = path.join(SKILL_PATH, 'src', 'settings.json')
    this.settingsSamplePath = path.join(
      SKILL_PATH,
      'src',
      'settings.sample.json'
    )
  }

  public async isAlreadySet(): Promise<boolean> {
    const settingsSample = await this.getSettingsSample()
    const settings = await this.get()
    return JSON.stringify(settings) !== JSON.stringify(settingsSample)
  }

  public async clear(): Promise<void> {
    const settingsSample = await this.getSettingsSample()
    await this.set(settingsSample)
  }

  private async getSettingsSample(): Promise<T> {
    try {
      return JSON.parse(
        await fs.promises.readFile(this.settingsSamplePath, 'utf8')
      )
    } catch (e) {
      console.error(
        `Error while reading settings sample at "${this.settingsSamplePath}":`,
        e
      )
      throw e
    }
  }

  public async get<Key extends keyof T>(key: Key): Promise<T[Key]>
  public async get(): Promise<T>
  public async get<Key extends keyof T>(key?: Key): Promise<T | T[Key]> {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        await this.clear()
      }

      const settings = JSON.parse(
        await fs.promises.readFile(this.settingsPath, 'utf8')
      )
      if (key != null) {
        return settings[key]
      }
      return settings
    } catch (e) {
      console.error(
        `Error while reading settings at "${this.settingsPath}":`,
        e
      )
      throw e
    }
  }

  public async set<Key extends keyof T>(key: Key, value: T[Key]): Promise<T>
  public async set(settings: T): Promise<T>
  public async set<Key extends keyof T>(
    keyOrSettings: Key | T,
    value?: T[Key]
  ): Promise<T> {
    try {
      const settings = await this.get()
      const newSettings =
        typeof keyOrSettings === 'object'
          ? keyOrSettings
          : { ...settings, [keyOrSettings]: value }

      await fs.promises.writeFile(
        this.settingsPath,
        JSON.stringify(newSettings, null, 2)
      )

      return newSettings
    } catch (e) {
      console.error(
        `Error while writing settings at "${this.settingsPath}":`,
        e
      )
      throw e
    }
  }
}
