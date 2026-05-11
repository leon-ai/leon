import type {
  BuiltInCommandAutocompleteContext,
  BuiltInCommandAutocompleteItem,
  BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'

export interface ToolSubCommandExecutionContext {
  rawToolName: string
}

export interface ToolSubCommand {
  readonly name: string
  readonly description: string
  readonly iconName: string
  getSuggestion(input: {
    commandPrefix: string
    supportedUsages: string[]
  }): BuiltInCommandAutocompleteItem
  getAutocompleteItems(input: {
    context: BuiltInCommandAutocompleteContext
    supportedUsages: string[]
  }): BuiltInCommandAutocompleteItem[]
  execute(
    context: ToolSubCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult>
}
