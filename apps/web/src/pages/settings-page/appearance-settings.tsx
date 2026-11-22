import { useState } from 'react'

import { Button } from '@/components/button'
import { getStoredAccent, getStoredColorScheme, saveAccent, saveColorScheme } from '@/theme'
import { ACCENT_COLORS } from '../../../../../bridges/runtime/contracts/workspace'
import '@/components/workspace-dialog/workspace-dialog.sass'
import { SettingRow, SettingSection } from './setting-section'

const COLOR_SCHEMES = [
  { id: 'system', label: 'System', icon: 'computer' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' }
] as const

/**
 * Keeps the initial appearance controls small and shares their palette with projects.
 */
export function AppearanceSettings() {
  const [scheme, setScheme] = useState(getStoredColorScheme)
  const [accent, setAccent] = useState(getStoredAccent)

  return <SettingSection title="Theme">
    <SettingRow id="settings-color-mode" label="Color mode" description="Choose a light or dark theme, or follow your system.">
      <div className="settings-theme">
        {COLOR_SCHEMES.map((option) => <Button key={option.id} size="sm" iconName={option.icon}
          variant={scheme === option.id ? 'secondary' : 'ghost'} ariaPressed={scheme === option.id}
          onClick={() => void saveColorScheme(option.id).then((applied) => {
            if (applied) {
              setScheme(option.id)
            }
          })}>{option.label}</Button>)}
      </div>
    </SettingRow>
    <SettingRow id="settings-accent-color" label="Accent color" description="Choose a highlight color for buttons and selected controls.">
      <div className="workspace-color-options">
        {ACCENT_COLORS.map((choice) => <Button key={choice.id} size="sm" ariaLabel={choice.label} tooltipMessage={choice.label}
          ariaPressed={accent === choice.id} className="workspace-color" onClick={() => {
            saveAccent(choice.id)
            setAccent(choice.id)
          }} icon={<span className="workspace-color-dot" data-workspace-color={choice.id} />} />)}
      </div>
    </SettingRow>
  </SettingSection>
}
