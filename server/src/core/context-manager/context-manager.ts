import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  CODEBASE_CONTEXT_PATH,
  CODEBASE_PATH,
  LEON_DISABLED_CONTEXT_FILES,
  NODE_RUNTIME_BIN_PATH,
  PROFILE_CONTEXT_PATH,
  TSX_CLI_PATH
} from '@/constants'
import { TOOLKIT_REGISTRY, LLM_PROVIDER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import {
  createContextFiles,
  DEFAULT_CONTEXT_REFRESH_TTL_MS
} from '@/core/context-manager/context-file-factory'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'

interface ContextFileMetadata {
  lastGeneratedAt: number
}

const CONTEXT_FILES_RUNTIME_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'context-files'
)
const CONTEXT_FILES_SOURCE_DIR = path.join(
  CODEBASE_PATH,
  'server',
  'src',
  'core',
  'context-manager',
  'context-files'
)
const CONTEXT_MANAGER_DIR = path.dirname(fileURLToPath(import.meta.url))
const CODEBASE_CONTEXT_FILES = new Set([
  'LEON.md',
  'ARCHITECTURE.md'
])
const BOOT_REFRESH_MIN_DELAY_MS = 6_000
const BOOT_REFRESH_MAX_DELAY_MS = 20_000
const BOOT_REFRESH_RETRY_DELAY_MS = 4_000
const BOOT_REFRESH_MAX_DEFERRAL_MS = 60_000
const BOOT_REFRESH_DEFER_LOAD_RATIO = 0.85
const BOOT_REFRESH_PRIORITY_FILENAMES = [
  'LEON_RUNTIME.md',
  'GPU_COMPUTE.md',
  'HOME.md',
  'HOST_SYSTEM.md'
]
const BOOT_REFRESH_TIMER_LABEL = 'Context files boot refresh total'
const PERIODIC_REFRESH_TIMER_LABEL = 'Context files periodic refresh total'
const READ_REFRESH_TIMER_LABEL = 'Context files read refresh total'
const CONTEXT_REFRESH_WORKER_SRC_PATH = path.join(
  CONTEXT_MANAGER_DIR,
  'context-refresh-worker.ts'
)
const CONTEXT_REFRESH_WORKER_DIST_PATH = path.join(
  CONTEXT_MANAGER_DIR,
  'context-refresh-worker.js'
)
const CONTEXT_REFRESH_WORKER_MAX_BUFFER = 1024 * 1024 * 8
const RETIRED_CONTEXT_FILES = [
  'LOCAL_ECOSYSTEM.md',
  'NETWORK.md',
  'AUTOMATION_OPPORTUNITIES.md',
  'MEDIA_TASTES.md'
]
const RETIRED_STATE_FILES = ['.media-tastes-state.json']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const execFileAsync = promisify(execFile)

export default class ContextManager {
  private static instance: ContextManager

  private _isLoaded = false
  private manifest = ''
  private refreshIntervalId: NodeJS.Timeout | null = null
  private isBootRefreshInProgress = false
  private isBackgroundRefreshInProgress = false
  private pendingRefreshReason: 'periodic' | 'read' = 'periodic'
  private readonly pendingRefreshDefinitions = new Map<string, ContextFile>()
  private readonly metadata = new Map<string, ContextFileMetadata>()
  private readonly probeHelper = new ContextProbeHelper()
  private readonly allContextFiles: ContextFile[] = createContextFiles(
    this.probeHelper,
    DEFAULT_CONTEXT_REFRESH_TTL_MS,
    {
      getWorkflowLLMName: () => LLM_PROVIDER.workflowLLMName,
      getAgentLLMName: () => LLM_PROVIDER.agentLLMName,
      getLocalLLMName: () => LLM_PROVIDER.localLLMName
    }
  )
  private readonly disabledContextFiles = this.parseContextFileList(
    LEON_DISABLED_CONTEXT_FILES
  )
  private readonly contextFiles: ContextFile[] = this.allContextFiles.filter(
    (definition) => !this.disabledContextFiles.has(definition.filename)
  )

  public constructor() {
    if (!ContextManager.instance) {
      LogHelper.title('Context Manager')
      LogHelper.success('New instance')

      ContextManager.instance = this
    }
  }

  public get isLoaded(): boolean {
    return this._isLoaded
  }

  public async load(): Promise<void> {
    if (this._isLoaded) {
      return
    }

    try {
      await fs.promises.mkdir(PROFILE_CONTEXT_PATH, { recursive: true })
      await fs.promises.mkdir(CODEBASE_CONTEXT_PATH, { recursive: true })
      this.cleanupDisabledContextFiles()
      this.cleanupRetiredContextFiles()
      this.cleanupProfileCopiesOfCodebaseContextFiles()
      this.refreshContextFilesAtBootInBackground()

      await this.syncContextReadFilenameEnum()

      this.manifest = this.buildManifest()
      this._isLoaded = true
      this.schedulePeriodicRefresh()

      LogHelper.title('Context Manager')
      LogHelper.success(`Loaded ${this.contextFiles.length} context files`)
    } catch (e) {
      LogHelper.title('Context Manager')
      LogHelper.error(`Failed to load context files: ${e}`)
    }
  }

  private refreshContextFilesAtBootInBackground(): void {
    if (this.isBootRefreshInProgress) {
      return
    }

    this.isBootRefreshInProgress = true
    const bootRefreshStartedAt = Date.now()

    const runBootRefreshQueue = async (): Promise<void> => {
      LogHelper.time(BOOT_REFRESH_TIMER_LABEL)
      const definitions = [...this.contextFiles].sort((definitionA, definitionB) => {
        const priorityA = this.getBootRefreshPriority(definitionA.filename)
        const priorityB = this.getBootRefreshPriority(definitionB.filename)
        if (priorityA !== priorityB) {
          return priorityA - priorityB
        }

        return definitionA.filename.localeCompare(definitionB.filename)
      })
      const updatedFilenames: string[] = []
      try {
        for (const definition of definitions) {
          if (await this.refreshContextFileInChildProcess(definition)) {
            updatedFilenames.push(definition.filename)
          }

          await this.yieldToEventLoop()
        }

        this.logContextFilesUpdated('boot', updatedFilenames)
        this.manifest = this.buildManifest()
      } finally {
        LogHelper.title('Context Manager')
        LogHelper.timeEnd(BOOT_REFRESH_TIMER_LABEL)
        this.isBootRefreshInProgress = false
      }
    }

    const scheduleBootRefresh = (delayMs: number): void => {
      const bootRefreshTimer = setTimeout(() => {
        const elapsedMs = Date.now() - bootRefreshStartedAt
        if (this.shouldDeferBootRefresh(elapsedMs)) {
          scheduleBootRefresh(this.getAdaptiveBootRetryDelayMs())
          return
        }

        void runBootRefreshQueue()
      }, delayMs)

      if (typeof bootRefreshTimer.unref === 'function') {
        bootRefreshTimer.unref()
      }
    }

    scheduleBootRefresh(this.getAdaptiveBootInitialDelayMs())
  }

  public getManifest(): string {
    if (!this._isLoaded) {
      return ''
    }

    if (!this.manifest) {
      this.manifest = this.buildManifest()
    }

    return this.manifest
  }

  public getContextFileContent(filename: string): string | null {
    if (!this._isLoaded) {
      return null
    }

    const definition = this.resolveDefinition(filename)
    if (!definition) {
      return null
    }

    const filePath = this.getContextFilePath(definition.filename)
    const isStale = this.isContextFileStale(definition)
    if (isStale) {
      if (fs.existsSync(filePath)) {
        this.queueRefresh('read', [definition])
      } else {
        this.refreshContextFile(definition, true)
      }
    }

    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (e) {
      LogHelper.title('Context Manager')
      LogHelper.error(`Failed to read context file "${definition.filename}": ${e}`)

      return null
    }
  }

  public getContextForToolkit(toolkitId: string): string {
    const contextFiles = this.getContextFilesForToolkit(toolkitId)
    if (contextFiles.length === 0) {
      return ''
    }

    const chunks: string[] = []
    for (const filename of contextFiles) {
      const content = this.getContextFileContent(filename)

      if (!content) {
        continue
      }

      chunks.push(`### ${filename}\n${content.trim()}`)
    }

    return chunks.join('\n\n')
  }

  public getContextFilesForToolkit(toolkitId: string): string[] {
    if (!this._isLoaded || !toolkitId) {
      return []
    }

    const rawContextFiles = TOOLKIT_REGISTRY.getToolkitContextFiles(toolkitId)
    if (!rawContextFiles || rawContextFiles.length === 0) {
      return []
    }

    return [...new Set(rawContextFiles)]
      .map((filename) => this.normalizeFilename(filename))
      .filter(
        (filename) => filename.length > 0 && this.resolveDefinition(filename) !== null
      )
  }

  private getContextFilePath(filename: string): string {
    if (CODEBASE_CONTEXT_FILES.has(filename)) {
      return path.join(CODEBASE_CONTEXT_PATH, filename)
    }

    return path.join(PROFILE_CONTEXT_PATH, filename)
  }

  private getProfileContextFilePath(filename: string): string {
    return path.join(PROFILE_CONTEXT_PATH, filename)
  }

  private normalizeFilename(filename: string): string {
    const trimmedFilename = filename.trim()

    if (!trimmedFilename) {
      return ''
    }

    const fileBasename = path.basename(trimmedFilename, '.md').toUpperCase()
    return `${fileBasename}.md`
  }

  private resolveDefinition(filename: string): ContextFile | null {
    const normalized = this.normalizeFilename(filename)

    if (!normalized) {
      return null
    }

    return (
      this.contextFiles.find((definition) => definition.filename === normalized) ||
      null
    )
  }

  private isContextFileStale(definition: ContextFile): boolean {
    const filePath = this.getContextFilePath(definition.filename)

    if (!fs.existsSync(filePath)) {
      return true
    }

    let generatedFileMtimeMs = 0
    try {
      generatedFileMtimeMs = fs.statSync(filePath).mtimeMs
    } catch {
      return true
    }

    if (CODEBASE_CONTEXT_FILES.has(definition.filename)) {
      const sourceUpdatedAt = this.getContextSourceUpdatedAt(definition)
      if (
        typeof sourceUpdatedAt === 'number' &&
        sourceUpdatedAt > generatedFileMtimeMs
      ) {
        return true
      }
    }

    if (definition.ttlMs === null) {
      return false
    }

    const fileMetadata = this.metadata.get(definition.filename)
    let lastGeneratedAt = fileMetadata?.lastGeneratedAt

    if (!lastGeneratedAt) {
      lastGeneratedAt = generatedFileMtimeMs
      this.metadata.set(definition.filename, {
        lastGeneratedAt
      })
    }

    const effectiveTtlMs = definition.ttlMs

    return Date.now() - lastGeneratedAt >= effectiveTtlMs
  }

  private getContextSourceUpdatedAt(definition: ContextFile): number | null {
    const sourceFilePath = this.resolveContextSourcePath(definition)
    if (!sourceFilePath) {
      return null
    }

    try {
      return fs.statSync(sourceFilePath).mtimeMs
    } catch {
      return null
    }
  }

  private resolveContextSourcePath(definition: ContextFile): string | null {
    const sourceBasename = this.getContextSourceBasename(definition.filename)
    const sourceDirectories = [
      CONTEXT_FILES_SOURCE_DIR,
      CONTEXT_FILES_RUNTIME_DIR
    ]

    for (const sourceDirectory of sourceDirectories) {
      const tsPath = path.join(sourceDirectory, `${sourceBasename}.ts`)
      if (fs.existsSync(tsPath)) {
        return tsPath
      }

      const jsPath = path.join(sourceDirectory, `${sourceBasename}.js`)
      if (fs.existsSync(jsPath)) {
        return jsPath
      }
    }

    return null
  }

  private getContextSourceBasename(filename: string): string {
    return `${path.basename(filename, '.md').toLowerCase().replaceAll('_', '-')}-context-file`
  }

  private getBootRefreshPriority(filename: string): number {
    const index = BOOT_REFRESH_PRIORITY_FILENAMES.indexOf(filename)
    if (index === -1) {
      return BOOT_REFRESH_PRIORITY_FILENAMES.length
    }

    return index
  }

  private getNormalizedLoadRatio(): number {
    const cpuCount = Math.max(1, os.cpus().length || 1)
    const load1m = os.loadavg()[0] || 0
    return Math.max(0, load1m / cpuCount)
  }

  private getAdaptiveBootInitialDelayMs(): number {
    const cpuCount = Math.max(1, os.cpus().length || 1)
    const loadRatio = this.getNormalizedLoadRatio()
    const cpuPenaltyMs = cpuCount <= 4 ? 5_000 : cpuCount <= 8 ? 2_500 : 0
    const loadPenaltyMs = Math.round(Math.min(1.8, loadRatio) * 4_000)

    return clamp(
      BOOT_REFRESH_MIN_DELAY_MS + cpuPenaltyMs + loadPenaltyMs,
      BOOT_REFRESH_MIN_DELAY_MS,
      BOOT_REFRESH_MAX_DELAY_MS
    )
  }

  private getAdaptiveBootRetryDelayMs(): number {
    const loadRatio = this.getNormalizedLoadRatio()
    const loadPenaltyMs = Math.round(Math.min(1.5, loadRatio) * 2_000)
    return BOOT_REFRESH_RETRY_DELAY_MS + loadPenaltyMs
  }

  private shouldDeferBootRefresh(elapsedMs: number): boolean {
    if (elapsedMs >= BOOT_REFRESH_MAX_DEFERRAL_MS) {
      return false
    }

    return this.getNormalizedLoadRatio() >= BOOT_REFRESH_DEFER_LOAD_RATIO
  }

  private getContextRefreshWorkerArgs(): string[] {
    if (fs.existsSync(CONTEXT_REFRESH_WORKER_DIST_PATH)) {
      return [CONTEXT_REFRESH_WORKER_DIST_PATH]
    }

    return [
      TSX_CLI_PATH,
      '--tsconfig',
      path.join(CODEBASE_PATH, 'tsconfig.json'),
      CONTEXT_REFRESH_WORKER_SRC_PATH
    ]
  }

  private async refreshContextFileInChildProcess(
    definition: ContextFile
  ): Promise<boolean> {
    if (!this.isContextFileStale(definition)) {
      return false
    }

    const workerArgs = [
      ...this.getContextRefreshWorkerArgs(),
      '--filename',
      definition.filename,
      '--workflow-llm-name',
      LLM_PROVIDER.workflowLLMName,
      '--agent-llm-name',
      LLM_PROVIDER.agentLLMName,
      '--local-llm-name',
      LLM_PROVIDER.localLLMName
    ]

    try {
      const { stdout } = await execFileAsync(NODE_RUNTIME_BIN_PATH, workerArgs, {
        cwd: CODEBASE_PATH,
        maxBuffer: CONTEXT_REFRESH_WORKER_MAX_BUFFER,
        windowsHide: true
      })
      const parsed = JSON.parse(String(stdout || '{}')) as {
        success?: boolean
        content?: string
        error?: string
      }

      if (!parsed.success || typeof parsed.content !== 'string') {
        throw new Error(parsed.error || 'Context refresh worker returned no content')
      }

      const filePath = this.getContextFilePath(definition.filename)
      const content = this.ensureTrailingNewline(parsed.content)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      this.metadata.set(definition.filename, {
        lastGeneratedAt: Date.now()
      })
      return true
    } catch (e) {
      LogHelper.title('Context Manager')
      LogHelper.error(
        `Failed to refresh context file "${definition.filename}" in child process: ${String(e)}`
      )
      return false
    }
  }

  private queueRefresh(
    reason: 'periodic' | 'read',
    definitionsOverride?: ContextFile[]
  ): void {
    if (!this._isLoaded) {
      return
    }

    const definitions = definitionsOverride
      ? this.sortContextDefinitions(
          definitionsOverride.filter((definition) => this.isContextFileStale(definition))
        )
      : this.getStaleContextFiles()
    if (definitions.length === 0) {
      return
    }

    if (this.isBootRefreshInProgress || this.isBackgroundRefreshInProgress) {
      for (const definition of definitions) {
        this.pendingRefreshDefinitions.set(definition.filename, definition)
      }
      if (reason === 'read') {
        this.pendingRefreshReason = 'read'
      }
      return
    }

    this.isBackgroundRefreshInProgress = true
    void this.runBackgroundRefresh(reason, definitions)
  }

  private async runBackgroundRefresh(
    reason: 'periodic' | 'read',
    definitions: ContextFile[]
  ): Promise<void> {
    const timerLabel =
      reason === 'read'
        ? READ_REFRESH_TIMER_LABEL
        : PERIODIC_REFRESH_TIMER_LABEL
    LogHelper.time(timerLabel)

    const updatedFilenames: string[] = []
    try {
      for (const definition of definitions) {
        if (await this.refreshContextFileInChildProcess(definition)) {
          updatedFilenames.push(definition.filename)
        }

        await this.yieldToEventLoop()
      }

      this.logContextFilesUpdated(reason, updatedFilenames)
      this.manifest = this.buildManifest()
    } finally {
      LogHelper.title('Context Manager')
      LogHelper.timeEnd(timerLabel)
      this.isBackgroundRefreshInProgress = false
      if (this.pendingRefreshDefinitions.size > 0) {
        const nextReason = this.pendingRefreshReason
        const nextDefinitions = this.sortContextDefinitions([
          ...this.pendingRefreshDefinitions.values()
        ]).filter((definition) => this.isContextFileStale(definition))
        this.pendingRefreshDefinitions.clear()
        this.pendingRefreshReason = 'periodic'

        if (nextDefinitions.length > 0) {
          this.isBackgroundRefreshInProgress = true
          void this.runBackgroundRefresh(nextReason, nextDefinitions)
        }
      }
    }
  }

  private getStaleContextFiles(): ContextFile[] {
    return this.sortContextDefinitions(
      this.contextFiles.filter((definition) => this.isContextFileStale(definition))
    )
  }

  private sortContextDefinitions(definitions: ContextFile[]): ContextFile[] {
    return [...definitions].sort((definitionA, definitionB) => {
      const priorityA = this.getBootRefreshPriority(definitionA.filename)
      const priorityB = this.getBootRefreshPriority(definitionB.filename)
      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }

      return definitionA.filename.localeCompare(definitionB.filename)
    })
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 0)
      if (typeof timer.unref === 'function') {
        timer.unref()
      }
    })
  }

  private logContextFilesUpdated(reason: string, filenames: string[]): void {
    const uniqueFilenames = [...new Set(filenames)]
    if (uniqueFilenames.length === 0) {
      return
    }

    LogHelper.title('Context Manager')
    LogHelper.info(
      `Updated ${uniqueFilenames.length} context file(s) during ${reason} refresh: ${uniqueFilenames.join(', ')}`
    )
  }

  private async syncContextReadFilenameEnum(): Promise<void> {
    try {
      if (!TOOLKIT_REGISTRY.isLoaded) {
        await TOOLKIT_REGISTRY.load()
      }

      const filenames = this.contextFiles
        .map((definition) => definition.filename)
        .sort((a, b) => a.localeCompare(b))

      const isUpdated = TOOLKIT_REGISTRY.setFunctionParameterEnum(
        'structured_knowledge',
        'context',
        'readContextFile',
        'filename',
        filenames
      )

      if (isUpdated) {
        LogHelper.title('Context Manager')
        LogHelper.info(
          `Synced readContextFile.filename enum with ${filenames.length} context file(s)`
        )
      }
    } catch (error) {
      LogHelper.title('Context Manager')
      LogHelper.warning(
        `Failed to sync readContextFile.filename enum: ${String(error)}`
      )
    }
  }

  private refreshContextFile(definition: ContextFile, force = false): boolean {
    if (!force && !this.isContextFileStale(definition)) {
      return false
    }

    const filePath = this.getContextFilePath(definition.filename)
    try {
      const content = this.ensureTrailingNewline(definition.generate())

      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      this.metadata.set(definition.filename, {
        lastGeneratedAt: Date.now()
      })
      return true
    } catch (e) {
      LogHelper.title('Context Manager')
      LogHelper.error(
        `Failed to refresh context file "${definition.filename}": ${String(e)}`
      )
      return false
    }
  }

  private ensureTrailingNewline(content: string): string {
    if (content.endsWith('\n')) {
      return content
    }

    return `${content}\n`
  }

  private extractSummary(content: string): string | null {
    const firstNonEmptyLine = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0)

    if (!firstNonEmptyLine || !firstNonEmptyLine.startsWith('>')) {
      return null
    }

    return firstNonEmptyLine.slice(1).trim()
  }

  private buildManifest(): string {
    const summaryLines: string[] = []

    for (const definition of this.contextFiles) {
      const filePath = this.getContextFilePath(definition.filename)
      if (!fs.existsSync(filePath)) {
        continue
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      const summary = this.extractSummary(content)
      if (!summary) {
        continue
      }

      summaryLines.push(`- ${definition.filename}: ${summary}`)
    }

    return summaryLines.join('\n')
  }

  private schedulePeriodicRefresh(): void {
    if (this.refreshIntervalId) {
      return
    }

    this.refreshIntervalId = setInterval(
      () => {
        this.queueRefresh('periodic')
      },
      DEFAULT_CONTEXT_REFRESH_TTL_MS
    )

    if (typeof this.refreshIntervalId.unref === 'function') {
      this.refreshIntervalId.unref()
    }
  }

  private parseContextFileList(rawFileList: string): Set<string> {
    return new Set(
      rawFileList
        .split(/[,;\n]/)
        .map((value) => this.normalizeFilename(value))
        .filter((value) => value.length > 0)
    )
  }

  private cleanupDisabledContextFiles(): void {
    for (const filename of this.disabledContextFiles) {
      const filePath = CODEBASE_CONTEXT_FILES.has(filename)
        ? this.getProfileContextFilePath(filename)
        : this.getContextFilePath(filename)
      this.metadata.delete(filename)

      if (!fs.existsSync(filePath)) {
        continue
      }

      try {
        fs.rmSync(filePath, { force: true })
      } catch {
        continue
      }
    }
  }

  private cleanupProfileCopiesOfCodebaseContextFiles(): void {
    for (const filename of CODEBASE_CONTEXT_FILES) {
      const filePath = this.getProfileContextFilePath(filename)

      if (!fs.existsSync(filePath)) {
        continue
      }

      try {
        fs.rmSync(filePath, { force: true })
      } catch {
        continue
      }
    }
  }

  private cleanupRetiredContextFiles(): void {
    for (const filename of RETIRED_CONTEXT_FILES) {
      const filePath = this.getContextFilePath(filename)

      if (!fs.existsSync(filePath)) {
        continue
      }

      try {
        fs.rmSync(filePath, { force: true })
      } catch {
        continue
      }
    }

    for (const filename of RETIRED_STATE_FILES) {
      const filePath = this.getContextFilePath(filename)

      if (!fs.existsSync(filePath)) {
        continue
      }

      try {
        fs.rmSync(filePath, { force: true })
      } catch {
        continue
      }
    }
  }
}
