import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

import { LEON_PROFILES_PATH } from '../server/src/leon-roots'
import { getProfilePaths } from '../server/src/core/profile-runtime/profile-paths'

type AgentSuite = 'unit' | 'e2e' | 'scenario'
const SCENARIOS_PATH = 'test/agent/scenarios'
const SCENARIO_SUFFIX = '.scenario.ts'

/**
 * Session activity selects the default profile without changing owner state.
 */
function getLatestProfile(): string {
  const profiles = fs.readdirSync(LEON_PROFILES_PATH, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const paths = getProfilePaths(entry.name)
      if (!fs.existsSync(paths.config)) {
        return null
      }

      const indexPath = path.join(paths.sessions, 'index.json')
      const index = fs.existsSync(indexPath)
        ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
          sessions: Array<{ lastMessageAt: number | null, createdAt: number }>
        }
        : null

      return {
        name: entry.name,
        lastActivity: Math.max(0, ...(index?.sessions || []).map(
          (session) => session.lastMessageAt || session.createdAt
        )),
        configuredAt: fs.statSync(paths.config).mtimeMs
      }
    })
    .filter((profile) => profile !== null)
    .sort((left, right) => right.lastActivity - left.lastActivity ||
      right.configuredAt - left.configuredAt || left.name.localeCompare(right.name))

  if (!profiles[0]) {
    throw new Error('No configured Leon profile is available for scenario tests.')
  }

  return profiles[0].name
}

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
  if (suite === 'scenario') {
    return SCENARIOS_PATH
  }
  return suite === 'e2e' ? 'test/agent/e2e' : 'test/agent/unit'
}

const suiteArg = process.argv[2]
if (suiteArg !== 'unit' && suiteArg !== 'e2e' && suiteArg !== 'scenario') {
  console.error('Expected suite argument "unit", "e2e" or "scenario" for run-agent-vitest.ts')
  process.exit(1)
}

const suite = suiteArg as AgentSuite
const forwardedArgs = process.argv.slice(3)
if (forwardedArgs[0] === '--') {
  forwardedArgs.shift()
}

let scenario: string | undefined
if (suite === 'scenario') {
  const names = fs.readdirSync(SCENARIOS_PATH)
    .filter((name) => name.endsWith(SCENARIO_SUFFIX))
    .map((name) => name.slice(0, -SCENARIO_SUFFIX.length)).sort()
  scenario = forwardedArgs[0]?.startsWith('-') ? undefined : forwardedArgs.shift()
  if (forwardedArgs[0] === '--list') {
    console.info(`Run all: pnpm test:agent:scenario\nRun one: pnpm test:agent:scenario -- <name>\n${names.join('\n')}`)
    process.exit(0)
  }
  if (scenario && !names.includes(scenario)) {
    console.error(`Unknown scenario "${scenario}". Available: ${names.join(', ')}`)
    process.exit(1)
  }
}

const scenarioProfile = suite === 'scenario'
  ? process.env['LEON_PROFILE']?.trim() || getLatestProfile()
  : undefined

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
    ...(suite !== 'unit' ? ['--no-file-parallelism'] : []),
    ...forwardedArgs
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LEON_NODE_ENV: process.env['LEON_NODE_ENV'] || 'testing',
      ...(scenarioProfile ? {
        LEON_PROFILE: scenarioProfile,
        LEON_AGENT_REAL_SCENARIO: scenario || '*'
      } : {}),
      ...(suite === 'e2e' && testNamePattern
        ? {
            LEON_AGENT_PROVIDER_FILTER: testNamePattern
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
