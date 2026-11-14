import fs from 'node:fs/promises'
import path from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectLocalLLM, rankLocalLLMPlans } from '@@/scripts/setup/local-llm-selection'
import { LOCAL_LLM_MODELS, LOCAL_LLM_PRECISIONS } from '@@/scripts/setup/local-llm-catalog'
import { LlamaCPPBackendError, LlamaCPPCapacityError, LlamaCPPExecutionMode } from '@/core/llm-manager/llm-providers/llamacpp-context'

const fixture = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  return {
    root: await fs.mkdtemp(path.join(os.tmpdir(), 'leon-model-selection-')),
    run: vi.fn(), get: vi.fn(), read: vi.fn(), fit: vi.fn(),
    budget: { hostBudgetMiB: 12_000, cacheMiB: 1_000, unifiedMemory: true },
    settings: {} as { context_size?: number, kv_cache_type?: 'q4_0' | 'q8_0' }
  }
})

vi.mock('@/constants', () => ({
  LLM_DIR_PATH: path.join(fixture.root, 'models'),
  LLMFIT_INSTALL_PATH: path.join(fixture.root, 'bin'),
  TMP_PATH: path.join(fixture.root, 'tmp'),
  MINIMUM_LOCAL_CONTEXT_TOKENS: 131_072,
  LLAMACPP_DEFAULT_KV_CACHE_TYPE: 'q8_0'
}))
vi.mock('@/config', () => ({
  CONFIG_MANAGER: { getConfig: (): object => ({ llm: { providers: { llamacpp: fixture.settings } } }) }
}))
vi.mock('@/helpers/runtime-helper', () => ({ RuntimeHelper: { runBinary: fixture.run } }))
vi.mock('@/helpers/system-helper', () => ({ SystemHelper: {
  isWindows: (): boolean => false,
  hasGPU: async (): Promise<boolean> => true,
  getFreeVRAM: async (): Promise<number> => 12
} }))
vi.mock('@/helpers/network-helper', () => ({ NetworkHelper: { setHuggingFaceURL: async (url: string): Promise<string> => url } }))
vi.mock('axios', () => ({ default: { get: fixture.get } }))
vi.mock('node-llama-cpp', () => ({ readGgufFileInfo: fixture.read }))
vi.mock('@/core/llm-manager/llm-providers/llamacpp-context', () => ({
  LlamaCPPCapacityError: class extends Error {},
  LlamaCPPBackendError: class extends Error {},
  LlamaCPPExecutionMode: { GPU: 'gpu', CPUOffload: 'cpu_offload', CPUOnly: 'cpu_only' },
  getLlamaCPPHostMemoryBudget: (): object => fixture.budget,
  getLlamaCPPServerBinaryPath: (): string => '/fixture/llama-server',
  getLlamaCPPModelArguments: (model: string, cacheType: string): string[] => [
    '--model', model, '--cache-type-k', cacheType, '--cache-type-v', cacheType
  ],
  resolveLlamaCPPContextPlan: fixture.fit
}))

beforeEach(() => {
  fixture.budget.hostBudgetMiB = 12_000
  fixture.budget.unifiedMemory = true
  fixture.settings = {}
  fixture.get.mockReset().mockImplementation(async (url: string, options?: { responseType?: string }) =>
    options?.responseType === 'arraybuffer' ? { data: Buffer.from('GGUF') } : { data: {
    sha: 'pinned-revision',
    siblings: LOCAL_LLM_MODELS.flatMap((model) => LOCAL_LLM_PRECISIONS.map((precision) => ({
      rfilename: `${model.filePrefix}-${precision.name}.gguf`,
      size: url.includes(model.repository) || url.includes(model.fullPrecisionRepository ?? model.repository)
        ? 1_024 : 0,
      lfs: { sha256: 'a'.repeat(64) }
    })))
    } })
  fixture.run.mockReset().mockImplementation(async (_binary: string, args: string[]) => JSON.stringify(
    args.includes('diff') ? { models: LOCAL_LLM_MODELS.map((model) => ({
      model: { name: model.id }, best_quant: 'Q8_0', score_components: { quality: 90 }
    })) } : { run_paths: [
      { path: 'gpu', feasible: true, estimated_tps: 25 },
      { path: 'cpu_offload', feasible: true, estimated_tps: 3 },
      { path: 'cpu_only', feasible: true, estimated_tps: 1 }
    ] }
  ))
  fixture.read.mockReset().mockResolvedValue({
    metadata: { general: { architecture: 'fixture' }, fixture: { context_length: 262_144 } },
    infoEndOffset: 4
  })
  fixture.fit.mockReset().mockResolvedValue({
    arguments: [], contextTokens: 262_144, hostBudgetMiB: 12_000,
    estimatedMiB: 8_000, cacheMiB: 1_000,
    executionMode: LlamaCPPExecutionMode.GPU, headroomRatio: 0.3
  })
})

afterAll(async () => {
  await fs.rm(fixture.root, { recursive: true, force: true })
})

describe('local model selection', () => {
  it('evaluates original precision through metadata and cleans up all planning files', async () => {
    await selectLocalLLM()
    expect(fixture.read.mock.calls.some(([url]) => url.includes('-BF16.gguf'))).toBe(true)
    expect(await fs.readdir(path.join(fixture.root, 'tmp'))).toEqual([])
  })

  it('rejects weights exceeding current available memory before fetching their headers', async () => {
    fixture.get.mockResolvedValue({ data: {
      sha: 'pinned-revision', siblings: LOCAL_LLM_MODELS.flatMap((model) =>
        LOCAL_LLM_PRECISIONS.map((precision) => ({
          rfilename: `${model.filePrefix}-${precision.name}.gguf`,
          size: 20_000 * 1_024 * 1_024, lfs: { sha256: 'a'.repeat(64) }
        })))
    } })
    await expect(selectLocalLLM()).rejects.toThrow('currently available memory')
    expect(fixture.read).not.toHaveBeenCalled()
  })

  it('uses another fitting model when native allocation rejects a candidate', async () => {
    fixture.fit.mockImplementation(async (_binary: string, args: string[]) => {
      if (args.some((arg) => arg.includes('Qwen3.8'))) {
        throw new LlamaCPPCapacityError('No available device memory')
      }
      return {
        arguments: [], contextTokens: 262_144, hostBudgetMiB: 12_000,
        estimatedMiB: 8_000, cacheMiB: 1_000,
        executionMode: LlamaCPPExecutionMode.GPU, headroomRatio: 0.3
      }
    })
    expect((await selectLocalLLM()).name).toBe('Ornith-1.5-9B')
  })

  it('skips models with insufficient native context without treating their metadata as broken', async () => {
    fixture.read.mockImplementation(async (file: string) => ({
      metadata: { general: { architecture: 'fixture' }, fixture: {
        context_length: file.includes('Qwen3.8') ? 65_536 : 262_144
      } },
      infoEndOffset: 4
    }))

    expect((await selectLocalLLM()).name).toBe('Ornith-1.5-9B')
    expect(await fs.readdir(path.join(fixture.root, 'tmp'))).toEqual([])
  })

  it('keeps discrete GPU capacity separate from the host memory budget', async () => {
    fixture.budget.unifiedMemory = false
    fixture.budget.hostBudgetMiB = 1
    const getMetadata = fixture.get.getMockImplementation()!
    fixture.get.mockImplementation(async (url: string, options?: { responseType?: string }) => {
      const result = await getMetadata(url, options)
      if (options?.responseType === 'arraybuffer') {
        return result
      }
      for (const file of result.data.siblings) {
        if (file.size > 0) {
          file.size = 2 * 1_024 * 1_024
        }
      }
      return result
    })
    await expect(selectLocalLLM()).resolves.toHaveProperty('precision')
    const args = fixture.run.mock.calls[0]![1] as string[]
    expect(args[args.indexOf('--memory') + 1]).toBe('12G')
  })

  it('does not silently downgrade after an incomplete metadata inspection', async () => {
    fixture.read.mockRejectedValueOnce(new Error('Metadata request timed out'))
    await expect(selectLocalLLM()).rejects.toThrow('could not finish assessing')
    expect(await fs.readdir(path.join(fixture.root, 'tmp'))).toEqual([])
  })

  it('stops probing candidates when the managed GPU backend is unavailable and cleans up', async () => {
    fixture.fit.mockRejectedValue(new LlamaCPPBackendError('GPU backend unavailable'))

    await expect(selectLocalLLM()).rejects.toThrow('GPU backend unavailable')
    expect(fixture.fit).toHaveBeenCalledTimes(1)
    expect(await fs.readdir(path.join(fixture.root, 'tmp'))).toEqual([])
  })

  it('prefers useful context over a marginal increase in weight precision', () => {
    const base = {
      maximumContextTokens: 262_144, quality: 90, estimatedTPS: 25, sizeBytes: 1_024,
      contextPlan: { contextTokens: 262_144, headroomRatio: 0.3,
        executionMode: LlamaCPPExecutionMode.GPU }
    }
    const ranked = rankLocalLLMPlans([
      { ...base, precision: 'Q6_K', quality: 89 },
      { ...base, precision: 'Q8_0', contextPlan: { ...base.contextPlan, contextTokens: 131_072 } }
    ])
    expect(ranked[0].precision).toBe('Q6_K')
  })

  it('estimates the native execution path at its fitted context with the same hardware budget', async () => {
    fixture.budget.unifiedMemory = false
    fixture.fit.mockResolvedValue({
      contextTokens: 262_144, headroomRatio: 0.3,
      executionMode: LlamaCPPExecutionMode.CPUOffload
    })

    const selected = await selectLocalLLM()
    const args = fixture.run.mock.calls.find(([, args]) => args.includes('plan'))![1] as string[]
    expect(args[args.indexOf('--context') + 1]).toBe('262144')
    expect(args[args.indexOf('--memory') + 1]).toBe('12G')
    expect(args[args.indexOf('--ram') + 1]).toBe(`${12_000 / 1_024}G`)
    expect(selected.estimatedTPS).toBe(3)
  })

  it('allows useful partial offload to compete on quality with full GPU execution', () => {
    const base = {
      maximumContextTokens: 262_144, estimatedTPS: 50, sizeBytes: 1_024,
      contextPlan: { contextTokens: 262_144, headroomRatio: 0.3 }
    }
    const ranked = rankLocalLLMPlans([
      { ...base, name: 'offloaded', quality: 100, estimatedTPS: 16,
        contextPlan: { ...base.contextPlan, executionMode: LlamaCPPExecutionMode.CPUOffload } },
      { ...base, name: 'accelerated', quality: 70,
        contextPlan: { ...base.contextPlan, executionMode: LlamaCPPExecutionMode.GPU } }
    ])

    expect(ranked[0].name).toBe('offloaded')
  })

  it('bounds dense offload throughput by the native CPU and GPU weight shares', async () => {
    fixture.budget.unifiedMemory = false
    fixture.fit.mockResolvedValue({
      contextTokens: 131_072, headroomRatio: 0.3,
      executionMode: LlamaCPPExecutionMode.CPUOffload, cpuOffloadedModelRatio: 0.5
    })

    const selected = await selectLocalLLM()
    expect(selected.estimatedTPS).toBeCloseTo(1 / (0.5 / 25 + 0.5 / 1))
    expect(selected.contextPlan.contextTokens).toBe(131_072)
  })

  it('uses conservative CPU throughput for unified-memory offload instead of hypothetical GPU speed', async () => {
    fixture.fit.mockResolvedValue({
      contextTokens: 262_144, headroomRatio: 0.3,
      executionMode: LlamaCPPExecutionMode.CPUOffload
    })
    const run = fixture.run.getMockImplementation()!
    fixture.run.mockImplementation(async (binary: string, args: string[]) => {
      const result = JSON.parse(await run(binary, args))
      if (result.run_paths) {
        result.run_paths.find((entry: { path: string }) => entry.path === 'cpu_offload').feasible = false
      }
      return JSON.stringify(result)
    })

    expect((await selectLocalLLM()).estimatedTPS).toBe(1)
  })

  it('prefers interactive replies over higher quality below the usability floor', () => {
    const base = {
      maximumContextTokens: 262_144, sizeBytes: 1_024,
      contextPlan: { contextTokens: 262_144, headroomRatio: 0.3,
        executionMode: LlamaCPPExecutionMode.GPU }
    }
    const ranked = rankLocalLLMPlans([
      { ...base, name: 'slower', quality: 95, estimatedTPS: 5 },
      { ...base, name: 'interactive', quality: 85, estimatedTPS: 50 }
    ])

    expect(ranked[0].name).toBe('interactive')
  })

  it('prefers a more capable interactive model with ample context over a faster smaller model', () => {
    const base = {
      maximumContextTokens: 262_144, sizeBytes: 1_024,
      contextPlan: { contextTokens: 262_144, headroomRatio: 0.3,
        executionMode: LlamaCPPExecutionMode.GPU }
    }
    const ranked = rankLocalLLMPlans([
      { ...base, name: 'smaller', quality: 79, estimatedTPS: 107 },
      { ...base, name: 'larger', quality: 99, estimatedTPS: 32,
        contextPlan: { ...base.contextPlan, contextTokens: 131_072, headroomRatio: 0.05 } }
    ])

    expect(ranked[0].name).toBe('larger')
  })

  it('values absolute usable context rather than the fraction of a models native maximum', () => {
    const base = {
      quality: 90, estimatedTPS: 30, sizeBytes: 1_024,
      contextPlan: { contextTokens: 131_072, headroomRatio: 0.3,
        executionMode: LlamaCPPExecutionMode.GPU }
    }
    const ranked = rankLocalLLMPlans([
      { ...base, name: 'short context', maximumContextTokens: 131_072 },
      { ...base, name: 'long context', maximumContextTokens: 524_288,
        contextPlan: { ...base.contextPlan, contextTokens: 262_144 } }
    ])

    expect(ranked[0].name).toBe('long context')
  })

  it('retains the fastest fallback when every fitting model is below interactive speed', () => {
    const base = {
      maximumContextTokens: 262_144, sizeBytes: 1_024,
      contextPlan: { contextTokens: 262_144, headroomRatio: 0.3,
        executionMode: LlamaCPPExecutionMode.CPUOnly }
    }
    const ranked = rankLocalLLMPlans([
      { ...base, name: 'slower', quality: 99, estimatedTPS: 2 },
      { ...base, name: 'faster', quality: 79, estimatedTPS: 8 }
    ])

    expect(ranked[0].name).toBe('faster')
  })

  it('uses the owners KV precision and fixed context for native fitting and throughput estimates', async () => {
    fixture.settings = { kv_cache_type: 'q4_0', context_size: 65_536 }
    fixture.fit.mockResolvedValue({
      contextTokens: 65_536, headroomRatio: 0.3,
      executionMode: LlamaCPPExecutionMode.GPU
    })

    await selectLocalLLM()
    const fitArgs = fixture.fit.mock.calls[0]!
    expect(fitArgs[1]).toEqual(expect.arrayContaining([
      '--cache-type-k', 'q4_0', '--cache-type-v', 'q4_0'
    ]))
    expect(fitArgs[3]).toBe(65_536)
    expect(fitArgs[4]).toMatchObject({ preserveContext: true })
    const args = fixture.run.mock.calls.find(([, args]) => args.includes('plan'))![1] as string[]
    expect(args[args.indexOf('--kv-quant') + 1]).toBe('q4_0')
    expect(args[args.indexOf('--context') + 1]).toBe('65536')
  })
})
