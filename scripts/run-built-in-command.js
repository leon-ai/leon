import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { BUILT_IN_COMMAND_MANAGER } from '@/built-in-command'

const TERMINAL_ARG_START_INDEX = 2
const COMMAND_ARG_DELIMITER = ' '
const PNPM_ARGS_SEPARATOR = '--'
const COMMAND_PREFIX = '/'
const DISALLOWED_TERMINAL_COMMANDS = new Set(['skill', 's'])
const TOOL_TERMINAL_COMMANDS = new Set(['tool', 't'])
const SUPPORTED_TOOL_TERMINAL_SUBCOMMANDS = new Set([
  'list',
  'enable',
  'disable'
])

function printResult(response) {
  for (const line of response.result.plain_text) {
    console.log(line)
  }
}

async function run() {
  const rawInput = process.argv
    .slice(TERMINAL_ARG_START_INDEX)
    .filter((argument) => argument !== PNPM_ARGS_SEPARATOR)
    .join(COMMAND_ARG_DELIMITER)
    .trim()
  const [commandName] = rawInput.split(COMMAND_ARG_DELIMITER).filter(Boolean)
  const [, subcommandName = ''] = rawInput
    .split(COMMAND_ARG_DELIMITER)
    .filter(Boolean)

  if (!rawInput) {
    console.error('Please provide a built-in command. Example: pnpm cmd help')
    process.exitCode = 1
    return
  }

  if (rawInput.startsWith(COMMAND_PREFIX)) {
    console.error('Please run built-in commands without "/". Example: pnpm cmd help')
    process.exitCode = 1
    return
  }

  if (
    commandName &&
    DISALLOWED_TERMINAL_COMMANDS.has(commandName.toLowerCase())
  ) {
    console.error(
      'The /skill and /s built-in commands are only available from the chat UI.'
    )
    process.exitCode = 1
    return
  }

  if (
    commandName &&
    TOOL_TERMINAL_COMMANDS.has(commandName.toLowerCase()) &&
    subcommandName &&
    !SUPPORTED_TOOL_TERMINAL_SUBCOMMANDS.has(subcommandName.toLowerCase())
  ) {
    console.error(
      'Direct /tool and /t invocations are only available from the chat UI.'
    )
    process.exitCode = 1
    return
  }

  let response = await BUILT_IN_COMMAND_MANAGER.execute(
    `${COMMAND_PREFIX}${rawInput}`
  )
  let prompt = null

  printResult(response)

  while (
    response.status === 'awaiting_required_parameters' &&
    response.session.pending_input
  ) {
    if (!prompt) {
      prompt = readline.createInterface({ input, output })
    }

    const nextInput = await prompt.question(
      `${response.session.pending_input.prompt || response.session.pending_input.placeholder} `
    )

    response = await BUILT_IN_COMMAND_MANAGER.execute(
      nextInput,
      response.session.id
    )
    printResult(response)
  }

  await prompt?.close()

  if (response.status === 'error') {
    process.exitCode = 1
  }
}

void run()
