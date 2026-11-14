import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import axios from 'axios'

import {
  LLM_DIR_PATH, LLMFIT_INSTALL_PATH, TMP_PATH,
  MINIMUM_LOCAL_CONTEXT_TOKENS, LLAMACPP_DEFAULT_KV_CACHE_TYPE
} from '@/constants'
import { CONFIG_MANAGER } from '@/config'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { NetworkHelper } from '@/helpers/network-helper'
import {
  getLlamaCPPHostMemoryBudget,
  getLlamaCPPModelArguments,
  getLlamaCPPServerBinaryPath,
  resolveLlamaCPPContextPlan,
  LlamaCPPExecutionMode,
  LlamaCPPBackendError,
  LlamaCPPCapacityError
} from '@/core/llm-manager/llm-providers/llamacpp-context'

import { LOCAL_LLM_MODELS, LOCAL_LLM_PRECISIONS } from './local-llm-catalog'

const MIB_PER_GIB = 1_024
const BYTES_PER_MIB = 1_024 * 1_024
const INSPECTION_TIMEOUT_MS = 60_000
const METADATA_TIMEOUT_MS = 30_000
const GGUF_HEADER_PREFIX_BYTES = 16 * BYTES_PER_MIB
const MODEL_URL = 'https://huggingface.co'
const ROI_WEIGHTS = { quality: 0.7, speed: 0.1, context: 0.15, headroom: 0.05 }
// Decode estimates are a usability filter, not a benchmark: once replies are
// interactive, additional speed should not dominate model capability.
const MINIMUM_INTERACTIVE_TPS = 10
const TARGET_INTERACTIVE_TPS = 20
const CATALOG_QUANT_PENALTIES = new Map([
  ...LOCAL_LLM_PRECISIONS.map(({ name, qualityPenalty }) => [name, qualityPenalty]),
  ['mlx-8bit', 0], ['mlx-4bit', 4], ['Q3_K_M', 8], ['Q2_K', 12]
])
const IGNORED_GGUF_KEYS = [
  'tokenizer.ggml.tokens', 'tokenizer.ggml.scores',
  'tokenizer.ggml.token_type', 'tokenizer.ggml.merges'
]

async function runLLMFit(args) {
  const binary = path.join(LLMFIT_INSTALL_PATH,
    SystemHelper.isWindows() ? 'llmfit.exe' : 'llmfit')
  const output = await RuntimeHelper.runBinary(binary,
    ['--no-dashboard', '--no-cluster', ...args, '--json'],
    { timeoutMs: INSPECTION_TIMEOUT_MS })

  return JSON.parse(output)
}

/**
 * Verify large cached weights incrementally before reusing or publishing them.
 */
export async function isLocalLLMFileVerified(filePath, selected) {
  const stat = await fs.promises.stat(filePath).catch(() => null)
  if (!stat?.isFile() || stat.size !== selected.sizeBytes) {
    return false
  }

  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk)
  }

  return hash.digest('hex') === selected.checksum
}

/**
 * Keep an installed build stable when a publisher reuses its GGUF filename.
 */
export async function resolveLocalLLMInstallation(selected) {
  const original = path.join(LLM_DIR_PATH, selected.fileName)
  if (await isLocalLLMFileVerified(original, selected)) {
    return { targetPath: original, verified: true }
  }
  if (!fs.existsSync(original)) {
    return { targetPath: original, verified: false }
  }

  const extension = path.extname(selected.fileName)
  const filename = `${path.basename(selected.fileName, extension)}-${selected.checksum}${extension}`
  const targetPath = path.join(LLM_DIR_PATH, filename)
  return { targetPath, verified: await isLocalLLMFileVerified(targetPath, selected) }
}

/**
 * Prefer interactive plans, then balance capability, speed and usable context.
 * Planning estimates do not guarantee measured accuracy or inference latency.
 */
export function rankLocalLLMPlans(candidates) {
  const hasInteractivePlan = candidates.some((candidate) =>
    candidate.estimatedTPS >= MINIMUM_INTERACTIVE_TPS)
  const maximumContext = Math.max(MINIMUM_LOCAL_CONTEXT_TOKENS,
    ...candidates.map((candidate) => candidate.contextPlan.contextTokens))

  return candidates.map((candidate) => {
    // Compare absolute usable context with diminishing returns. A model's native
    // maximum does not make a smaller fitted window less useful than its peers'.
    const context = Math.log2(1 + candidate.contextPlan.contextTokens / MINIMUM_LOCAL_CONTEXT_TOKENS) /
      Math.log2(1 + maximumContext / MINIMUM_LOCAL_CONTEXT_TOKENS)
    const speed = 1 - Math.exp(-candidate.estimatedTPS / TARGET_INTERACTIVE_TPS)
    const score = candidate.quality * ROI_WEIGHTS.quality +
      100 * speed * ROI_WEIGHTS.speed +
      100 * context * ROI_WEIGHTS.context +
      100 * candidate.contextPlan.headroomRatio * ROI_WEIGHTS.headroom

    return { ...candidate, score }
  }).sort((first, second) =>
    // If every plan is slow, retain the fastest fallback. Otherwise a useful
    // CPU/GPU split can compete on quality without an absolute placement veto.
    (hasInteractivePlan
      ? Number(second.estimatedTPS >= MINIMUM_INTERACTIVE_TPS) -
        Number(first.estimatedTPS >= MINIMUM_INTERACTIVE_TPS)
      : second.estimatedTPS - first.estimatedTPS) ||
    second.score - first.score ||
    first.sizeBytes - second.sizeBytes)
}

async function readRepository(repository) {
  const url = await NetworkHelper.setHuggingFaceURL(
    `${MODEL_URL}/api/models/${repository}?blobs=true`
  )
  const { data } = await axios.get(url, { timeout: METADATA_TIMEOUT_MS })

  if (typeof data.sha !== 'string' || !Array.isArray(data.siblings)) {
    throw new Error(`Missing model file metadata for ${repository}.`)
  }

  return data
}

async function inspectCandidate(candidate, directory, binary, settings, readGgufFileInfo, hardware) {
  // One bounded range avoids repeated CDN round trips for large tokenizers.
  // Reject servers that ignore Range instead of downloading weights for a probe.
  const modelPath = path.join(directory, candidate.fileName)
  const prefixBytes = Math.min(GGUF_HEADER_PREFIX_BYTES, candidate.sizeBytes)
  const { data } = await axios.get(candidate.downloadURL, {
    headers: { Range: `bytes=0-${prefixBytes - 1}` },
    responseType: 'arraybuffer',
    maxContentLength: prefixBytes,
    timeout: METADATA_TIMEOUT_MS,
    validateStatus: (status) => status === 206
  })
  await fs.promises.writeFile(modelPath, data)
  const info = await readGgufFileInfo(modelPath, {
    readTensorInfo: true,
    logWarnings: false,
    spliceSplitFiles: false,
    ignoreKeys: IGNORED_GGUF_KEYS,
    signal: AbortSignal.timeout(INSPECTION_TIMEOUT_MS)
  })
  const architecture = info.metadata.general.architecture
  const maximumContextTokens = info.metadata[architecture]?.context_length
  if (!Number.isSafeInteger(maximumContextTokens) || maximumContextTokens < 1) {
    throw new Error(`Invalid native context metadata for ${candidate.fileName}.`)
  }
  if (settings?.context_size === undefined && maximumContextTokens < MINIMUM_LOCAL_CONTEXT_TOKENS) {
    throw new LlamaCPPCapacityError(`The model's native context is below the required ${MINIMUM_LOCAL_CONTEXT_TOKENS.toLocaleString('en-US')} tokens.`)
  }

  if (!Number.isSafeInteger(info.infoEndOffset) || info.infoEndOffset > data.length) {
    throw new Error(`Incomplete GGUF header for ${candidate.fileName}.`)
  }
  // Native fitting checks original file bounds without allocating weights.
  // Sparse extension preserves those bounds without model-size disk allocation.
  if (SystemHelper.isWindows()) {
    await RuntimeHelper.runBinary('fsutil.exe', ['sparse', 'setflag', modelPath],
      { timeoutMs: METADATA_TIMEOUT_MS })
  }
  await fs.promises.truncate(modelPath, candidate.sizeBytes)

  const kvCacheType = settings?.kv_cache_type ?? LLAMACPP_DEFAULT_KV_CACHE_TYPE
  const contextPlan = await resolveLlamaCPPContextPlan(binary,
    getLlamaCPPModelArguments(modelPath, kvCacheType),
    settings?.memory_reserve_mib, settings?.context_size,
    { requireGPU: hardware.hasGPU, preserveContext: settings?.context_size !== undefined })
  // Match the native placement rather than attaching hypothetical GPU speed to
  // a CPU allocation. Native memory estimates remain authoritative for fit.
  const estimate = await runLLMFit([
    ...hardware.arguments,
    'plan', candidate.modelId, '--context', String(contextPlan.contextTokens),
    '--quant', candidate.precision, '--kv-quant', kvCacheType
  ])
  let speedEstimate = estimate.run_paths?.find((entry) =>
    entry.path === contextPlan.executionMode && entry.feasible)
  // llmfit omits CPU offload estimates on unified memory. CPU-only throughput
  // is a conservative comparison for such placements, never full-GPU speed.
  if (!speedEstimate && hardware.unifiedMemory &&
      contextPlan.executionMode === LlamaCPPExecutionMode.CPUOffload) {
    speedEstimate = estimate.run_paths?.find((entry) =>
      entry.path === LlamaCPPExecutionMode.CPUOnly && entry.feasible)
  }
  let estimatedTPS = speedEstimate?.estimated_tps
  const cpuShare = contextPlan.cpuOffloadedModelRatio
  if (!candidate.isMoE && contextPlan.executionMode === LlamaCPPExecutionMode.CPUOffload && cpuShare > 0) {
    const gpuTPS = estimate.run_paths?.find((entry) =>
      entry.path === LlamaCPPExecutionMode.GPU && entry.feasible)?.estimated_tps
    const cpuTPS = estimate.run_paths?.find((entry) =>
      entry.path === LlamaCPPExecutionMode.CPUOnly && entry.feasible)?.estimated_tps
    if (!Number.isFinite(gpuTPS) || gpuTPS <= 0 || !Number.isFinite(cpuTPS) || cpuTPS <= 0) {
      throw new Error(`Missing placement throughput estimates for ${candidate.fileName}.`)
    }

    // Dense layers run sequentially across devices. Bound the catalog estimate
    // by the time spent on each native weight share at its respective speed.
    estimatedTPS = Math.min(estimatedTPS,
      1 / ((1 - cpuShare) / gpuTPS + cpuShare / cpuTPS))
  }
  if (!Number.isFinite(estimatedTPS) || estimatedTPS <= 0) {
    throw new Error(`Missing throughput estimate for ${candidate.fileName}.`)
  }

  return { ...candidate, kvCacheType, maximumContextTokens: Math.min(maximumContextTokens,
    settings?.context_size ?? maximumContextTokens), contextPlan, estimatedTPS }
}

/**
 * Plan a supported local model against current resources before downloading its
 * weights. Native allocation checks take precedence over catalog memory guesses.
 */
export async function planLocalLLMs(onProgress = () => {}, capability) {
  const settings = CONFIG_MANAGER.getConfig().llm.providers?.llamacpp
  const { hostBudgetMiB, unifiedMemory } = getLlamaCPPHostMemoryBudget(settings?.memory_reserve_mib)
  const availableGiB = hostBudgetMiB / MIB_PER_GIB
  const hasGPU = capability?.hasGPU ?? await SystemHelper.hasGPU()
  const availableVRAM = hasGPU ? await SystemHelper.getFreeVRAM() : 0
  if (hasGPU && availableVRAM <= 0) {
    throw new LlamaCPPCapacityError('I could not find available GPU memory for local AI.')
  }
  const hardware = { hasGPU, unifiedMemory, arguments: [
    ...(hasGPU ? ['--memory', `${unifiedMemory ? Math.min(availableVRAM, availableGiB) : availableVRAM}G`] : []),
    '--ram', `${availableGiB}G`
  ] }
  const comparison = await runLLMFit([
    ...hardware.arguments,
    '--max-context', String(MINIMUM_LOCAL_CONTEXT_TOKENS),
    'diff', ...LOCAL_LLM_MODELS.map((model) => model.id)
  ])
  const repositories = new Map()
  const candidates = []
  const weightBudgetMiB = hostBudgetMiB + (unifiedMemory ? 0 : availableVRAM * MIB_PER_GIB)

  for (const model of LOCAL_LLM_MODELS) {
    const recommendation = comparison.models?.find((entry) => entry.model?.name === model.id)
    if (!Number.isFinite(recommendation?.score_components?.quality)) {
      throw new Error(`llmfit did not assess ${model.id}.`)
    }
    const baselinePenalty = CATALOG_QUANT_PENALTIES.get(recommendation.best_quant)
    if (baselinePenalty === undefined) {
      throw new Error(`Unsupported llmfit precision: ${recommendation.best_quant}.`)
    }

    for (const precision of LOCAL_LLM_PRECISIONS) {
      const repository = precision.name === 'BF16'
        ? model.fullPrecisionRepository || model.repository
        : model.repository
      if (!repositories.has(repository)) {
        repositories.set(repository, await readRepository(repository))
      }
      const metadata = repositories.get(repository)
      const fileName = `${model.filePrefix}-${precision.name}.gguf`
      const file = metadata.siblings.find((entry) => entry.rfilename === fileName)
      const sizeBytes = file?.size
      // Reject impossible weights before spending network traffic on headers.
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 ||
          sizeBytes > weightBudgetMiB * BYTES_PER_MIB) {
        continue
      }
      const checksum = file.lfs?.sha256
      if (typeof checksum !== 'string' || checksum.length !== 64) {
        throw new Error(`Missing weight checksum for ${fileName}.`)
      }

      candidates.push({
        modelId: model.id, name: model.name, repository,
        isMoE: recommendation.model.is_moe === true,
        revision: metadata.sha, precision: precision.name,
        quality: Math.min(100, recommendation.score_components.quality +
          baselinePenalty - precision.qualityPenalty),
        fileName, sizeBytes, checksum,
        downloadURL: await NetworkHelper.setHuggingFaceURL(
          `${MODEL_URL}/${repository}/resolve/${metadata.sha}/${fileName}`
        )
      })
    }
  }

  await fs.promises.mkdir(TMP_PATH, { recursive: true })
  const binary = getLlamaCPPServerBinaryPath()
  const { readGgufFileInfo } = await import('node-llama-cpp')
  const directory = await fs.promises.mkdtemp(path.join(TMP_PATH, 'local-llm-plan-'))
  const plans = []
  const failures = []

  try {
    // Native probes share the GPU's allocator and free-memory counters.
    // Run them serially so one probe cannot constrain another candidate.
    for (const candidate of candidates) {
      onProgress(`Assessing ${candidate.name} ${candidate.precision}...`)
      try {
        plans.push(await inspectCandidate(candidate, directory, binary, settings, readGgufFileInfo, hardware))
      } catch (error) {
        if (error instanceof LlamaCPPBackendError) {
          throw error
        }
        if (!(error instanceof LlamaCPPCapacityError)) {
          failures.push(`${candidate.fileName}: ${error.message}`)
        }
      }
    }
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true })
  }

  // Metadata failures must not silently turn a temporary network outage into a
  // permanent model downgrade. Capacity failures are normal candidate rejection.
  if (failures.length > 0) {
    throw new Error(`I could not finish assessing the local models. ${failures.join(' ')}`)
  }
  if (plans.length === 0) {
    const context = (settings?.context_size ?? MINIMUM_LOCAL_CONTEXT_TOKENS).toLocaleString('en-US')
    throw new LlamaCPPCapacityError(`I could not fit a supported local model with at least ${context} tokens of context in the currently available memory. Close other applications and retry.`)
  }

  await fs.promises.mkdir(LLM_DIR_PATH, { recursive: true })
  const disk = await fs.promises.statfs(LLM_DIR_PATH)
  const available = []
  for (const candidate of rankLocalLLMPlans(plans)) {
    if (disk.bavail * disk.bsize >= candidate.sizeBytes ||
        (await resolveLocalLLMInstallation(candidate)).verified) {
      available.push(candidate)
    }
  }

  if (available.length === 0) {
    throw new Error('I do not have enough free disk space to install a supported local model while keeping existing models.')
  }
  return available
}

/**
 * Select the highest-ranked plan that fits current memory and disk budgets.
 */
export async function selectLocalLLM(onProgress = () => {}, capability) {
  const [selected] = await planLocalLLMs(onProgress, capability)
  return selected
}
