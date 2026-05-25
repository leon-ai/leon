import {
  LEON_HOME_PATH,
  LEON_PROFILE_PATH,
  PROFILE_CONFIG_PATH,
  PROFILE_DOT_ENV_PATH
} from '@/constants'
import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { FileHelper } from '@/helpers/file-helper'

const OPEN_TARGETS = {
  config: {
    label: 'Profile config',
    path: PROFILE_CONFIG_PATH
  },
  secrets: {
    label: 'Profile secrets',
    path: PROFILE_DOT_ENV_PATH
  },
  profile: {
    label: 'Profile folder',
    path: LEON_PROFILE_PATH
  },
  home: {
    label: 'Leon home folder',
    path: LEON_HOME_PATH
  }
} as const

type OpenTargetName = keyof typeof OPEN_TARGETS

function getOpenTargetNames(): OpenTargetName[] {
  return Object.keys(OPEN_TARGETS) as OpenTargetName[]
}

export class OpenCommand extends BuiltInCommand {
  protected override description =
    'Open a Leon config, secrets, profile, or home path.'
  protected override icon_name = 'ri-folder-open-line'
  protected override supported_usages = ['/open', '/open <target>']
  protected override help_usage = '/open <target>'

  public constructor() {
    super('open')
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const currentArgument = context.args[0]?.toLowerCase() || ''

    return getOpenTargetNames()
      .filter((targetName) => targetName.startsWith(currentArgument))
      .map((targetName) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: targetName,
        description: `Open ${OPEN_TARGETS[targetName].label}.`,
        usage: `/open ${targetName}`,
        supported_usages: this.getSupportedUsages(),
        value: `/open ${targetName}`
      }))
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const requestedTarget = context.args[0]?.toLowerCase() || ''
    const target = OPEN_TARGETS[requestedTarget as OpenTargetName]

    if (!target) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unsupported Open Target',
          tone: 'error',
          items: [
            {
              label: requestedTarget
                ? `The open target "${requestedTarget}" is not supported.`
                : 'Missing open target.',
              tone: 'error'
            },
            {
              label: 'Available targets',
              value: getOpenTargetNames().join(', '),
              tone: 'error'
            }
          ]
        })
      }
    }

    try {
      const openedPath = await FileHelper.openPath(target.path)

      return {
        status: 'completed',
        result: createListResult({
          title: 'Path Opened',
          tone: 'success',
          items: [
            {
              label: `Opened ${target.label}`,
              value: openedPath,
              tone: 'success'
            }
          ]
        })
      }
    } catch (error) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Open Failed',
          tone: 'error',
          items: [
            {
              label: `Failed to open ${target.label}`,
              value: target.path,
              description: error instanceof Error ? error.message : String(error),
              tone: 'error'
            }
          ]
        })
      }
    }
  }
}
