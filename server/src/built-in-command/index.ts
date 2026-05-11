import { BuiltInCommandManager } from '@/built-in-command/built-in-command-manager'
import { DownloadCommand } from '@/built-in-command/commands/download-command/download-command'
import { HelpCommand } from '@/built-in-command/commands/help-command/help-command'
import { ModelCommand } from '@/built-in-command/commands/model-command/model-command'
import { MoodCommand } from '@/built-in-command/commands/mood-command/mood-command'
import { RoutingCommand } from '@/built-in-command/commands/routing-command/routing-command'
import { SessionCommand } from '@/built-in-command/commands/session-command/session-command'
import { SkillCommand } from '@/built-in-command/commands/skill-command/skill-command'
import { StatusCommand } from '@/built-in-command/commands/status-command/status-command'
import { StopCommand } from '@/built-in-command/commands/stop-command/stop-command'
import { ToolCommand } from '@/built-in-command/commands/tool-command/tool-command'

const WHITELISTED_BUILT_IN_COMMAND_NAMES = [
  'status',
  'routing',
  'help',
  'download',
  'mood',
  'model',
  'session',
  'skill',
  'stop',
  'tool'
]

const BUILT_IN_COMMANDS = [
  new StatusCommand(),
  new RoutingCommand(),
  new DownloadCommand(),
  new MoodCommand(),
  new ModelCommand(),
  new SessionCommand(),
  new SkillCommand(),
  new StopCommand(),
  new ToolCommand(),
  new HelpCommand()
]
  .filter((command) =>
    WHITELISTED_BUILT_IN_COMMAND_NAMES.includes(command.getName())
  )

export const BUILT_IN_COMMAND_MANAGER = new BuiltInCommandManager(
  BUILT_IN_COMMANDS
)
