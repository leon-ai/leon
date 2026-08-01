import type { CSSProperties } from 'react'

import { Tooltip } from '../../../components/tooltip'

import './sidebar-footer.sass'

const DISCORD_URL = 'https://discord.gg/MNQqqKg'
const DEFAULT_MOOD = 'happy'
const LEON_VERSION = '2.0.0-alpha.1+dev'

export type Mood = 'sad' | 'cocky' | 'tired' | 'angry' | 'happy'

const MOOD_ASSET_PATHS: Record<Mood, string> = {
  sad: '/img/moods/sad.svg',
  cocky: '/img/moods/cocky.svg',
  tired: '/img/moods/tired.svg',
  angry: '/img/moods/angry.svg',
  happy: '/img/moods/happy.svg'
}

type MoodIconStyle = CSSProperties & {
  '--sidebar-footer-mood-icon': string
}

interface SidebarFooterProps {
  mood?: Mood
}

export function SidebarFooter({
  mood = DEFAULT_MOOD
}: SidebarFooterProps) {
  const moodLabel = `${mood.charAt(0).toUpperCase()}${mood.slice(1)} mood`
  const moodIconStyle: MoodIconStyle = {
    '--sidebar-footer-mood-icon': `url("${MOOD_ASSET_PATHS[mood]}")`
  }

  return (
    <footer className="sidebar-footer sidebar-footer-slot">
      <a
        className="sidebar-footer-link"
        href={DISCORD_URL}
        target="_blank"
        rel="noreferrer"
      >
        <i
          className="sidebar-footer-link-icon ri-discord-line"
          aria-hidden="true"
        />
        <span className="sidebar-footer-link-label">
          Join us on Discord
        </span>
      </a>
      <div className="sidebar-footer-status">
        <span className="sidebar-footer-status-label">
          {LEON_VERSION}
        </span>
        <div className="sidebar-footer-mood">
          <Tooltip message={moodLabel} position="right">
            <span
              className="sidebar-footer-mood-trigger"
              role="img"
              aria-label={moodLabel}
              tabIndex={0}
            >
              <span
                className="sidebar-footer-mood-icon"
                style={moodIconStyle}
                aria-hidden="true"
              />
            </span>
          </Tooltip>
        </div>
      </div>
    </footer>
  )
}
