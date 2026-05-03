import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { CONFIG_STATE } from '@/core/config-states/config-state'

const AUTO_MOOD_VALUE = 'auto'

export class MoodCommand extends BuiltInCommand {
  protected override description =
    'Display or change Leon mood behavior.'
  protected override icon_name = 'ri-emotion-line'
  protected override supported_usages = ['/mood', '/mood <auto|default|tired|cocky|sad|angry>']
  protected override help_usage = '/mood <auto|default|tired|cocky|sad|angry>'

  public constructor() {
    super('mood')
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const moodState = CONFIG_STATE.getMoodState()
    const currentArgument = context.args[0]?.toLowerCase() || ''

    return moodState
      .getSupportedMoodValues()
      .filter((moodValue) => moodValue.startsWith(currentArgument))
      .map((moodValue) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: moodValue,
        description:
          moodValue === AUTO_MOOD_VALUE
            ? 'Keep Leon mood on automatic behavior.'
            : `Force Leon mood to "${moodValue}".`,
        usage: `/mood ${moodValue}`,
        supported_usages: this.getSupportedUsages(),
        value: `/mood ${moodValue}`
      }))
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const moodState = CONFIG_STATE.getMoodState()
    const requestedMood = context.args[0]?.toLowerCase()

    if (!requestedMood) {
      return {
        status: 'completed',
        result: createListResult({
          title: 'Leon Mood',
          tone: 'info',
          items: [
            {
              label: 'Current mood',
              value: moodState.getCurrentMood()
            },
            {
              label: 'Mood mode',
              value: moodState.isAutomatic()
                ? 'auto'
                : `forced (${moodState.getConfiguredMood()})`
            },
            {
              label: 'Available mood values',
              value: moodState.getSupportedMoodValues().join(', ')
            }
          ]
        })
      }
    }

    const normalizedMood =
      moodState
        .getSupportedMoodValues()
        .find((moodValue) => moodValue === requestedMood) || null

    if (!normalizedMood) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unsupported Mood',
          tone: 'error',
          items: [
            {
              label: `The mood "${requestedMood}" is not supported.`,
              tone: 'error'
            },
            {
              label: 'Available mood values',
              value: moodState.getSupportedMoodValues().join(', '),
              tone: 'error'
            }
          ]
        })
      }
    }

    const nextConfiguredMood = await moodState.setConfiguredMood(normalizedMood)

    return {
      status: 'completed',
      result: createListResult({
        title: 'Leon Mood Updated',
        tone: 'success',
        items: [
          {
            label:
              nextConfiguredMood === AUTO_MOOD_VALUE
                ? `Leon mood is now automatic. Current mood: "${moodState.getCurrentMood()}".`
                : `Leon mood is now forced to "${moodState.getCurrentMood()}".`,
            tone: 'success'
          }
        ]
      })
    }
  }
}
