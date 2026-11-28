import { Icon } from '@/components/icon'
import type { CSSProperties, MouseEvent  } from 'react'
import { Link } from '@tanstack/react-router'

import { Tooltip } from '@/components/tooltip'
import { getPublicAssetPath, LEON_VERSION, LEON_VERSION_SUFFIX } from '@/config'
import { useAmbientConditions } from '@/data/ambient-conditions'
import { AppShortcutKey, getAppShortcutAria } from '@/utils/keyboard-shortcuts'

import './sidebar-footer.sass'

const DISCORD_URL = 'https://discord.gg/MNQqqKg'

export type Mood = 'sad' | 'cocky' | 'tired' | 'angry' | 'happy'

const MOOD_ASSET_PATHS: Record<Mood, string> = {
  sad: getPublicAssetPath('img/moods/sad.svg'),
  cocky: getPublicAssetPath('img/moods/cocky.svg'),
  tired: getPublicAssetPath('img/moods/tired.svg'),
  angry: getPublicAssetPath('img/moods/angry.svg'),
  happy: getPublicAssetPath('img/moods/happy.svg')
}

type MoodIconStyle = CSSProperties & {
  '--sidebar-footer-mood-icon': string
}

interface SidebarFooterProps {
  mood?: Mood
  onInsights: () => void
  onSettings: () => void
}

function openDialog(event: MouseEvent<HTMLAnchorElement>, open: () => void): void {
  if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    open()
  }
}

export function SidebarFooter({
  mood: previewMood, onInsights, onSettings
}: SidebarFooterProps) {
  const ambient = useAmbientConditions()
  const currentMood = ambient.data?.mood
  // Leon's upbeat default uses the existing happy artwork.
  const mood = previewMood ?? (currentMood === 'default' ? 'happy' : currentMood)
  const moodLabel = mood ? `${mood.charAt(0).toUpperCase()}${mood.slice(1)} mood` : 'Mood unavailable'
  const moodIconStyle: MoodIconStyle | undefined = mood ? {
    '--sidebar-footer-mood-icon': `url("${MOOD_ASSET_PATHS[mood]}")`
  } : undefined

  return (
    <footer className="sidebar-footer sidebar-footer-slot">
      <a
        className="sidebar-footer-link"
        href={DISCORD_URL}
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="discord-line" className="sidebar-footer-link-icon" />
        <span className="sidebar-footer-link-label">
          Join us on Discord
        </span>
      </a>
      <div className="sidebar-footer-status">
        <Tooltip message="Settings" position="right">
          <Link to="/settings" className="sidebar-footer-settings" aria-label="Settings" aria-keyshortcuts={getAppShortcutAria(AppShortcutKey.Settings)}
            onClick={(event) => openDialog(event, onSettings)}>
            <Icon name="settings-line" />
          </Link>
        </Tooltip>
        <Tooltip message="Insights" position="right">
          <Link to="/insights" className="sidebar-footer-settings" aria-label="Insights"
            onClick={(event) => openDialog(event, onInsights)}>
            <Icon name="trend-chart-line" />
          </Link>
        </Tooltip>
        <span className="sidebar-footer-status-label">
          <span className="sidebar-footer-version">
            {LEON_VERSION}
            {LEON_VERSION_SUFFIX && <><wbr />{LEON_VERSION_SUFFIX}</>}
          </span>
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
