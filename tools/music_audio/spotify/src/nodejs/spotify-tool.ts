import { ConnectionRequiredError, Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const API_BASE_URL = 'https://api.spotify.com/v1/'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Calls Spotify's API with credentials supplied by the profile connection store.
 */
export default class SpotifyTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'spotify'
  }
  get toolkit(): string {
    return 'music_audio'
  }
  get description(): string {
    return this.config.description
  }

  /**
   * Reads the authorized Spotify account.
   */
  async getProfile(): Promise<unknown> {
    return this.request('me')
  }

  /**
   * Searches one Spotify catalog type with bounded pagination.
   */
  async search(options: {
    query: string
    type: 'track' | 'album' | 'artist' | 'playlist'
    limit?: number
    offset?: number
  }): Promise<unknown> {
    const query = new URLSearchParams({
      q: options.query,
      type: options.type,
      limit: String(options.limit ?? 10),
      offset: String(options.offset ?? 0)
    })

    return this.request(`search?${query}`)
  }

  /**
   * Lists the owner's playlists without collecting listening history.
   */
  async listPlaylists(
    options: { limit?: number, offset?: number } = {}
  ): Promise<unknown> {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 20),
      offset: String(options.offset ?? 0)
    })

    return this.request(`me/playlists?${query}`)
  }

  /**
   * Retrieves an observed playlist ID from Spotify.
   */
  async getPlaylist(options: { playlistId: string }): Promise<unknown> {
    return this.request(`playlists/${encodeURIComponent(options.playlistId)}`)
  }

  /**
   * Lists Spotify Connect players visible to the connected account.
   */
  async listDevices(): Promise<unknown> {
    return this.request('me/player/devices')
  }

  /**
   * Reads current playback; an empty response means no active playback.
   */
  async getPlaybackState(): Promise<unknown> {
    return this.request('me/player')
  }

  /**
   * Starts observed track URIs or an album/artist/playlist context on a device.
   */
  async play(
    options: { deviceId?: string, uris?: string[], contextUri?: string } = {}
  ): Promise<unknown> {
    if (options.uris && options.contextUri) {
      throw new Error('Provide either track URIs or a context URI, not both.')
    }

    return this.playerRequest('play', 'PUT', options.deviceId, {
      ...(options.uris ? { uris: options.uris } : {}),
      ...(options.contextUri ? { context_uri: options.contextUri } : {})
    })
  }

  /**
   * Pauses the selected player or the currently active device.
   */
  async pause(options: { deviceId?: string } = {}): Promise<unknown> {
    return this.playerRequest('pause', 'PUT', options.deviceId)
  }

  /**
   * Skips to the next track on the selected player.
   */
  async next(options: { deviceId?: string } = {}): Promise<unknown> {
    return this.playerRequest('next', 'POST', options.deviceId)
  }

  /**
   * Returns to the previous track on the selected player.
   */
  async previous(options: { deviceId?: string } = {}): Promise<unknown> {
    return this.playerRequest('previous', 'POST', options.deviceId)
  }

  /**
   * Sets volume only on Spotify devices supporting remote volume control.
   */
  async setVolume(options: {
    volumePercent: number
    deviceId?: string
  }): Promise<unknown> {
    return this.playerRequest('volume', 'PUT', options.deviceId, undefined, {
      volume_percent: String(options.volumePercent)
    })
  }

  /**
   * Transfers playback to an observed Spotify Connect device.
   */
  async transferPlayback(options: {
    deviceId: string
    play?: boolean
  }): Promise<unknown> {
    return this.request('me/player', 'PUT', {
      device_ids: [options.deviceId],
      ...(options.play !== undefined ? { play: options.play } : {})
    })
  }

  /**
   * Encodes an optional device target without assuming the server is the player.
   */
  private async playerRequest(
    action: string,
    method: string,
    deviceId?: string,
    body?: unknown,
    parameters: Record<string, string> = {}
  ): Promise<unknown> {
    const query = new URLSearchParams(parameters)

    if (deviceId) {
      query.set('device_id', deviceId)
    }

    return this.request(`me/player/${action}?${query}`, method, body)
  }

  /**
   * Verifies this account using a read-only provider request.
   */
  public override async validateConnection(): Promise<{
    account_label?: string
  }> {
    const account = (await this.getProfile()) as {
      display_name?: string
      id?: string
    }
    const label = account.display_name || account.id

    return label ? { account_label: label } : {}
  }

  /**
   * Keeps authentication checks in the tool and never includes provider bodies in errors.
   */
  private async request(
    resource: string,
    method = 'GET',
    body?: unknown
  ): Promise<unknown> {
    const credentials = this.requireConnectionCredentials()
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = this.executionContext?.signal
      ? AbortSignal.any([this.executionContext.signal, timeoutSignal])
      : timeoutSignal
    const response = await fetch(new URL(resource, API_BASE_URL), {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${String(credentials['access_token'])}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
      redirect: 'error'
    })

    if (response.status === 401) {
      throw new ConnectionRequiredError(
        'Reconnect the tool using the connection widget in chat.'
      )
    }

    if (response.status === 404 && resource.startsWith('me/player')) {
      throw new Error(
        'Spotify player unavailable. Open Spotify on the intended device, start a track if needed, then list devices again.'
      )
    }

    if (response.status === 403 && resource.startsWith('me/player')) {
      throw new Error(
        'Spotify denied playback. Playback control requires Premium and an unrestricted Spotify Connect device; remote volume control may be unsupported.'
      )
    }

    if (response.status === 204 && method === 'GET') {
      return { active: false }
    }

    if (!response.ok) {
      throw new Error(`Spotify request failed (${response.status}).`)
    }

    const text = await response.text()

    return text ? (JSON.parse(text) as unknown) : { success: true }
  }
}
