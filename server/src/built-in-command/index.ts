import { BuiltInCommandManager } from '@/built-in-command/built-in-command-manager'
import { DownloadCommand } from '@/built-in-command/commands/download-command/download-command'
import { HelpCommand } from '@/built-in-command/commands/help-command/help-command'
import { ModelCommand } from '@/built-in-command/commands/model-command/model-command'
import { MoodCommand } from '@/built-in-command/commands/mood-command/mood-command'
import { OpenCommand } from '@/built-in-command/commands/open-command/open-command'
import { RestartCommand } from '@/built-in-command/commands/restart-command/restart-command'
import { RoutingCommand } from '@/built-in-command/commands/routing-command/routing-command'
import { SessionCommand } from '@/built-in-command/commands/session-command/session-command'
import { SkillCommand } from '@/built-in-command/commands/skill-command/skill-command'
import { StatusCommand } from '@/built-in-command/commands/status-command/status-command'
import { StopCommand } from '@/built-in-command/commands/stop-command/stop-command'
import { ToolCommand } from '@/built-in-command/commands/tool-command/tool-command'
import { VoiceCommand } from '@/built-in-command/commands/voice-command/voice-command'

const WHITELISTED_BUILT_IN_COMMAND_NAMES = [
  'status',
  'open',
  'routing',
  'help',
  'download',
  'mood',
  'model',
  'restart',
  'session',
  'skill',
  'stop',
  'tool',
  'voice'
]

const BUILT_IN_COMMANDS = [
  new StatusCommand(),
  new OpenCommand(),
  new RoutingCommand(),
  new DownloadCommand(),
  new MoodCommand(),
  new ModelCommand(),
  new RestartCommand(),
  new SessionCommand(),
  new SkillCommand(),
  new StopCommand(),
  new ToolCommand(),
  new VoiceCommand(),
  new HelpCommand()
]
  .filter((command) =>
    WHITELISTED_BUILT_IN_COMMAND_NAMES.includes(command.getName())
  )

export const BUILT_IN_COMMAND_MANAGER = new BuiltInCommandManager(
  BUILT_IN_COMMANDS
)
