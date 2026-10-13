import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { CONFIG_MANAGER } from '@/config'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { ProfileHelper } from '@/helpers/profile-helper'

const CONNECTION_KEY_ENV_NAME = 'LEON_CONNECTIONS_ENCRYPTION_KEY'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const TOKEN_REFRESH_WINDOW_MS = 60_000
const encryptionKeyPromises = new Map<string, Promise<Buffer>>()

export type ConnectionAuthType = 'api_key' | 'oauth'

export enum ConnectionStatus {
  Connected = 'connected',
  NeedsAttention = 'needs_attention'
}

export interface ConnectionSummary {
  status: ConnectionStatus
  provider: string
  auth_type: ConnectionAuthType
  connected_at: string
  account_label?: string
  scopes?: string[]
}

interface StoredConnection extends ConnectionSummary {
  iv: string
  auth_tag: string
  ciphertext: string
}

export interface SaveConnectionInput {
  provider: string
  auth_type: ConnectionAuthType
  credentials: Record<string, unknown>
  account_label?: string
  scopes?: string[]
  connected_at?: string
}

function validateProvider(provider: string): string {
  const normalizedProvider = provider.trim().toLowerCase()

  if (!/^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/.test(normalizedProvider)) {
    throw new Error('Use the qualified toolkit.tool ID for a connection.')
  }

  return normalizedProvider
}

/**
 * Reuses or creates the profile key for setup and newly provisioned profiles.
 * Existing encrypted connections require their original key to be restored.
 */
export function ensureConnectionEncryptionKey(
  profileName = getActiveProfileName()
): Promise<Buffer> {
  const existingPromise = encryptionKeyPromises.get(profileName)

  if (existingPromise) {
    return existingPromise
  }

  const keyPromise = runWithProfileContext({ profileName }, async () => {
    const storedKey = CONFIG_MANAGER.resolveSecretReference(
      {
        env: CONNECTION_KEY_ENV_NAME
      },
      profileName
    )

    if (storedKey) {
      const key = Buffer.from(storedKey, 'base64')

      if (key.length !== 32 || key.toString('base64') !== storedKey) {
        throw new Error('Leon connection encryption key has an invalid length.')
      }

      return key
    }

    // Losing a key must not silently replace it while encrypted accounts remain.
    const entries = await fs
      .readdir(getProfilePaths(profileName).connections, { recursive: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return []
        }

        throw error
      })

    if (entries.some((entry) => entry.endsWith('.json'))) {
      throw new Error(
        'The connection encryption key is missing. Restore this profile’s original .env key.'
      )
    }

    const key = randomBytes(32)

    await ProfileHelper.updateDotEnvVariable(
      CONNECTION_KEY_ENV_NAME,
      key.toString('base64')
    )

    return key
  })

  encryptionKeyPromises.set(profileName, keyPromise)
  // Serialize creation, but re-read the profile key on later operations.
  void keyPromise.then(
    () => encryptionKeyPromises.delete(profileName),
    () => encryptionKeyPromises.delete(profileName)
  )

  return keyPromise
}

function encryptSecret(
  secret: Record<string, unknown>,
  key: Buffer
): Pick<StoredConnection, 'iv' | 'auth_tag' | 'ciphertext'> {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secret), 'utf8'),
    cipher.final()
  ])

  return {
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

function decryptSecret(
  connection: StoredConnection,
  key: Buffer
): Record<string, unknown> {
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(connection.iv, 'base64')
  )

  decipher.setAuthTag(Buffer.from(connection.auth_tag, 'base64'))

  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(connection.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  ) as Record<string, unknown>
}

/**
 * Stores profile-owned provider credentials separately from ordinary tool settings.
 */
export class ConnectionStore {
  private readonly operations = new Map<string, Promise<unknown>>()

  /**
   * Application credentials share encryption but remain separate from accounts.
   */
  public constructor(
    private readonly subdirectory = '',
    private readonly refresh?: (
      provider: string,
      credentials: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
  ) {}

  private getDirectory(profileName?: string): string {
    return path.join(getProfilePaths(profileName).connections, this.subdirectory)
  }

  /**
   * Serializes refreshes and mutations so token rotation cannot revive a removed connection.
   */
  private async withConnectionLock<T>(
    provider: string,
    profileName: string | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = this.getConnectionPath(provider, profileName)
    const previous = this.operations.get(key) || Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)

    this.operations.set(key, next)
    try {
      return await next
    } finally {
      if (this.operations.get(key) === next) {
        this.operations.delete(key)
      }
    }
  }

  private getConnectionPath(provider: string, profileName?: string): string {
    return path.join(
      this.getDirectory(profileName),
      `${validateProvider(provider)}.json`
    )
  }

  /**
   * Lists connection metadata without decrypting or returning credentials.
   */
  async list(profileName?: string): Promise<ConnectionSummary[]> {
    const directory = this.getDirectory(profileName)
    let entries: string[]

    try {
      entries = await fs.readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }

      throw error
    }

    const summaries: ConnectionSummary[] = []

    for (const entry of entries.filter((name) => name.endsWith('.json'))) {
      const raw = await fs.readFile(path.join(directory, entry), 'utf8')
      const stored = JSON.parse(raw) as StoredConnection

      summaries.push({
        status: stored.status || ConnectionStatus.NeedsAttention,
        provider: stored.provider,
        auth_type: stored.auth_type,
        connected_at: stored.connected_at,
        ...(stored.account_label
          ? { account_label: stored.account_label }
          : {}),
        ...(stored.scopes ? { scopes: stored.scopes } : {})
      })
    }

    return summaries
  }

  /**
   * Saves encrypted credentials and non-secret account metadata for one profile.
   */
  async save(
    input: SaveConnectionInput,
    profileName?: string
  ): Promise<ConnectionSummary> {
    return this.withConnectionLock(input.provider, profileName, () =>
      this.saveCredentials(input, profileName)
    )
  }

  /**
   * Writes an encrypted record while its caller holds the connection lock.
   */
  private async saveCredentials(
    input: SaveConnectionInput,
    profileName?: string
  ): Promise<ConnectionSummary> {
    if (input.auth_type !== 'api_key' && input.auth_type !== 'oauth') {
      throw new Error('Unsupported connection authentication type.')
    }

    if (!Object.keys(input.credentials).length) {
      throw new Error('Connection credentials cannot be empty.')
    }

    const provider = validateProvider(input.provider)
    const connection: StoredConnection = {
      status: ConnectionStatus.Connected,
      provider,
      auth_type: input.auth_type,
      connected_at: input.connected_at || new Date().toISOString(),
      ...(input.account_label ? { account_label: input.account_label } : {}),
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...encryptSecret(
        input.credentials,
        await ensureConnectionEncryptionKey(profileName)
      )
    }
    const connectionPath = this.getConnectionPath(provider, profileName)
    const directory = path.dirname(connectionPath)
    const temporaryPath = `${connectionPath}.${randomBytes(8).toString('hex')}.tmp`

    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.writeFile(temporaryPath, JSON.stringify(connection), {
      mode: 0o600,
      flag: 'wx'
    })
    await fs.rename(temporaryPath, connectionPath)

    return {
      status: connection.status,
      provider,
      auth_type: connection.auth_type,
      connected_at: connection.connected_at,
      ...(connection.account_label
        ? { account_label: connection.account_label }
        : {}),
      ...(connection.scopes ? { scopes: connection.scopes } : {})
    }
  }

  /**
   * Reads credentials for an authorized in-process provider integration.
   */
  async getCredentials(
    provider: string,
    profileName?: string,
    forceRefresh = false,
    refresh = true
  ): Promise<Record<string, unknown> | null> {
    return this.withConnectionLock(provider, profileName, () =>
      this.readCredentials(provider, profileName, forceRefresh, refresh)
    )
  }

  /**
   * Reads and refreshes a token while its caller holds the connection lock.
   */
  private async readCredentials(
    provider: string,
    profileName?: string,
    forceRefresh = false,
    refresh = true
  ): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(
        this.getConnectionPath(provider, profileName),
        'utf8'
      )
      const stored = JSON.parse(raw) as StoredConnection
      const credentials = decryptSecret(
        stored,
        await ensureConnectionEncryptionKey(profileName)
      )
      const expiresAt = Number(credentials['expires_at'] || 0)

      if (
        refresh && stored.auth_type === 'oauth' &&
        (forceRefresh ||
          (expiresAt > 0 && expiresAt <= Date.now() + TOKEN_REFRESH_WINDOW_MS))
      ) {
        // Load the OAuth manager only when a refresh is needed to avoid coupling
        // ordinary API-key reads to OAuth provider code.
        const refreshed = await runWithProfileContext(
          { profileName: profileName || getActiveProfileName() },
          async () => {
            if (this.refresh) {
              return this.refresh(stored.provider, credentials)
            }

            const { OAUTH_MANAGER } = await import('./oauth-manager')
            return OAUTH_MANAGER.refreshCredentials(stored.provider, credentials)
          }
        )

        await this.saveCredentials(
          {
            provider: stored.provider,
            auth_type: stored.auth_type,
            connected_at: stored.connected_at,
            credentials: refreshed,
            ...(stored.account_label
              ? { account_label: stored.account_label }
              : {}),
            ...(stored.scopes ? { scopes: stored.scopes } : {})
          },
          profileName
        )

        return refreshed
      }

      return credentials
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      throw error
    }
  }

  /**
   * Marks rejected authorization without discarding credentials needed for recovery.
   */
  async markNeedsAttention(
    provider: string,
    profileName?: string
  ): Promise<void> {
    await this.withConnectionLock(provider, profileName, async () => {
      const filename = this.getConnectionPath(provider, profileName)

      try {
        const stored = JSON.parse(
          await fs.readFile(filename, 'utf8')
        ) as StoredConnection

        stored.status = ConnectionStatus.NeedsAttention
        const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`

        await fs.writeFile(temporary, JSON.stringify(stored), {
          mode: 0o600,
          flag: 'wx'
        })
        await fs.rename(temporary, filename)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    })
  }

  /**
   * Removes a provider connection from one profile.
   */
  async remove(provider: string, profileName?: string): Promise<boolean> {
    return this.withConnectionLock(provider, profileName, () =>
      this.removeCredentials(provider, profileName)
    )
  }

  /**
   * Deletes the record after any in-flight refresh has finished.
   */
  private async removeCredentials(
    provider: string,
    profileName?: string
  ): Promise<boolean> {
    try {
      await fs.unlink(this.getConnectionPath(provider, profileName))

      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }

      throw error
    }
  }
}

export const CONNECTION_STORE = new ConnectionStore()
export const OAUTH_APPLICATION_STORE = new ConnectionStore('oauth-applications')
