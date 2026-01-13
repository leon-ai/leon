import type { ActionParams, NEREntity } from '@sdk/types'
import { INTENT_OBJECT } from '@bridge/constants'

export class ParamsHelper {
  private readonly params: ActionParams

  constructor(params: ActionParams) {
    this.params = params
  }

  /**
   * Get the widget id if any
   * @example getWidgetId() // 'timerwidget-5q1xlzeh
   */
  getWidgetId(): string | null {
    return (
      INTENT_OBJECT.entities?.find((entity) => entity.entity === 'widgetid')
        ?.sourceText ?? null
    )
  }

  /**
   * Get a specific action argument from the current turn by its name
   * @param name The name of the action argument to retrieve
   */
  getActionArgument(name: string): string | undefined {
    return this.params.action_arguments[name] as string | undefined
  }

  /**
   * Find the first entity in the current turn that matches the given name
   * @param entityName The name of the entity to find (e.g., 'language', 'date')
   */
  findEntity(entityName: string): NEREntity | undefined {
    return this.params.entities.find((entity) => entity.entity === entityName)
  }

  /**
   * Find the last entity in the current turn that matches the given name
   * Useful when an utterance contains duplicates
   * @param entityName The name of the entity to find (e.g., 'color')
   */
  findLastEntity(entityName: string): NEREntity | undefined {
    return [...this.params.entities]
      .reverse()
      .find((entity) => entity.entity === entityName)
  }

  /**
   * Find all entities in the current turn that match the given name
   * @param entityName The name of the entities to find (e.g., 'date')
   */
  findAllEntities(entityName: string): NEREntity[] {
    return this.params.entities.filter((entity) => entity.entity === entityName)
  }

  /**
   * Find the first action argument in the conversation context that matches the given name
   * @param name The name of the action argument to find
   */
  findActionArgumentFromContext(name: string): string | undefined {
    for (const args of this.params.context.action_arguments) {
      if (args && name in args) {
        return args[name] as string | undefined
      }
    }

    return undefined
  }

  /**
   * Find the most recent value for a given action argument from the conversation context.
   * It searches backwards from the most recent turn
   * @param name The name of the action argument to find
   */
  findLastActionArgumentFromContext(name: string): string | undefined {
    // Iterate backwards through the history of action arguments
    for (
      let i = this.params.context.action_arguments.length - 1;
      i >= 0;
      i -= 1
    ) {
      const args = this.params.context.action_arguments[i]

      if (args && name in args) {
        return args[name] as string | undefined
      }
    }

    return undefined
  }

  /**
   * Find the most recently detected entity (the last one from the context) that matches the given name.
   * This is useful for recalling the last time an owner mentioned a specific piece of information
   * @param entityName The name of the entity to find in the conversation history
   */
  findLastEntityFromContext(entityName: string): NEREntity | undefined {
    // The context.entities are stored chronologically, so reversing and finding the first is correct
    return [...this.params.context.entities]
      .reverse()
      .find((entity) => entity.entity === entityName)
  }

  /**
   * Find all historical entities that match the given name from the entire conversation context
   * @param entityName The name of the entities to find in the conversation history
   */
  findAllEntitiesFromContext(entityName: string): NEREntity[] {
    return this.params.context.entities.filter(
      (entity) => entity.entity === entityName
    )
  }

  /**
   * Get a value stored in the generic context data store
   * @param key The key to retrieve
   */
  getContextData<T = unknown>(key: string): T | undefined {
    return this.params.context.data?.[key] as T | undefined
  }
}
