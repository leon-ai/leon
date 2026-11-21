import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DateHelper } from '@/helpers/date-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { ContextStateStore, normalizeSampleTime } from '@/core/context-manager/context-state-store'

interface RepositoryStateEntry {
  lastSeenAt: string
  seenCount: number
  primaryLanguage: string
}

interface WorkspaceState {
  trackingStartedAt: string
  lastSampleAt: string
  repositories: Record<string, RepositoryStateEntry>
}

interface RepositorySnapshot {
  repoPath: string
  repoName: string
  lastModifiedAt: string
  branch: string
  primaryLanguage: string
  fileCount: number
}

interface ToolchainEntry {
  name: string
  availability: string
}

const FALLBACK_STATE: WorkspaceState = {
  trackingStartedAt: '',
  lastSampleAt: '',
  repositories: {}
}

const MAX_REPOS = 24
const MAX_STATE_REPOS = 600
const MAX_LANG_LINES = 12
const MAX_TOOLCHAINS = 12

export class WorkspaceIntelligenceContextFile extends ContextFile {
  public readonly filename = 'WORKSPACE_INTELLIGENCE.md'
  public readonly ttlMs: number

  private readonly stateStore = new ContextStateStore<WorkspaceState>(
    '.workspace-intelligence-state.json',
    FALLBACK_STATE
  )

  public constructor(
    private readonly probeHelper: ContextProbeHelper,
    ttlMs: number
  ) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const now = new Date()
    const nowIso = now.toISOString()

    const workspaceRoots = this.getWorkspaceRoots()
    const repositoryPaths = this.discoverRepositories(workspaceRoots)
    const repositorySnapshots = repositoryPaths
      .map((repoPath) => this.buildRepositorySnapshot(repoPath))
      .filter((repo): repo is RepositorySnapshot => Boolean(repo))
      .sort((repoA, repoB) => repoB.lastModifiedAt.localeCompare(repoA.lastModifiedAt))

    const currentState = this.normalizeState(this.stateStore.load(), nowIso)
    const updatedState = this.updateState(currentState, repositorySnapshots, nowIso)
    this.stateStore.save(updatedState)

    const languageLines = this.buildLanguageDistribution(repositorySnapshots)
    const toolchainAvailability = this.probeToolchainAvailability()

    const summary = `Workspace intelligence tracks ${repositorySnapshots.length} repository(ies) across ${workspaceRoots.length} root(s), with ${languageLines.length} detected language signal(s).`

    const repoLines =
      repositorySnapshots.length > 0
        ? repositorySnapshots.slice(0, MAX_REPOS).map((repo, index) => {
            const state = updatedState.repositories[repo.repoPath]
            return `- ${index + 1}. ${repo.repoName} | ${repo.repoPath} | branch ${repo.branch} | language ${repo.primaryLanguage} | files ${repo.fileCount} | last modified ${DateHelper.getDateTime(repo.lastModifiedAt) || repo.lastModifiedAt} | seen ${state?.seenCount || 1} time(s)`
          })
        : ['- No repositories discovered in configured roots']

    const languageDistributionLines =
      languageLines.length > 0
        ? languageLines.slice(0, MAX_LANG_LINES).map((line, index) => {
            return `- ${index + 1}. ${line.language}: ${line.count} repository(ies)`
          })
        : ['- No language distribution signal yet']

    const toolchainLines = toolchainAvailability
      .slice(0, MAX_TOOLCHAINS)
      .map((entry, index) => `- ${index + 1}. ${entry.name}: ${entry.availability}`)

    return [
      `> Repositories, language distribution, toolchain command probes. ${summary}`,
      '# WORKSPACE_INTELLIGENCE',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Tracking started at: ${DateHelper.getDateTime(updatedState.trackingStartedAt)}`,
      `- Workspace roots scanned: ${workspaceRoots.join(', ') || 'none'}`,
      `- Repository count: ${repositorySnapshots.length}`,
      '## Repositories',
      ...repoLines,
      '## Language Distribution',
      ...languageDistributionLines,
      '## Toolchain Commands in Leon’s Environment',
      ...toolchainLines
    ].join('\n')
  }

  private getWorkspaceRoots(): string[] {
    const candidates = [
      process.cwd(),
      path.join(os.homedir(), 'Workspace'),
      path.join(os.homedir(), 'workspace'),
      path.join(os.homedir(), 'Projects'),
      path.join(os.homedir(), 'projects'),
      path.join(os.homedir(), 'Code'),
      path.join(os.homedir(), 'code')
    ]

    return [...new Set(candidates.filter((candidate) => fs.existsSync(candidate)))]
  }

  private discoverRepositories(roots: string[]): string[] {
    const discovered = new Set<string>()
    const queue = roots.map((root) => ({ directory: root, depth: 0 }))
    const maxDirectories = 2500
    let scannedDirectories = 0

    while (queue.length > 0 && scannedDirectories < maxDirectories) {
      const current = queue.shift()
      if (!current) {
        break
      }

      scannedDirectories += 1

      const gitPath = path.join(current.directory, '.git')
      if (fs.existsSync(gitPath)) {
        discovered.add(current.directory)
        continue
      }

      if (current.depth >= 3) {
        continue
      }

      let children: fs.Dirent[] = []
      try {
        children = fs.readdirSync(current.directory, { withFileTypes: true })
      } catch {
        continue
      }

      for (const child of children) {
        if (!child.isDirectory()) {
          continue
        }

        const childName = child.name.toLowerCase()
        if (
          childName === '.git' ||
          childName === 'node_modules' ||
          childName === '.venv' ||
          childName === 'venv' ||
          childName === 'dist' ||
          childName === 'build' ||
          childName === '.cache'
        ) {
          continue
        }

        queue.push({
          directory: path.join(current.directory, child.name),
          depth: current.depth + 1
        })
      }
    }

    return [...discovered]
  }

  private buildRepositorySnapshot(repoPath: string): RepositorySnapshot | null {
    const repoName = path.basename(repoPath)
    let lastModifiedAt = 'unknown'

    try {
      const stat = fs.statSync(repoPath)
      lastModifiedAt = stat.mtime.toISOString()
    } catch {
      return null
    }

    const branch =
      this.probeHelper.runCommand('git', [
        '-C',
        repoPath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD'
      ]) || 'unknown'

    const languageProbe = this.probeRepositoryLanguage(repoPath)

    return {
      repoPath,
      repoName,
      lastModifiedAt,
      branch,
      primaryLanguage: languageProbe.primaryLanguage,
      fileCount: languageProbe.fileCount
    }
  }

  private probeRepositoryLanguage(repoPath: string): {
    primaryLanguage: string
    fileCount: number
  } {
    const extensionCounts = new Map<string, number>()
    const queue = [{ directory: repoPath, depth: 0 }]
    let fileCount = 0

    while (queue.length > 0 && fileCount < 500) {
      const current = queue.shift()
      if (!current) {
        break
      }

      if (current.depth > 2) {
        continue
      }

      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(current.directory, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        const childPath = path.join(current.directory, entry.name)

        if (entry.isDirectory()) {
          const folderName = entry.name.toLowerCase()
          if (
            folderName === '.git' ||
            folderName === 'node_modules' ||
            folderName === 'dist' ||
            folderName === 'build' ||
            folderName === '.next' ||
            folderName === '.cache' ||
            folderName === '.venv' ||
            folderName === 'venv'
          ) {
            continue
          }

          queue.push({ directory: childPath, depth: current.depth + 1 })
          continue
        }

        if (!entry.isFile()) {
          continue
        }

        fileCount += 1
        const extension = path.extname(entry.name).toLowerCase()
        if (!extension) {
          continue
        }

        extensionCounts.set(extension, (extensionCounts.get(extension) || 0) + 1)
      }
    }

    const topExtension =
      [...extensionCounts.entries()].sort((entryA, entryB) => entryB[1] - entryA[1])[0]?.[0] ||
      ''
    const primaryLanguage = this.extensionToLanguage(topExtension)

    return {
      primaryLanguage,
      fileCount
    }
  }

  private extensionToLanguage(extension: string): string {
    const mapping: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.go': 'Go',
      '.rs': 'Rust',
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.swift': 'Swift',
      '.c': 'C',
      '.cc': 'C++',
      '.cpp': 'C++',
      '.cs': 'C#',
      '.php': 'PHP',
      '.rb': 'Ruby',
      '.sh': 'Shell',
      '.zsh': 'Shell'
    }

    return mapping[extension] || 'Mixed/Unknown'
  }

  private normalizeState(state: WorkspaceState, nowIso: string): WorkspaceState {
    return {
      trackingStartedAt: normalizeSampleTime(state.trackingStartedAt, nowIso),
      lastSampleAt: normalizeSampleTime(state.lastSampleAt, nowIso),
      repositories:
        state.repositories && typeof state.repositories === 'object'
          ? state.repositories
          : {}
    }
  }

  private updateState(
    state: WorkspaceState,
    repositories: RepositorySnapshot[],
    nowIso: string
  ): WorkspaceState {
    const updatedRepositories = { ...state.repositories }

    for (const repo of repositories) {
      const current = updatedRepositories[repo.repoPath]
      if (!current) {
        updatedRepositories[repo.repoPath] = {
          lastSeenAt: nowIso,
          seenCount: 1,
          primaryLanguage: repo.primaryLanguage
        }
        continue
      }

      updatedRepositories[repo.repoPath] = {
        ...current,
        lastSeenAt: nowIso,
        seenCount: current.seenCount + 1,
        primaryLanguage: repo.primaryLanguage || current.primaryLanguage
      }
    }

    const compactedEntries = Object.entries(updatedRepositories)
      .sort((entryA, entryB) => {
        const seenDiff = (entryB[1]?.seenCount || 0) - (entryA[1]?.seenCount || 0)
        if (seenDiff !== 0) {
          return seenDiff
        }

        return Date.parse(entryB[1]?.lastSeenAt || '') - Date.parse(entryA[1]?.lastSeenAt || '')
      })
      .slice(0, MAX_STATE_REPOS)
    const compactedRepositories: Record<string, RepositoryStateEntry> = {}

    for (const [repoPath, entry] of compactedEntries) {
      compactedRepositories[repoPath] = entry
    }

    return {
      trackingStartedAt: state.trackingStartedAt,
      lastSampleAt: nowIso,
      repositories: compactedRepositories
    }
  }

  private buildLanguageDistribution(
    repositories: RepositorySnapshot[]
  ): Array<{ language: string, count: number }> {
    const counts = new Map<string, number>()

    for (const repo of repositories) {
      counts.set(repo.primaryLanguage, (counts.get(repo.primaryLanguage) || 0) + 1)
    }

    return [...counts.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((entryA, entryB) => entryB.count - entryA.count)
  }

  private probeToolchainAvailability(): ToolchainEntry[] {
    const probes = [
      { name: 'git', args: ['--version'] },
      { name: 'node', args: ['--version'] },
      { name: 'npm', args: ['--version'] },
      { name: 'pnpm', args: ['--version'] },
      { name: 'python', args: ['--version'] },
      { name: 'go', args: ['version'] },
      { name: 'rustc', args: ['--version'] },
      { name: 'cargo', args: ['--version'] },
      { name: 'docker', args: ['--version'] },
      { name: 'kubectl', args: ['version', '--client', '--short'] },
      { name: 'java', args: ['-version'] },
      { name: 'code', args: ['--version'] }
    ]

    return probes.map(({ name, args }) => {
      const result = this.probeHelper.probeCommandVersion(name, args)

      return {
        name: [name, ...args].join(' '),
        availability: result.available
          ? this.probeHelper.formatCommandProbe(result)
          : 'command probe unsuccessful'
      }
    })
  }
}
