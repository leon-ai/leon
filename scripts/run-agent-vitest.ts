import path from 'node:path'
import { spawn } from 'node:child_process'

type AgentSuite = 'unit' | 'e2e'

function extractTestNamePattern(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (!arg) {
      continue
    }

    if (arg === '-t' || arg === '--testNamePattern' || arg === '--test-name-pattern') {
      return args[index + 1] || null
    }

    if (arg.startsWith('-t=')) {
      return arg.slice(3) || null
    }

    if (arg.startsWith('--testNamePattern=')) {
      return arg.slice('--testNamePattern='.length) || null
    }

    if (arg.startsWith('--test-name-pattern=')) {
      return arg.slice('--test-name-pattern='.length) || null
    }
  }

  return null
}

function resolveSuitePath(suite: AgentSuite): string {
  return suite === 'e2e' ? 'test/agent/e2e' : 'test/agent/unit'
}

const suiteArg = process.argv[2]
if (suiteArg !== 'unit' && suiteArg !== 'e2e') {
  console.error('Expected suite argument "unit" or "e2e" for run-agent-vitest.ts')
  process.exit(1)
}

const suite = suiteArg as AgentSuite
const forwardedArgs = process.argv.slice(3)
const testNamePattern = extractTestNamePattern(forwardedArgs)
const vitestEntrypoint = path.join(
  process.cwd(),
  'node_modules',
  'vitest',
  'vitest.mjs'
)

const childProcess = spawn(
  process.execPath,
  [
    vitestEntrypoint,
    'run',
    '--config',
    'vitest.config.ts',
    resolveSuitePath(suite),
    ...forwardedArgs
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LEON_NODE_ENV: process.env['LEON_NODE_ENV'] || 'testing',
      ...(suite === 'e2e' && testNamePattern
        ? {
            LEON_AGENT_PROVIDER_PATTERN: testNamePattern
          }
        : {})
    },
    windowsHide: true
  }
)

childProcess.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
