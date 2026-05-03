import fs from 'node:fs'

import { PROFILE_RECENTLY_USED_COMMANDS_FILE_PATH } from '@/constants'
import { StringHelper } from '@/helpers/string-helper'
import {
  type BuiltInCommand,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandSession
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'

const COMMAND_PREFIX = '/'
const MAX_RECENT_COMMANDS = 3
const WHITESPACE_PATTERN = /\s+/

interface ParsedBuiltInCommandInput {
  raw_input: string
  normalized_input: string
  command_name: string
  args: string[]
  ends_with_space: boolean
  has_command_prefix: boolean
}

export interface BuiltInCommandAutocompleteResponse {
  mode: 'autocomplete'
  session: BuiltInCommandSession
  suggestions: BuiltInCommandAutocompleteItem[]
  recent_suggestions: BuiltInCommandAutocompleteItem[]
}

export interface BuiltInCommandExecuteResponse {
  mode: 'execute'
  session: BuiltInCommandSession
  status: BuiltInCommandExecutionResult['status']
  result: BuiltInCommandExecutionResult['result']
  suggestions: BuiltInCommandAutocompleteItem[]
  recent_suggestions: BuiltInCommandAutocompleteItem[]
  client_action?: BuiltInCommandExecutionResult['client_action']
}

export class BuiltInCommandManager {
  private readonly sessions = new Map<string, BuiltInCommandSession>()

  public constructor(private readonly commands: BuiltInCommand[]) {}

  public listCommands(): BuiltInCommand[] {
    return [...this.commands]
  }

  public autocomplete(
    rawInput: string,
    sessionId?: string
  ): BuiltInCommandAutocompleteResponse {
    const session = this.getSession(sessionId)
    const parsedInput = this.parseInput(rawInput)

    if (
      !(
        session.status === 'awaiting_required_parameters' &&
        session.pending_input &&
        !parsedInput.has_command_prefix
      )
    ) {
      session.raw_input = parsedInput.normalized_input
      session.command_name = parsedInput.command_name || null
      session.loading_message = null
    }

    if (
      session.status === 'awaiting_required_parameters' &&
      session.pending_input &&
      !parsedInput.has_command_prefix
    ) {
      return {
        mode: 'autocomplete',
        session,
        suggestions: [],
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    if (!parsedInput.has_command_prefix) {
      return {
        mode: 'autocomplete',
        session,
        suggestions: [],
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    if (!parsedInput.command_name) {
      return {
        mode: 'autocomplete',
        session,
        suggestions: this.sortSuggestionsAlphabetically(
          this.commands.map((command) => this.toCommandSuggestion(command))
        ),
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    const exactCommand = this.getCommand(parsedInput.command_name)

    if (exactCommand) {
      session.loading_message = exactCommand.getLoadingMessage({
        raw_input: parsedInput.normalized_input,
        args: parsedInput.args
      })
    }

    if (!exactCommand) {
      return {
        mode: 'autocomplete',
        session,
        suggestions: this.rankSuggestions(
          this.commands
            .filter((command) =>
              this.getCommandSearchTokens(command).some((token) =>
                token.startsWith(parsedInput.command_name.toLowerCase())
              )
            )
            .map((command) => this.toCommandSuggestion(command)),
          parsedInput
        ),
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    const autocompleteContext = {
      raw_input: parsedInput.normalized_input,
      args: parsedInput.args,
      ends_with_space: parsedInput.ends_with_space
    }
    const suggestions = [
      ...(exactCommand.shouldIncludeCommandSuggestionInAutocomplete(
        autocompleteContext
      )
        ? [this.toCommandSuggestion(exactCommand)]
        : []),
      ...exactCommand.getAutocompleteItems(autocompleteContext)
    ]
    const dedupedSuggestions = this.dedupeSuggestions(suggestions)

    return {
      mode: 'autocomplete',
      session,
      suggestions: exactCommand.shouldRankAutocompleteItems(autocompleteContext)
        ? this.rankSuggestions(dedupedSuggestions, parsedInput)
        : this.sortSuggestionsAlphabetically(dedupedSuggestions),
      recent_suggestions: this.getRecentSuggestions()
    }
  }

  public async execute(
    rawInput: string,
    sessionId?: string
  ): Promise<BuiltInCommandExecuteResponse> {
    const session = this.getSession(sessionId)
    const parsedInput = this.parseInput(rawInput)

    if (
      session.status === 'awaiting_required_parameters' &&
      session.pending_input &&
      !parsedInput.has_command_prefix
    ) {
      return this.executePendingInput(session, rawInput)
    }

    session.raw_input = parsedInput.normalized_input
    session.command_name = parsedInput.command_name || null
    session.loading_message = null
    session.required_parameters = []
    session.collected_parameters = {}
    session.pending_input = null

    if (!parsedInput.has_command_prefix || !parsedInput.command_name) {
      session.status = 'error'

      return {
        mode: 'execute',
        session,
        status: 'error',
        result: createListResult({
          title: 'Invalid Command',
          tone: 'error',
          items: [
            {
              label: 'Built-in commands must start with "/".',
              tone: 'error'
            },
            {
              label: 'Use /help to inspect the supported commands.',
              tone: 'error'
            }
          ]
        }),
        suggestions: [],
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    const command = this.getCommand(parsedInput.command_name)

    if (!command) {
      session.status = 'error'

      return {
        mode: 'execute',
        session,
        status: 'error',
        result: createListResult({
          title: 'Unknown Command',
          tone: 'error',
          items: [
            {
              label: `The command "${parsedInput.command_name}" is not supported.`,
              tone: 'error'
            },
            {
              label: 'Use /help to inspect the supported commands.',
              tone: 'error'
            }
          ]
        }),
        suggestions: this.autocomplete(parsedInput.normalized_input, session.id)
          .suggestions,
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    session.command_name = command.getName()
    session.loading_message = command.getLoadingMessage({
      raw_input: parsedInput.normalized_input,
      args: parsedInput.args
    })
    session.required_parameters = command
      .getRequiredParameters()
      .map((parameter) => parameter.name)

    const executionResult = await command.execute({
      raw_input: parsedInput.normalized_input,
      args: parsedInput.args,
      session,
      resolveCommands: () => this.listCommands()
    })

    if (executionResult.session) {
      Object.assign(session, executionResult.session)
    }

    session.status =
      executionResult.status === 'awaiting_required_parameters'
        ? 'awaiting_required_parameters'
        : executionResult.status === 'error'
          ? 'error'
          : 'completed'

    if (executionResult.status === 'completed') {
      this.persistRecentCommandValue(parsedInput.normalized_input)
    }

    return {
      mode: 'execute',
      session,
      status: executionResult.status,
      result: executionResult.result,
      ...(executionResult.client_action
        ? { client_action: executionResult.client_action }
        : {}),
      suggestions:
        executionResult.status === 'awaiting_required_parameters'
          ? command.getAutocompleteItems({
              raw_input: parsedInput.normalized_input,
              args: parsedInput.args,
              ends_with_space: parsedInput.ends_with_space
            })
          : [],
      recent_suggestions: this.getRecentSuggestions()
    }
  }

  private async executePendingInput(
    session: BuiltInCommandSession,
    rawInput: string
  ): Promise<BuiltInCommandExecuteResponse> {
    const command = session.command_name
      ? this.getCommand(session.command_name)
      : null

    if (!command) {
      session.status = 'error'
      session.pending_input = null

      return {
        mode: 'execute',
        session,
        status: 'error',
        result: createListResult({
          title: 'Command Session Error',
          tone: 'error',
          items: [
            {
              label: 'The built-in command session is no longer available.',
              tone: 'error'
            }
          ]
        }),
        suggestions: [],
        recent_suggestions: this.getRecentSuggestions()
      }
    }

    const executionResult = await command.executePendingInput({
      input: rawInput,
      session,
      resolveCommands: () => this.listCommands()
    })

    if (executionResult.session) {
      Object.assign(session, executionResult.session)
    }

    session.status =
      executionResult.status === 'awaiting_required_parameters'
        ? 'awaiting_required_parameters'
        : executionResult.status === 'error'
          ? 'error'
          : 'completed'

    if (executionResult.status === 'completed') {
      this.persistRecentCommandValue(session.raw_input)
    }

    return {
      mode: 'execute',
      session,
      status: executionResult.status,
      result: executionResult.result,
      ...(executionResult.client_action
        ? { client_action: executionResult.client_action }
        : {}),
      suggestions: [],
      recent_suggestions: this.getRecentSuggestions()
    }
  }

  private getSession(sessionId?: string): BuiltInCommandSession {
    const resolvedSessionId = sessionId || this.createSessionId()
    const existingSession = this.sessions.get(resolvedSessionId)

    if (existingSession) {
      return existingSession
    }

    const session: BuiltInCommandSession = {
      id: resolvedSessionId,
      status: 'idle',
      command_name: null,
      raw_input: '',
      loading_message: null,
      required_parameters: [],
      collected_parameters: {},
      pending_input: null
    }

    this.sessions.set(resolvedSessionId, session)

    return session
  }

  private createSessionId(): string {
    return `cmd-${Date.now()}-${StringHelper.random(6)}`
  }

  private getRecentSuggestions(): BuiltInCommandAutocompleteItem[] {
    return this.readRecentCommandValues()
      .map((commandInput) => this.resolveSuggestionByInput(commandInput))
      .filter(
        (
          suggestion
        ): suggestion is BuiltInCommandAutocompleteItem => suggestion !== null
      )
  }

  private getCommand(commandName: string): BuiltInCommand | null {
    return (
      this.commands.find((command) => command.matchesName(commandName)) || null
    )
  }

  private resolveSuggestionByInput(
    rawInput: string
  ): BuiltInCommandAutocompleteItem | null {
    const parsedInput = this.parseInput(rawInput)

    if (!parsedInput.has_command_prefix || !parsedInput.command_name) {
      return null
    }

    const command = this.getCommand(parsedInput.command_name)

    if (!command) {
      return null
    }

    if (parsedInput.args.length === 0) {
      return this.toCommandSuggestion(command)
    }

    const normalizedInput = parsedInput.normalized_input.toLowerCase()

    const autocompleteContext = {
      raw_input: parsedInput.normalized_input,
      args: parsedInput.args,
      ends_with_space: parsedInput.ends_with_space
    }

    return (
      command
        .getAutocompleteItems(autocompleteContext)
        .find((suggestion) => suggestion.value.toLowerCase() === normalizedInput) ||
      null
    )
  }

  private getCommandSearchTokens(command: BuiltInCommand): string[] {
    return [command.getName(), ...command.getAliases()].map((token) =>
      token.toLowerCase()
    )
  }

  private toCommandSuggestion(
    command: BuiltInCommand
  ): BuiltInCommandAutocompleteItem {
    return {
      type: 'command',
      icon_name: command.getIconName(),
      name: command.getName(),
      description: command.getDescription(),
      usage: command.getPrimaryUsage(),
      supported_usages: command.getSupportedUsages(),
      value: command.getPrimaryUsage()
    }
  }

  private dedupeSuggestions(
    suggestions: BuiltInCommandAutocompleteItem[]
  ): BuiltInCommandAutocompleteItem[] {
    const uniqueSuggestions = new Map<string, BuiltInCommandAutocompleteItem>()

    for (const suggestion of suggestions) {
      uniqueSuggestions.set(`${suggestion.type}:${suggestion.value}`, suggestion)
    }

    return [...uniqueSuggestions.values()]
  }

  private rankSuggestions(
    suggestions: BuiltInCommandAutocompleteItem[],
    parsedInput: ParsedBuiltInCommandInput
  ): BuiltInCommandAutocompleteItem[] {
    const normalizedInput = parsedInput.normalized_input.toLowerCase()

    return [...suggestions].sort((firstSuggestion, secondSuggestion) => {
      const scoreDifference =
        this.getSuggestionScore(secondSuggestion, normalizedInput) -
        this.getSuggestionScore(firstSuggestion, normalizedInput)

      if (scoreDifference !== 0) {
        return scoreDifference
      }

      return firstSuggestion.usage.localeCompare(secondSuggestion.usage)
    })
  }

  private sortSuggestionsAlphabetically(
    suggestions: BuiltInCommandAutocompleteItem[]
  ): BuiltInCommandAutocompleteItem[] {
    return [...suggestions].sort((firstSuggestion, secondSuggestion) =>
      firstSuggestion.usage.localeCompare(secondSuggestion.usage)
    )
  }

  private getSuggestionScore(
    suggestion: BuiltInCommandAutocompleteItem,
    normalizedInput: string
  ): number {
    const normalizedUsage = suggestion.usage.toLowerCase()
    const normalizedValue = suggestion.value.toLowerCase()
    const normalizedName = suggestion.name.toLowerCase()
    let score = 0

    if (normalizedValue === normalizedInput || normalizedUsage === normalizedInput) {
      score += 1_000
    }

    if (normalizedValue.startsWith(normalizedInput)) {
      score += 800 - (normalizedValue.length - normalizedInput.length)
    }

    if (normalizedUsage.startsWith(normalizedInput)) {
      score += 760 - (normalizedUsage.length - normalizedInput.length)
    }

    if (normalizedInput.startsWith(normalizedValue)) {
      score += 520 + normalizedValue.length
    }

    if (normalizedInput.includes(normalizedName)) {
      score += 120
    }

    if (suggestion.type === 'parameter') {
      score += 40
    }

    return score
  }

  private readRecentCommandValues(): string[] {
    if (!fs.existsSync(PROFILE_RECENTLY_USED_COMMANDS_FILE_PATH)) {
      return []
    }

    try {
      return fs
        .readFileSync(PROFILE_RECENTLY_USED_COMMANDS_FILE_PATH, 'utf8')
        .split('\n')
        .map((commandValue) => commandValue.trim())
        .filter(Boolean)
        .slice(0, MAX_RECENT_COMMANDS)
    } catch {
      return []
    }
  }

  private persistRecentCommandValue(commandValue: string): void {
    const normalizedCommandValue = commandValue.trim()
    const nextRecentCommandValues = [
      normalizedCommandValue,
      ...this.readRecentCommandValues().filter(
        (recentCommandValue) => recentCommandValue !== normalizedCommandValue
      )
    ].slice(0, MAX_RECENT_COMMANDS)

    try {
      fs.writeFileSync(
        PROFILE_RECENTLY_USED_COMMANDS_FILE_PATH,
        `${nextRecentCommandValues.join('\n')}\n`,
        'utf8'
      )
    } catch {
      // Ignore recent-history persistence errors to avoid blocking commands.
    }
  }

  private parseInput(rawInput: string): ParsedBuiltInCommandInput {
    const rawInputString = String(rawInput || '')
    const normalizedInput = rawInputString
      .trimStart()
      .replace(WHITESPACE_PATTERN, ' ')
    const hasCommandPrefix = normalizedInput.startsWith(COMMAND_PREFIX)
    const endsWithSpace = /\s$/.test(rawInput)

    if (!hasCommandPrefix) {
      return {
        raw_input: rawInputString,
        normalized_input: normalizedInput,
        command_name: '',
        args: [],
        ends_with_space: endsWithSpace,
        has_command_prefix: false
      }
    }

    const inputBody = normalizedInput.slice(COMMAND_PREFIX.length).trim()

    if (!inputBody) {
      return {
        raw_input: rawInputString,
        normalized_input: normalizedInput,
        command_name: '',
        args: [],
        ends_with_space: endsWithSpace,
        has_command_prefix: true
      }
    }

    const [commandName, ...args] = inputBody
      .split(WHITESPACE_PATTERN)
      .filter(Boolean)

    return {
      raw_input: rawInputString,
      normalized_input: normalizedInput,
      command_name: (commandName || '').toLowerCase(),
      args,
      ends_with_space: endsWithSpace,
      has_command_prefix: true
    }
  }
}
