interface SettingsTarget {
  id: string
  label: string
  aliases: readonly string[]
}

interface SettingsCategory {
  id: string
  label: string
  icon: string
  aliases: readonly string[]
  targets: readonly SettingsTarget[]
}

export const SETTINGS_SECTIONS: readonly SettingsCategory[] = [
  { id: 'general', label: 'General', icon: 'equalizer-2-line',
    aliases: ['language', 'locale', 'timezone', 'preferences'], targets: [
      { id: 'sounds', label: 'App sounds', aliases: ['sound effects', 'mute', 'notifications'] },
      { id: 'completion-sound', label: 'Completion sound', aliases: ['preview completion sound', 'completion chime'] }
    ] },
  { id: 'appearance', label: 'Appearance', icon: 'palette-line',
    aliases: ['visuals', 'display', 'look and feel'], targets: [
      { id: 'color-mode', label: 'Color mode', aliases: ['theme', 'color scheme', 'dark mode', 'light mode', 'system theme'] },
      { id: 'accent-color', label: 'Accent color', aliases: ['primary color', 'highlight color', 'theme color', 'palette'] }
    ] },
  { id: 'models', label: 'Models', icon: 'cpu-line',
    aliases: ['LLM', 'AI provider', 'reasoning', 'service tier'], targets: [] },
  { id: 'tools', label: 'Tools and connections', icon: 'plug-line',
    aliases: ['integrations', 'accounts', 'plugins'], targets: [
      { id: 'tool-catalog', label: 'Tool catalog', aliases: ['available tools', 'MCP servers', 'connections'] }
    ] },
  { id: 'skills', label: 'Skills', icon: 'function-line',
    aliases: ['capabilities', 'extensions'], targets: [
      { id: 'skill-catalog', label: 'Skill catalog', aliases: ['installed skills', 'available skills'] }
    ] },
  { id: 'voice', label: 'Voice', icon: 'mic-2-line',
    aliases: ['microphone', 'speech', 'wake word'], targets: [] },
  { id: 'personality', label: 'Personality and memory', icon: 'home-smile-2-line',
    aliases: ['persona', 'remember', 'mood', 'learning'], targets: [] },
  { id: 'devices', label: 'Devices', icon: 'computer-line',
    aliases: ['satellite', 'computer', 'hardware'], targets: [] },
  { id: 'privacy', label: 'Privacy and security', icon: 'eye-2-line',
    aliases: ['security', 'authentication', 'trusted origins'], targets: [
      { id: 'usage-sharing', label: 'Share usage metrics', aliases: ['telemetry', 'anonymous analytics', 'usage sharing', 'data collection'] }
    ] },
  { id: 'advanced', label: 'Advanced', icon: 'list-settings-line',
    aliases: ['server configuration', 'diagnostics', 'execution limits'], targets: [] }
]

/**
 * Deep links resolve to a settings category or one of its published sections.
 */
export function isSettingsPath(section: string, target?: string): boolean {
  const category = SETTINGS_SECTIONS.find(({ id }) => id === section)
  return Boolean(category && (target === undefined || category.targets.some(({ id }) => id === target)))
}
