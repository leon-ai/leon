import { type WidgetWrapperProps } from '@leon-ai/aurora'

import { INTENT_OBJECT, SKILL_LOCALE_CONFIG } from '@bridge/constants'
import { WidgetComponent } from '@sdk/widget-component'

type UtteranceSender = 'leon' | 'owner'

interface SendUtteranceWidgetEventMethodParams {
  from: UtteranceSender
  utterance: string
}
interface RunSkillActionWidgetEventMethodParams {
  actionName: string
  params: Record<string, unknown>
}
interface SendUtteranceOptions {
  from?: UtteranceSender
  data?: Record<string, unknown>
}

export interface WidgetEventMethod {
  methodName: 'send_utterance' | 'run_skill_action'
  methodParams:
    | SendUtteranceWidgetEventMethodParams
    | RunSkillActionWidgetEventMethodParams
}
export interface WidgetOptions<T = unknown> {
  wrapperProps?: Omit<WidgetWrapperProps, 'children'>
  onFetch?: {
    widgetId?: string | undefined
    actionName: string
  }
  params: T
}

export abstract class Widget<T = unknown> {
  public actionName: string
  public id: string
  public widget: string
  public onFetch: WidgetOptions<T>['onFetch'] | null = null
  public wrapperProps: WidgetOptions<T>['wrapperProps']
  public params: WidgetOptions<T>['params']

  protected constructor(options: WidgetOptions<T>) {
    if (options?.wrapperProps) {
      this.wrapperProps = options.wrapperProps
    }
    this.actionName = `${INTENT_OBJECT.skill_name}:${INTENT_OBJECT.action_name}`
    this.params = options.params
    this.widget = this.constructor.name
    if (options?.onFetch) {
      this.onFetch = {
        widgetId: options.onFetch.widgetId,
        actionName: `${INTENT_OBJECT.skill_name}:${options.onFetch.actionName}`
      }
    }
    this.id =
      options.onFetch?.widgetId ||
      `${this.widget.toLowerCase()}-${Math.random()
        .toString(36)
        .substring(2, 10)}`
  }

  /**
   * Render the widget
   */
  public abstract render(): WidgetComponent<unknown>

  /**
   * Indicate the core to send a given utterance
   * @param key The key of the content
   * @param options The options of the utterance
   * @example content('provider_selected', { data: { provider: 'Spotify' } }) // 'I chose the Spotify provider'
   */
  protected sendUtterance(
    key: string,
    options?: SendUtteranceOptions
  ): WidgetEventMethod {
    const utteranceContent = this.content(key, options?.data)
    const from = options?.from || 'owner'

    return {
      methodName: 'send_utterance',
      methodParams: {
        from,
        utterance: utteranceContent
      }
    }
  }

  /**
   * Indicate the core to run a given skill action
   * @param actionName The name of the action
   * @param params The parameters of the action
   * @example runSkillAction('music_player_skill:next', { provider: 'Spotify' })
   */
  protected runSkillAction(
    actionName: string,
    params: Record<string, unknown>
  ): WidgetEventMethod {
    return {
      methodName: 'run_skill_action',
      methodParams: {
        actionName,
        params
      }
    }
  }

  /**
   * Grab and compute the target content of the widget
   * @param key The key of the content
   * @param data The data to apply
   * @example content('select_provider') // 'Please select a provider'
   * @example content('provider_selected', { provider: 'Spotify' }) // 'I chose the Spotify provider'
   */
  protected content(key: string, data?: Record<string, unknown>): string {
    const { widget_contents: widgetContents } = SKILL_LOCALE_CONFIG

    if (!widgetContents || !widgetContents[key]) {
      return 'INVALID'
    }

    let content = widgetContents[key]

    if (Array.isArray(content)) {
      content = content[Math.floor(Math.random() * content.length)] as string
    }

    if (data) {
      for (const key in data) {
        content = content.replaceAll(`{{ ${key} }}`, String(data[key]))
      }
    }

    return content
  }
}
