import { useState } from 'react'

import { Button } from '@/components/button'
import { useTheme } from '@/hooks/use-theme'
import { getStoredAccent, getStoredSoundsEnabled, saveAccent, saveSoundsEnabled, toggleTheme } from '@/theme'
import { ACCENT_COLORS } from '../../../../../bridges/runtime/contracts/workspace'
import { previewCompletionSound } from '@/utils/sounds'
import '@/components/workspace-dialog/workspace-dialog.sass'

/**
 * Keeps the initial appearance controls small and shares their palette with projects.
 */
export function AppearanceSettings() {
  const theme = useTheme({ includeRequested: true })
  const [accent, setAccent] = useState(getStoredAccent)
  const [sounds, setSounds] = useState(getStoredSoundsEnabled)

  return <div className="workspace-editor">
    <div role="group" aria-label="Theme">
      <Button className="sidebar-theme-toggle" iconName={theme === 'dark' ? 'moon' : 'sun'}
        tooltipMessage={theme === 'dark' ? 'Apply light theme' : 'Apply dark theme'} onClick={toggleTheme} />
    </div>
    <fieldset><legend>Accent color</legend><div className="workspace-color-options">
      {ACCENT_COLORS.map((choice) => <Button key={choice.id} size="sm" ariaLabel={choice.label} tooltipMessage={choice.label}
        ariaPressed={accent === choice.id} className="workspace-color" onClick={() => {
          saveAccent(choice.id)
          setAccent(choice.id)
        }} icon={<span className="workspace-color-dot" data-workspace-color={choice.id} />} />)}
    </div></fieldset>
    <fieldset><legend>Sounds</legend>
      <Button iconName={sounds ? 'volume-up' : 'volume-mute'} ariaPressed={sounds}
        tooltipMessage={sounds ? 'Mute sounds' : 'Unmute sounds'} onClick={() => {
        saveSoundsEnabled(!sounds)
        setSounds(!sounds)
      }} />
      <div className="appearance-sound-previews">
        <Button disabled={!sounds} onClick={previewCompletionSound}>Preview completion sound</Button>
      </div>
    </fieldset>
  </div>
}
