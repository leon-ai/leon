import notion from '../../tools/productivity_collaboration/notion/tool.json' with { type: 'json' }
import spotify from '../../tools/music_audio/spotify/tool.json' with { type: 'json' }
import ticktick from '../../tools/productivity_collaboration/ticktick/tool.json' with { type: 'json' }
import { createConnectionPreview, type ConnectionPreview } from './connection-preview'

export { CONNECTION_PREVIEW_STATES, connectionPreviewView, createConnectionPreview } from './connection-preview'
export type { ConnectionPreview, ConnectionPreviewManifest } from './connection-preview'

// These named fixtures select integrations for API-bound tests; the gallery
// discovers its complete inventory independently from tool manifests.
export const CONNECTION_PREVIEWS: Record<string, ConnectionPreview> = {
  'connection-notion': createConnectionPreview(notion)!,
  'connection-spotify': createConnectionPreview(spotify)!,
  'connection-ticktick': createConnectionPreview(ticktick)!
}
