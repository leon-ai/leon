export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings-line', description: 'Language, time zone and default interaction mode.' },
  { id: 'appearance', label: 'Appearance', icon: 'sun-line', description: 'A space that feels comfortable to you.' },
  { id: 'models', label: 'Models', icon: 'cpu-line', description: 'Providers, default models, reasoning and service tier.' },
  { id: 'tools', label: 'Tools and connections', icon: 'plug-line', description: 'Choose the tools and accounts I can work with.' },
  { id: 'skills', label: 'Skills', icon: 'function-line', description: 'Installed skills and their availability.' },
  { id: 'voice', label: 'Voice', icon: 'mic-2-line', description: 'Speech recognition, speech output and wake word.' },
  { id: 'personality', label: 'Personality and memory', icon: 'home-smile-2-line', description: 'Mood, memory, private diary and learning preferences.' },
  { id: 'devices', label: 'Devices', icon: 'computer-line', description: 'Satellite devices and where your tools run.' },
  { id: 'usage', label: 'Usage', icon: 'pulse-line', description: 'Token usage and model activity.' },
  { id: 'privacy', label: 'Privacy and security', icon: 'eye-2-line', description: 'Telemetry, authentication and trusted origins.' },
  { id: 'advanced', label: 'Advanced', icon: 'list-settings-line', description: 'Execution limits, server configuration and diagnostics.' }
] as const
