import type { RoutingMode } from '@/types'

const COMMAND_PREFIX = '/'

export interface RequiredParameter {
  name: string
  questions: string[]
}

export interface BuiltInCommandAutocompleteContext {
  raw_input: string
  args: string[]
  ends_with_space: boolean
}

export interface BuiltInCommandAutocompleteItem {
  type: 'command' | 'parameter'
  icon_name: string
  name: string
  description: string
  usage: string
  supported_usages: string[]
  value: string
}

export interface BuiltInCommandPendingInput {
  name: string
  type: 'text' | 'password'
  placeholder: string
  prompt?: string
  icon_name?: string
  icon_type?: 'line' | 'fill' | 'notype'
}

export interface BuiltInCommandSession {
  id: string
  status: 'idle' | 'awaiting_required_parameters' | 'completed' | 'error'
  command_name: string | null
  raw_input: string
  loading_message: string | null
  required_parameters: string[]
  collected_parameters: Record<string, string>
  pending_input: BuiltInCommandPendingInput | null
}

export interface BuiltInCommandExecutionContext {
  raw_input: string
  args: string[]
  session: BuiltInCommandSession
  resolveCommands: () => BuiltInCommand[]
}

export interface BuiltInCommandPendingInputExecutionContext {
  input: string
  session: BuiltInCommandSession
  resolveCommands: () => BuiltInCommand[]
}

export interface BuiltInCommandLoadingMessageContext {
  raw_input: string
  args: string[]
}

export type BuiltInCommandResultTone = 'info' | 'success' | 'error'
export type BuiltInCommandRenderItemTone =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'

export interface BuiltInCommandRenderListItem {
  label: string
  value?: string
  href?: string
  inline_link_label?: string
  inline_link_href?: string
  description?: string
  tone?: BuiltInCommandRenderItemTone
}

export interface BuiltInCommandRenderBlock {
  type: 'list'
  header?: string
  items: BuiltInCommandRenderListItem[]
}

export interface BuiltInCommandResult {
  title: string
  tone: BuiltInCommandResultTone
  blocks: BuiltInCommandRenderBlock[]
  plain_text: string[]
}

export interface BuiltInCommandClientAction {
  type: 'submit_to_chat'
  utterance: string
  command_context: {
    forced_routing_mode?: RoutingMode
    forced_skill_name?: string
    forced_tool_name?: string
  }
}

export interface BuiltInCommandExecutionResult {
  status: 'completed' | 'awaiting_required_parameters' | 'error'
  result: BuiltInCommandResult
  session?: Partial<BuiltInCommandSession>
  client_action?: BuiltInCommandClientAction
}

export abstract class BuiltInCommand {
  protected description = ''
  protected required_parameters: RequiredParameter[] = []
  protected icon_name = 'ri-terminal-box-line'
  protected supported_usages: string[] = []
  protected help_usage = ''
  protected aliases: string[] = []

  public constructor(protected readonly name: string) {}

  public getName(): string {
    return this.name
  }

  public getDescription(): string {
    return this.description
  }

  public getRequiredParameters(): RequiredParameter[] {
    return [...this.required_parameters]
  }

  public getIconName(): string {
    return this.icon_name
  }

  public getAliases(): string[] {
    return [...this.aliases]
  }

  public getLoadingMessage(
    context: BuiltInCommandLoadingMessageContext
  ): string | null {
    void context

    return null
  }

  public getSupportedUsages(): string[] {
    if (this.supported_usages.length > 0) {
      return [...this.supported_usages]
    }

    return [`${COMMAND_PREFIX}${this.name}`]
  }

  public getPrimaryUsage(): string {
    return this.getSupportedUsages()[0] || `${COMMAND_PREFIX}${this.name}`
  }

  public getHelpUsage(): string {
    return this.help_usage || this.getPrimaryUsage()
  }

  public matchesName(commandName: string): boolean {
    const normalizedCommandName = commandName.trim().toLowerCase()

    return [this.name, ...this.aliases]
      .map((name) => name.toLowerCase())
      .includes(normalizedCommandName)
  }

  public getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    void context

    return []
  }

  public shouldIncludeCommandSuggestionInAutocomplete(
    context: BuiltInCommandAutocompleteContext
  ): boolean {
    void context

    return true
  }

  public shouldRankAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): boolean {
    void context

    return true
  }

  public async executePendingInput(
    context: BuiltInCommandPendingInputExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    void context

    throw new Error(`The command "${this.name}" does not accept extra input.`)
  }

  public abstract execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult>
}
