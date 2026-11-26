import { useState } from 'react'

import { Button } from '@/components/button'
import { getStoredSoundsEnabled, saveSoundsEnabled } from '@/theme'
import { previewCompletionSound } from '@/utils/sounds'

import { SettingRow, SettingSection } from './setting-section'

/**
 * Applies desktop and browser sound preferences as soon as they change.
 */
export function GeneralSettings() {
  const [sounds, setSounds] = useState(getStoredSoundsEnabled)

  return <SettingSection title="Sounds">
    <SettingRow id="settings-sounds" label="App sounds" description="Play a sound when I finish a response.">
      <Button iconName={sounds ? 'volume-up' : 'volume-mute'} ariaPressed={sounds}
        tooltipMessage={sounds ? 'Mute sounds' : 'Unmute sounds'} onClick={() => {
          saveSoundsEnabled(!sounds)
          setSounds(!sounds)
        }} />
    </SettingRow>
    <SettingRow id="settings-completion-sound" label="Completion sound" description="Hear the sound I play when I finish a response.">
      <Button size="sm" disabled={!sounds} onClick={previewCompletionSound}>Preview completion sound</Button>
    </SettingRow>
  </SettingSection>
}
