import fs from 'node:fs'
import path from 'node:path'

import {
  LLAMACPP_BUILD_PATH, LLAMACPP_BUILD_MANIFEST_PATH,
  LLAMACPP_PATH, LLAMACPP_ROOT_MANIFEST_PATH,
  LLAMACPP_SOURCE_BUILD_PATH, LLAMACPP_SOURCE_PATH, LLAMACPP_SOURCE_MANIFEST_PATH,
  MINIMUM_LOCAL_CONTEXT_TOKENS, LLAMACPP_DEFAULT_KV_CACHE_TYPE
} from '@/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { CPUArchitectures } from '@/types'
import type { LeonConfigSchema } from '@/schemas/core-schemas'

/**
 * Owner-selected precision shared by KV memory estimates and inference.
 */
export type LlamaCPPKVCacheType = NonNullable<LeonConfigSchema['llm']['providers']['llamacpp']['kv_cache_type']>

enum MemoryKind {
  Device = 'device',
  Host = 'host'
}

/**
 * Execution path selected by the native layer and tensor placement.
 */
export enum LlamaCPPExecutionMode {
  GPU = 'gpu',
  CPUOffload = 'cpu_offload',
  CPUOnly = 'cpu_only'
}

const BYTES_PER_MIB = 1_024 * 1_024
const MIB_PER_GIB = 1_024
const MEMORY_RESERVE_RATIO = 0.1
const MINIMUM_HOST_RESERVE_MIB = 2 * MIB_PER_GIB
const MINIMUM_DEVICE_RESERVE_MIB = MIB_PER_GIB
const MAXIMUM_PROMPT_CACHE_MIB = 8 * MIB_PER_GIB
const CONTEXT_ALIGNMENT = 256
const ESTIMATION_TIMEOUT_MS = 30_000
const FIT_ARGUMENTS = new Set(['-c', '-ngl', '-ts', '-ot'])
const EXECUTION_LABELS = {
  [LlamaCPPExecutionMode.GPU]: 'GPU',
  [LlamaCPPExecutionMode.CPUOffload]: 'CPU + GPU',
  [LlamaCPPExecutionMode.CPUOnly]: 'CPU'
}

/**
 * A valid model cannot be allocated within the current reserved memory budgets.
 */
export class LlamaCPPCapacityError extends Error {}

/**
 * The managed runtime cannot provide the detected hardware's execution backend.
 */
export class LlamaCPPBackendError extends Error {}

/**
 * Resolve the installed native runtime identically in setup and inference.
 */
export function getLlamaCPPServerBinaryPath(): string {
  const binary = SystemHelper.isWindows() ? 'llama-server.exe' : 'llama-server'
  const manifests = [
    [LLAMACPP_SOURCE_MANIFEST_PATH, LLAMACPP_SOURCE_PATH],
    [LLAMACPP_BUILD_MANIFEST_PATH, LLAMACPP_BUILD_PATH],
    [LLAMACPP_ROOT_MANIFEST_PATH, LLAMACPP_PATH]
  ]

  for (const [manifestPath, root] of manifests) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath!, 'utf8'))
      if (typeof manifest.runtimePath === 'string' && manifest.runtimePath) {
        return path.join(root!, manifest.runtimePath, binary)
      }
    } catch {
      // A missing manifest may belong to an installation method not in use.
    }
  }

  const source = path.join(LLAMACPP_SOURCE_BUILD_PATH, binary)
  return fs.existsSync(source) ? source : path.join(LLAMACPP_BUILD_PATH, binary)
}

/**
 * Keep setup estimates aligned with the native inference allocation settings.
 */
export function getLlamaCPPModelArguments(
  modelPath: string,
  kvCacheType: LlamaCPPKVCacheType = LLAMACPP_DEFAULT_KV_CACHE_TYPE
): string[] {
  return ['--model', modelPath, '--flash-attn', 'on',
    '--cache-type-k', kvCacheType, '--cache-type-v', kvCacheType]
}

/**
 * Budget current host availability after reserving system and prompt-cache memory.
 */
export function getLlamaCPPHostMemoryBudget(reserveMiB?: number): {
  hostBudgetMiB: number
  cacheMiB: number
  unifiedMemory: boolean
} {
  const totalMiB = Math.floor(SystemHelper.getTotalRAM() * MIB_PER_GIB)
  const availableMiB = Math.min(totalMiB,
    Math.floor(SystemHelper.getFreeRAMInBytes() / BYTES_PER_MIB))
  const hostReserve = reserveMiB ?? Math.max(MINIMUM_HOST_RESERVE_MIB,
    Math.ceil(totalMiB * MEMORY_RESERVE_RATIO))
  const cacheMiB = Math.min(MAXIMUM_PROMPT_CACHE_MIB,
    Math.floor(availableMiB * MEMORY_RESERVE_RATIO))
  const hostBudgetMiB = availableMiB - hostReserve - cacheMiB

  if (hostBudgetMiB <= 0) {
    throw new LlamaCPPCapacityError('Not enough available RAM to load a local model while retaining the memory reserve.')
  }

  return { hostBudgetMiB, cacheMiB,
    unifiedMemory: SystemHelper.isMacOS() &&
      SystemHelper.getInformation().cpuArchitecture === CPUArchitectures.ARM64 }
}

interface MemoryRow {
  kind: MemoryKind
  name: string
  self: number
  model: number
  context: number
  compute: number
  total?: number
  free?: number
}

/**
 * Native allocation and reserved capacity for one inference device, in MiB.
 */
export interface LlamaCPPDeviceAllocation {
  name: string
  estimatedMiB: number
  budgetMiB: number
  modelMiB: number
  contextMiB: number
  computeMiB: number
}

/**
 * A native allocation plan verified against device and host memory budgets.
 */
export interface LlamaCPPContextPlan {
  arguments: string[]
  contextTokens: number
  hostBudgetMiB: number
  memoryBudgetMiB: number
  cacheMiB: number
  estimatedMiB: number
  hostEstimatedMiB: number
  devices: LlamaCPPDeviceAllocation[]
  executionMode: LlamaCPPExecutionMode
  gpuLayers: number
  cpuOffloadedModelRatio: number
  headroomRatio: number
  unifiedMemory: boolean
}

/**
 * Describe the execution path and each physical memory budget independently.
 */
export function describeLlamaCPPContextPlan(plan: LlamaCPPContextPlan): string {
  const gib = (mib: number): string => (mib / MIB_PER_GIB).toFixed(1)
  const allocations = [
    `${plan.unifiedMemory ? 'shared RAM' : 'RAM'} ${gib(plan.hostEstimatedMiB)}/${gib(plan.hostBudgetMiB)} GiB`,
    ...plan.devices.map((device) =>
      `${device.name} ${gib(device.estimatedMiB)}/${gib(device.budgetMiB)} GiB`
    )
  ]

  return `${EXECUTION_LABELS[plan.executionMode]} execution; ${allocations.join('; ')}`
}

async function estimateMemory(binary: string, args: string[]): Promise<MemoryRow[]> {
  const output = await RuntimeHelper.runBinary(binary, [
    ...args, '--fit-print', 'on', '--log-jsonl', '--verbose'
  ], { timeoutMs: ESTIMATION_TIMEOUT_MS })
  let rows: unknown

  // The estimator mixes structured events with its human-readable summary.
  for (const line of output.split('\n')) {
    if (line.startsWith('{')) {
      const event = JSON.parse(line)
      if (event.type === 'fit_memory_breakdown' && event.data?.unit === 'MiB') {
        rows = event.data.rows
      }
    }
  }

  if (!Array.isArray(rows)) {
    throw new Error('llama.cpp did not report its estimated memory allocation.')
  }

  const allocations = rows.filter((row) =>
    row.kind === MemoryKind.Device || row.kind === MemoryKind.Host
  ) as MemoryRow[]
  if (!allocations.some((row) => row.kind === MemoryKind.Host) ||
      allocations.some((row) =>
        [row.self, row.model, row.context, row.compute].some((value) =>
          !Number.isSafeInteger(value) || value < 0
        ) ||
        (row.kind === MemoryKind.Device &&
          (!Number.isSafeInteger(row.total) || !Number.isSafeInteger(row.free) ||
            row.total! <= 0 || row.free! < 0)))) {
    throw new Error('llama.cpp returned an invalid memory estimate.')
  }

  return allocations
}

function parseFitArguments(output: string): string[] {
  const args: string[] = []
  const tokens = output.trim().split(' ')

  // These are native flag/value pairs, never a shell command. Tensor overrides
  // are quoted as one value by the estimator and passed directly to spawn.
  for (let index = 0; index < tokens.length; index += 1) {
    const flag = tokens[index]!
    let value = tokens[++index]
    if (value?.startsWith('"')) {
      while (!value.endsWith('"') && index + 1 < tokens.length) {
        value += ` ${tokens[++index]}`
      }
      if (!value.endsWith('"')) {
        throw new Error('llama.cpp returned an unterminated tensor override.')
      }
      value = value.slice(1, -1)
    }
    if (!FIT_ARGUMENTS.has(flag) || !value) {
      throw new Error('llama.cpp returned invalid fitted arguments.')
    }

    args.push(flag, value)
  }

  const context = Number(args[args.indexOf('-c') + 1])
  if (!args.includes('-c') || !Number.isSafeInteger(context) || context < 1) {
    throw new Error('llama.cpp did not select a valid context capacity.')
  }

  const gpuLayers = Number(args[args.indexOf('-ngl') + 1])
  if (!args.includes('-ngl') || !Number.isSafeInteger(gpuLayers) || gpuLayers < -2) {
    throw new Error('llama.cpp did not select a valid GPU layer allocation.')
  }

  return args
}

/**
 * Uses the managed runtime's own GGUF estimates and fitter before allocating
 * weights. CPU, discrete GPU and unified-memory machines retain host headroom;
 * cache storage is budgeted separately from the active model and context.
 */
export async function resolveLlamaCPPContextPlan(
  serverBinary: string,
  modelArguments: string[],
  reserveMiB?: number,
  maximumContextTokens?: number,
  options: { requireGPU?: boolean, preserveContext?: boolean } = {}
): Promise<LlamaCPPContextPlan> {
  const binary = path.join(path.dirname(serverBinary),
    SystemHelper.isWindows() ? 'llama-fit-params.exe' : 'llama-fit-params')
  const totalMiB = Math.floor(SystemHelper.getTotalRAM() * MIB_PER_GIB)
  const { hostBudgetMiB, cacheMiB, unifiedMemory } = getLlamaCPPHostMemoryBudget(reserveMiB)

  const initial = await estimateMemory(binary, modelArguments)
  const devices = initial.filter((row) => row.kind === MemoryKind.Device)
  if (options.requireGPU && devices.length === 0) {
    throw new LlamaCPPBackendError('I cannot use the detected GPU with my managed llama.cpp runtime. Check its backend, runtime libraries and graphics driver before selecting a local model.')
  }

  const deviceReserve = (row: MemoryRow): number => reserveMiB ??
    Math.max(MINIMUM_DEVICE_RESERVE_MIB, Math.ceil(row.total! * MEMORY_RESERVE_RATIO))
  const hostAllocation = initial.find((row) => row.kind === MemoryKind.Host)!.self
  const margins = devices.length > 0
    ? devices.map((row) => Math.max(deviceReserve(row), unifiedMemory
        ? row.free! - Math.max(0, hostBudgetMiB - hostAllocation)
        : 0))
    // Native CPU fitting uses total RAM, so include memory already in use.
    : [totalMiB - hostBudgetMiB]
  const fitArguments = ['--fit-target', margins.join(','),
    '--fit-ctx', String(MINIMUM_LOCAL_CONTEXT_TOKENS)]
  let contextLimit = maximumContextTokens

  while (true) {
    let output: string
    try {
      output = await RuntimeHelper.runBinary(binary, [
        ...modelArguments, ...fitArguments,
        ...(contextLimit ? ['--ctx-size', String(contextLimit)] : []),
        '--log-disable'
      ], { timeoutMs: ESTIMATION_TIMEOUT_MS })
    } catch (error) {
      if ((error as { code?: unknown }).code === 1) {
        throw new LlamaCPPCapacityError('The native fitter could not allocate this model.', { cause: error })
      }
      throw error
    }
    const fitted = parseFitArguments(output)
    const contextTokens = Number(fitted[fitted.indexOf('-c') + 1])
    // A memory fit must still leave enough context for the agent's instructions,
    // tools and ongoing work. Explicit owner capacities can opt out of this floor.
    if (!(options.preserveContext && maximumContextTokens !== undefined) &&
        contextTokens < MINIMUM_LOCAL_CONTEXT_TOKENS) {
      throw new LlamaCPPCapacityError(`The local model cannot retain the required ${MINIMUM_LOCAL_CONTEXT_TOKENS.toLocaleString('en-US')}-token context within the available memory budgets.`)
    }

    const rows = await estimateMemory(binary, [...modelArguments, ...fitted])
    const hostMiB = rows.filter((row) => unifiedMemory || row.kind === MemoryKind.Host)
      .reduce((total, row) => total + row.self, 0)
    const devicesFit = rows.every((row) => row.kind !== MemoryKind.Device ||
      row.self <= row.free! - deviceReserve(row))
    if (hostMiB <= hostBudgetMiB && devicesFit) {
      const gpuLayers = Number(fitted[fitted.indexOf('-ngl') + 1])
      const deviceAllocations = rows.filter((row) => row.kind === MemoryKind.Device)
        .map((row) => ({
          name: row.name,
          estimatedMiB: row.self,
          budgetMiB: Math.max(0, row.free! - deviceReserve(row)),
          modelMiB: row.model,
          contextMiB: row.context,
          computeMiB: row.compute
        }))
      const usesGPU = gpuLayers !== 0 && deviceAllocations.some((device) => device.modelMiB > 0)
      const fullGPUModelMiB = devices.reduce((total, device) => total + device.model, 0)
      const residentGPUModelMiB = deviceAllocations.reduce((total, device) => total + device.modelMiB, 0)
      const executionMode = !usesGPU
        ? LlamaCPPExecutionMode.CPUOnly
        : gpuLayers >= 0 || fitted.includes('-ot')
          ? LlamaCPPExecutionMode.CPUOffload
          : LlamaCPPExecutionMode.GPU

      if (options.requireGPU && executionMode === LlamaCPPExecutionMode.CPUOnly) {
        throw new LlamaCPPCapacityError('I cannot use the detected GPU for this local model within the available memory budgets.')
      }

      return {
        arguments: [...fitted, '--fit', 'off', '--cache-ram', String(cacheMiB)],
        contextTokens, hostBudgetMiB, cacheMiB,
        memoryBudgetMiB: hostBudgetMiB + (unifiedMemory ? 0 : rows.filter((row) => row.kind === MemoryKind.Device).reduce(
          (total, row) => total + Math.max(0, row.free! - deviceReserve(row)), 0)),
        estimatedMiB: rows.reduce((total, row) => total + row.self, 0),
        hostEstimatedMiB: hostMiB,
        devices: deviceAllocations,
        executionMode,
        gpuLayers,
        // Compare weights with the initial all-GPU allocation so host-mapped
        // embeddings are not mistaken for layers executing on the CPU.
        cpuOffloadedModelRatio: fullGPUModelMiB > 0
          ? Math.max(0, Math.min(1, 1 - residentGPUModelMiB / fullGPUModelMiB))
          : 0,
        unifiedMemory,
        // Free system RAM cannot hide a nearly full discrete GPU.
        headroomRatio: Math.max(0, Math.min(
          1 - hostMiB / hostBudgetMiB,
          ...deviceAllocations.map((device) =>
            device.budgetMiB > 0 ? 1 - device.estimatedMiB / device.budgetMiB : 0
          )
        ))
      }
    }

    // Device fitting can spill weights into host RAM. Recheck the complete
    // placement and reduce context if either memory budget is still exceeded.
    if ((options.preserveContext && maximumContextTokens !== undefined) ||
        contextTokens <= MINIMUM_LOCAL_CONTEXT_TOKENS) {
      throw new LlamaCPPCapacityError('The local model cannot fit in available memory while retaining the memory reserve.')
    }
    contextLimit = Math.max(MINIMUM_LOCAL_CONTEXT_TOKENS,
      Math.floor(contextTokens / 2 / CONTEXT_ALIGNMENT) * CONTEXT_ALIGNMENT)
  }
}
