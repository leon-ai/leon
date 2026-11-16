import { COMPLETION_SOUND } from '@/utils/sounds'
import { getPublicAssetPath } from '@/config'

/**
 * Auditions the bundled completion cue independently of conversation activity.
 */
export default function SoundsPreview() {
  return <section aria-label="Sounds preview">
    <p className="gallery-notice">Goodnight — created by Leon for its own turn completion cue.</p>
    <div className="gallery-grid">
      <article className="gallery-example sound-preview">
        <h2>{COMPLETION_SOUND.label}</h2>
        <audio controls preload="none" aria-label={COMPLETION_SOUND.label} src={getPublicAssetPath(COMPLETION_SOUND.file)} />
        <a href={getPublicAssetPath(COMPLETION_SOUND.file)} download>{COMPLETION_SOUND.file.split('/').at(-1)}</a>
      </article>
    </div>
  </section>
}
