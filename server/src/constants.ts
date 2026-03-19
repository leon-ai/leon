import path from 'node:path'
import fs from 'node:fs'

import dotenv from 'dotenv'

import type { LongLanguageCode } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'

dotenv.config()

const PRODUCTION_ENV = 'production'
const DEVELOPMENT_ENV = 'development'
const TESTING_ENV = 'testing'

export const GITHUB_URL = 'https://github.com/leon-ai/leon'
export const API_VERSION = 'v1'

export const { default: LANG_CONFIGS } = await import('@@/core/langs.json', {
  with: { type: 'json' }
})

/**
 * Environments
 */
export const LEON_NODE_ENV = process.env['LEON_NODE_ENV'] || PRODUCTION_ENV
export const IS_PRODUCTION_ENV = LEON_NODE_ENV === PRODUCTION_ENV
export const IS_DEVELOPMENT_ENV = LEON_NODE_ENV === DEVELOPMENT_ENV
export const IS_TESTING_ENV = LEON_NODE_ENV === TESTING_ENV

/**
 * Paths
 */
export const BIN_PATH = path.join(process.cwd(), 'bin')
export const LOGS_PATH = path.join(process.cwd(), 'logs')
export const SKILLS_PATH = path.join(process.cwd(), 'skills')
export const GLOBAL_CORE_PATH = path.join(process.cwd(), 'core')
export const GLOBAL_DATA_PATH = path.join(GLOBAL_CORE_PATH, 'data')
export const CONTEXT_PATH = path.join(GLOBAL_CORE_PATH, 'context')
export const MEMORY_PATH = path.join(GLOBAL_CORE_PATH, 'memory')
export const MEMORY_DB_PATH = path.join(MEMORY_PATH, 'index.sqlite')
export const MODELS_PATH = path.join(GLOBAL_DATA_PATH, 'models')
export const AUDIO_MODELS_PATH = path.join(MODELS_PATH, 'audio')
export const VOICE_CONFIG_PATH = path.join(
  GLOBAL_CORE_PATH,
  'config',
  'voice'
)
export const SERVER_PATH = path.join(
  process.cwd(),
  'server',
  IS_PRODUCTION_ENV ? 'dist' : 'src'
)
export const TMP_PATH = path.join(SERVER_PATH, 'tmp')
export const SERVER_CORE_PATH = path.join(SERVER_PATH, 'core')
export const LEON_FILE_PATH = path.join(process.cwd(), 'leon.json')

/**
 * NVIDIA paths and versions.
 * Used as a common layer across tools.
 *
 * Different binaries need different cuSPARSE libs, hence:
 * cusparse is for libcusparseLt.so.*
 * cusparse_full is for libcusparse.so.*
 */
export const NVIDIA_LIBS_PATH = path.join(BIN_PATH, 'nvidia')
export const NVIDIA_CUBLAS_PATH = path.join(NVIDIA_LIBS_PATH, 'cublas')
export const NVIDIA_CUDNN_PATH = path.join(NVIDIA_LIBS_PATH, 'cudnn')
export const NVIDIA_CUDA_CUDART_PATH = path.join(
  NVIDIA_LIBS_PATH,
  'cuda_cudart'
)
export const NVIDIA_CUDA_CUPTI_PATH = path.join(
  NVIDIA_LIBS_PATH,
  'cuda_cupti'
)
export const NVIDIA_CUSPARSE_PATH = path.join(NVIDIA_LIBS_PATH, 'cusparse')
export const NVIDIA_CUSPARSELT_PATH = path.join(NVIDIA_LIBS_PATH, 'cusparselt')
export const NVIDIA_CUSPARSE_FULL_PATH = path.join(
  NVIDIA_LIBS_PATH,
  'cusparse_full'
)
export const NVIDIA_NCCL_PATH = path.join(NVIDIA_LIBS_PATH, 'nccl')
export const NVIDIA_NVSHMEM_PATH = path.join(NVIDIA_LIBS_PATH, 'nvshmem')
export const NVIDIA_NVJITLINK_PATH = path.join(NVIDIA_LIBS_PATH, 'nvjitlink')
export const NVIDIA_VERSIONS_PATH = path.join(NVIDIA_LIBS_PATH, 'versions.json')
export const NVIDIA_CUBLAS_MANIFEST_PATH = path.join(
  NVIDIA_CUBLAS_PATH,
  'manifest.json'
)
export const NVIDIA_CUDNN_MANIFEST_PATH = path.join(
  NVIDIA_CUDNN_PATH,
  'manifest.json'
)
export const NVIDIA_CUDA_CUDART_MANIFEST_PATH = path.join(
  NVIDIA_CUDA_CUDART_PATH,
  'manifest.json'
)
export const NVIDIA_CUDA_CUPTI_MANIFEST_PATH = path.join(
  NVIDIA_CUDA_CUPTI_PATH,
  'manifest.json'
)
export const NVIDIA_CUSPARSE_MANIFEST_PATH = path.join(
  NVIDIA_CUSPARSE_PATH,
  'manifest.json'
)
export const NVIDIA_CUSPARSE_FULL_MANIFEST_PATH = path.join(
  NVIDIA_CUSPARSE_FULL_PATH,
  'manifest.json'
)
export const NVIDIA_NCCL_MANIFEST_PATH = path.join(
  NVIDIA_NCCL_PATH,
  'manifest.json'
)
export const NVIDIA_NVSHMEM_MANIFEST_PATH = path.join(
  NVIDIA_NVSHMEM_PATH,
  'manifest.json'
)
export const NVIDIA_NVJITLINK_MANIFEST_PATH = path.join(
  NVIDIA_NVJITLINK_PATH,
  'manifest.json'
)
const NVIDIA_VERSIONS = JSON.parse(
  fs.readFileSync(NVIDIA_VERSIONS_PATH, 'utf8')
)
export const NVIDIA_CUDA_VERSION = NVIDIA_VERSIONS.cuda
export const NVIDIA_CUDNN_VERSION = NVIDIA_VERSIONS.cudnn
export const NVIDIA_CUBLAS_VERSION = NVIDIA_VERSIONS.cublas
export const NVIDIA_CUDA_CUDART_VERSION = NVIDIA_VERSIONS.cuda_cudart
export const NVIDIA_CUDA_CUPTI_VERSION = NVIDIA_VERSIONS.cuda_cupti
export const NVIDIA_CUSPARSE_VERSION = NVIDIA_VERSIONS.cusparse
export const NVIDIA_CUSPARSE_FULL_VERSION = NVIDIA_VERSIONS.cusparse_full
export const NVIDIA_NCCL_VERSION = NVIDIA_VERSIONS.nccl
export const NVIDIA_NVSHMEM_VERSION = NVIDIA_VERSIONS.nvshmem
export const NVIDIA_NVJITLINK_VERSION = NVIDIA_VERSIONS.nvjitlink

/**
 * CMake paths and versions.
 * Used as a common layer across tools.
 */
export const CMAKE_PATH = path.join(BIN_PATH, 'cmake')
export const CMAKE_VERSIONS_PATH = path.join(CMAKE_PATH, 'versions.json')
export const CMAKE_INSTALL_PATH = path.join(CMAKE_PATH, 'cmake')
export const CMAKE_MANIFEST_PATH = path.join(CMAKE_INSTALL_PATH, 'manifest.json')
const CMAKE_VERSIONS = JSON.parse(fs.readFileSync(CMAKE_VERSIONS_PATH, 'utf8'))
export const CMAKE_VERSION = CMAKE_VERSIONS.cmake
export const CMAKE_BIN_PATH = path.join(CMAKE_INSTALL_PATH, 'bin', 'cmake')

/**
 * Ninja paths and versions.
 * Used as a common layer across tools.
 */
export const NINJA_PATH = path.join(BIN_PATH, 'ninja')
export const NINJA_VERSIONS_PATH = path.join(NINJA_PATH, 'versions.json')
export const NINJA_INSTALL_PATH = path.join(NINJA_PATH, 'ninja')
export const NINJA_MANIFEST_PATH = path.join(NINJA_INSTALL_PATH, 'manifest.json')
const NINJA_VERSIONS = JSON.parse(fs.readFileSync(NINJA_VERSIONS_PATH, 'utf8'))
export const NINJA_VERSION = NINJA_VERSIONS.ninja
export const NINJA_BIN_PATH = path.join(NINJA_INSTALL_PATH, 'ninja')

/**
 * llama.cpp paths and versions.
 * Used as a common layer across tools.
 */
export const LLAMACPP_PATH = path.join(BIN_PATH, 'llama.cpp')
export const LLAMACPP_VERSIONS_PATH = path.join(LLAMACPP_PATH, 'versions.json')
export const LLAMACPP_BUILD_PATH = path.join(LLAMACPP_PATH, 'build')
export const LLAMACPP_SOURCE_PATH = path.join(LLAMACPP_PATH, 'llama.cpp')
export const LLAMACPP_SOURCE_BUILD_PATH = path.join(
  LLAMACPP_SOURCE_PATH,
  'build',
  'bin'
)
export const LLAMACPP_ROOT_MANIFEST_PATH = path.join(LLAMACPP_PATH, 'manifest.json')
export const LLAMACPP_BUILD_MANIFEST_PATH = path.join(
  LLAMACPP_BUILD_PATH,
  'manifest.json'
)
export const LLAMACPP_SOURCE_MANIFEST_PATH = path.join(
  LLAMACPP_SOURCE_PATH,
  'manifest.json'
)
const LLAMACPP_VERSIONS = JSON.parse(
  fs.readFileSync(LLAMACPP_VERSIONS_PATH, 'utf8')
)
export const LLAMACPP_RELEASE_VERSION = LLAMACPP_VERSIONS['llama.cpp']

/**
 * PyTorch paths and versions.
 * Used as a common layer across tools
 */
export const PYTORCH_PATH = path.join(BIN_PATH, 'pytorch')
export const PYTORCH_TORCH_PATH = path.join(PYTORCH_PATH, 'torch')
export const PYTORCH_NVIDIA_PATH = path.join(PYTORCH_TORCH_PATH, 'nvidia')
export const PYTORCH_VERSIONS_PATH = path.join(PYTORCH_PATH, 'versions.json')
export const PYTORCH_MANIFEST_PATH = path.join(
  PYTORCH_TORCH_PATH,
  'manifest.json'
)
const PYTORCH_VERSIONS = JSON.parse(
  fs.readFileSync(PYTORCH_VERSIONS_PATH, 'utf8')
)
export const PYTORCH_VERSION = PYTORCH_VERSIONS.torch

/**
 * Binaries / distribution
 */
export const BINARIES_FOLDER_NAME = SystemHelper.getBinariesFolderName()
export const BRIDGES_PATH = path.join(process.cwd(), 'bridges')
export const TOOLKITS_PATH = path.join(BRIDGES_PATH, 'toolkits')
export const NODEJS_BRIDGE_ROOT_PATH = path.join(BRIDGES_PATH, 'nodejs')
export const PYTHON_BRIDGE_ROOT_PATH = path.join(BRIDGES_PATH, 'python')
export const PYTHON_TCP_SERVER_ROOT_PATH = path.join(
  process.cwd(),
  'tcp_server'
)

export const NODEJS_BRIDGE_DIST_PATH = path.join(
  NODEJS_BRIDGE_ROOT_PATH,
  'dist'
)
export const PYTHON_BRIDGE_DIST_PATH = path.join(
  PYTHON_BRIDGE_ROOT_PATH,
  'dist'
)
export const PYTHON_TCP_SERVER_DIST_PATH = path.join(
  PYTHON_TCP_SERVER_ROOT_PATH,
  'dist'
)

export const NODEJS_BRIDGE_SRC_PATH = path.join(NODEJS_BRIDGE_ROOT_PATH, 'src')
export const NODEJS_BRIDGE_TOOL_RUNTIME_SRC_PATH = path.join(
  NODEJS_BRIDGE_SRC_PATH,
  'tool-runtime.ts'
)
export const NODEJS_BRIDGE_TOOL_RUNTIME_DIST_PATH = path.join(
  NODEJS_BRIDGE_DIST_PATH,
  'tool-runtime.js'
)
export const PYTHON_BRIDGE_SRC_PATH = path.join(PYTHON_BRIDGE_ROOT_PATH, 'src')
export const PYTHON_TCP_SERVER_SRC_PATH = path.join(
  PYTHON_TCP_SERVER_ROOT_PATH,
  'src'
)
export const PYTHON_TCP_SERVER_SETTINGS_PATH = path.join(
  PYTHON_TCP_SERVER_ROOT_PATH,
  'settings.json'
)
export const PYTHON_TCP_SERVER_SETTINGS = JSON.parse(
  fs.readFileSync(PYTHON_TCP_SERVER_SETTINGS_PATH, 'utf8')
)
export const PYTHON_TCP_SERVER_TTS_MODEL_FILE_NAME =
  PYTHON_TCP_SERVER_SETTINGS.tts.model_file_name
export const PYTHON_TCP_SERVER_TTS_MODEL_DIR_PATH = path.join(
  AUDIO_MODELS_PATH,
  'tts'
)
export const PYTHON_TCP_SERVER_TTS_MODEL_PATH = path.join(
  PYTHON_TCP_SERVER_TTS_MODEL_DIR_PATH,
  PYTHON_TCP_SERVER_TTS_MODEL_FILE_NAME
)
export const PYTHON_TCP_SERVER_TTS_BERT_FRENCH_DIR_PATH = path.join(
  PYTHON_TCP_SERVER_TTS_MODEL_DIR_PATH,
  'bert-base-french-europeana-cased'
)
export const PYTHON_TCP_SERVER_TTS_BERT_BASE_DIR_PATH = path.join(
  PYTHON_TCP_SERVER_TTS_MODEL_DIR_PATH,
  'bert-base-uncased'
)
export const PYTHON_TCP_SERVER_ASR_MODEL_DIR_PATH = path.join(
  AUDIO_MODELS_PATH,
  'asr'
)
export const PYTHON_TCP_SERVER_TTS_MODEL_HF_DOWNLOAD_URL = `https://huggingface.co/Louistiti/Voice-EN-Leon-V1/resolve/main/${PYTHON_TCP_SERVER_TTS_MODEL_FILE_NAME}?download=true`
export const PYTHON_TCP_SERVER_ASR_MODEL_HF_PREFIX_DOWNLOAD_URL =
  'https://huggingface.co/Systran/faster-distil-whisper-large-v3/resolve/main'
export const PYTHON_TCP_SERVER_TTS_BERT_FRENCH_MODEL_HF_PREFIX_DOWNLOAD_URL =
  'https://huggingface.co/dbmdz/bert-base-french-europeana-cased/resolve/main'
export const PYTHON_TCP_SERVER_TTS_BERT_BASE_MODEL_HF_PREFIX_DOWNLOAD_URL =
  'https://huggingface.co/google-bert/bert-base-uncased/resolve/main'

const NODEJS_BRIDGE_VERSION_FILE_PATH = path.join(
  NODEJS_BRIDGE_SRC_PATH,
  'version.ts'
)
const PYTHON_BRIDGE_VERSION_FILE_PATH = path.join(
  PYTHON_BRIDGE_SRC_PATH,
  'version.py'
)
const PYTHON_TCP_SERVER_VERSION_FILE_PATH = path.join(
  PYTHON_TCP_SERVER_SRC_PATH,
  'version.py'
)
export const [, NODEJS_BRIDGE_VERSION] = fs
  .readFileSync(NODEJS_BRIDGE_VERSION_FILE_PATH, 'utf8')
  .split('\'')
export const [, PYTHON_BRIDGE_VERSION] = fs
  .readFileSync(PYTHON_BRIDGE_VERSION_FILE_PATH, 'utf8')
  .split('\'')
export const [, PYTHON_TCP_SERVER_VERSION] = fs
  .readFileSync(PYTHON_TCP_SERVER_VERSION_FILE_PATH, 'utf8')
  .split('\'')

export const NODEJS_BRIDGE_BIN_NAME = 'leon-nodejs-bridge.cjs'
export const PYTHON_BRIDGE_BIN_NAME = 'leon-python-bridge'
export const PYTHON_TCP_SERVER_BIN_NAME = 'leon-tcp-server'

export const PYTHON_TCP_SERVER_BIN_PATH = path.join(
  PYTHON_TCP_SERVER_DIST_PATH,
  BINARIES_FOLDER_NAME,
  PYTHON_TCP_SERVER_BIN_NAME
)
export const PYTHON_BRIDGE_BIN_PATH = path.join(
  PYTHON_BRIDGE_DIST_PATH,
  BINARIES_FOLDER_NAME,
  PYTHON_BRIDGE_BIN_NAME
)
export const NODEJS_BRIDGE_BIN_PATH = `${path.join(
  process.cwd(),
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
)} ${path.join(NODEJS_BRIDGE_DIST_PATH, 'bin', NODEJS_BRIDGE_BIN_NAME)}`
export const TSX_CLI_PATH = path.join(
  process.cwd(),
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
)

export const LEON_VERSION = process.env['npm_package_version']

/**
 * spaCy models
 * @see Find new spaCy models: https://github.com/explosion/spacy-models/releases
 */
export const EN_SPACY_MODEL_NAME = 'en_core_web_trf'
export const EN_SPACY_MODEL_VERSION = '3.4.0'
export const FR_SPACY_MODEL_NAME = 'fr_core_news_md'
export const FR_SPACY_MODEL_VERSION = '3.4.0'

/**
 * Leon environment preferences
 */
export const LANG = process.env['LEON_LANG'] as LongLanguageCode

export const HOST = process.env['LEON_HOST']
export const PORT = Number(process.env['LEON_PORT'])

export const TIME_ZONE = process.env['LEON_TIME_ZONE']

export const HAS_AFTER_SPEECH = process.env['LEON_AFTER_SPEECH'] === 'true'

export const HAS_STT = process.env['LEON_STT'] === 'true'
export const STT_PROVIDER = process.env['LEON_STT_PROVIDER']
export const HAS_TTS = process.env['LEON_TTS'] === 'true'
export const TTS_PROVIDER = process.env['LEON_TTS_PROVIDER']

export const HAS_WARM_UP_LLM_DUTIES =
  process.env['LEON_WARM_UP_LLM_DUTIES'] === 'true'
export const HAS_OVER_HTTP = process.env['LEON_OVER_HTTP'] === 'true'
export const HTTP_API_KEY = process.env['LEON_HTTP_API_KEY']
export const HTTP_API_LANG = process.env['LEON_HTTP_API_LANG']

export const PYTHON_TCP_SERVER_HOST = process.env['LEON_PY_TCP_SERVER_HOST']
export const PYTHON_TCP_SERVER_PORT = Number(
  process.env['LEON_PY_TCP_SERVER_PORT']
)

export const IS_TELEMETRY_ENABLED = process.env['LEON_TELEMETRY'] === 'true'

/**
 * NLP models paths
 */
export const MAIN_NLP_MODEL_PATH = path.join(MODELS_PATH, 'leon-main-model.nlp')
export const GLOBAL_RESOLVERS_NLP_MODEL_PATH = path.join(
  MODELS_PATH,
  'leon-global-resolvers-model.nlp'
)
export const SKILLS_RESOLVERS_NLP_MODEL_PATH = path.join(
  MODELS_PATH,
  'leon-skills-resolvers-model.nlp'
)
export const LLM_ACTIONS_CLASSIFIER_PATH = path.join(
  MODELS_PATH,
  'leon-llm-actions-classifier.json'
)
export const LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH = path.join(
  MODELS_PATH,
  'leon-skill-list.nlp'
)

/**
 * LLMs
 * @see k-quants comparison: https://github.com/ggerganov/llama.cpp/pull/1684
 */
export const HAS_LLM = process.env['LEON_LLM'] === 'true'
export const HAS_LLM_NLG = process.env['LEON_LLM_NLG'] === 'true' && HAS_LLM
export const HAS_LLM_ACTION_RECOGNITION =
  process.env['LEON_LLM_ACTION_RECOGNITION'] === 'true' && HAS_LLM
export const LEON_ROUTING_MODE = process.env['LEON_ROUTING_MODE'] || 'smart'
export const LEON_PULSE_ENABLED = true
export const LEON_PULSE_INTERVAL_MS = 30 * 60 * 1_000
const NEEDS_LOCAL_STT = HAS_STT && STT_PROVIDER === 'local'
const NEEDS_LOCAL_TTS = HAS_TTS && TTS_PROVIDER === 'local'
export const SHOULD_START_PYTHON_TCP_SERVER = !(
  LEON_ROUTING_MODE.toLowerCase() === 'agent' &&
  !NEEDS_LOCAL_STT &&
  !NEEDS_LOCAL_TTS
)
export const LEON_DISABLED_CONTEXT_FILES =
  process.env['LEON_DISABLED_CONTEXT_FILES'] || ''
export const LLM_PROVIDER = process.env['LEON_LLM_PROVIDER'] || 'llamacpp'
export const WORKFLOW_LLM_PROVIDER =
  process.env['LEON_WORKFLOW_LLM_PROVIDER'] || LLM_PROVIDER
export const AGENT_LLM_PROVIDER =
  process.env['LEON_AGENT_LLM_PROVIDER'] || LLM_PROVIDER
// export const LLM_VERSION = 'v0.2.Q4_K_S'
// export const LLM_VERSION = '8B-Instruct.Q5_K_S'
// export const LLM_VERSION = '2.9-llama3-8b.Q5_K_S'
// export const LLM_VERSION = '3.1-8B-Lexi-Uncensored_V2_Q5'
// export const LLM_VERSION = '3-8B-Uncensored-Q5_K_S'
// export const LLM_VERSION = 'Q4_K_M'
// export const LLM_VERSION = '4b-it-Q5_K_M'
// export const LLM_VERSION = '3b-instruct-q5_k_m'
// export const LLM_VERSION = '8B-Lexi-Uncensored.i1-Q5_K_S'
// export const LLM_VERSION = '4B-Q4_K_M'
// export const LLM_VERSION = '8B-Abliterated.i1-Q5_K_S'
// export const LLM_VERSION = '3-mini-128k-instruct.Q5_K_S'
// export const LLM_VERSION = '3-mini-4k-instruct-q4'
// export const LLM_VERSION = '1.1-7b-it-Q4_K_M'
// export const LLM_VERSION = '8B-Instruct-Q4_K_S'
// export const LLM_NAME = 'Mistral 7B Instruct'
// export const LLM_NAME = 'Meta-Llama-3-8B-Instruct'
// export const LLM_NAME = 'Dolphin 2.9 Llama-3-8B'
// export const LLM_NAME = 'Llama-3.1-8B-Lexi-Uncensored-V2'
// export const LLM_NAME = 'Llama-3.1-SuperNova-Lite (8B)'
// export const LLM_NAME = 'Gemma 3 12B IT Abliterated'
// export const LLM_NAME = 'Gemma-3-4B-IT'
// export const LLM_NAME = 'Qwen2.5-3B-Instruct'
// export const LLM_NAME = 'Qwen3-4B'
// export const LLM_NAME = 'Lexi-Llama-3-8B-Uncensored'
// export const LLM_NAME = 'Llama-3-8B-Lexi-Uncensored'
// export const LLM_NAME = 'DeepSeek-R1-Distill-Llama'
// export const LLM_NAME = 'Phi-3-Mini-128K-Instruct'
// export const LLM_NAME = 'Phi-3-mini'
// export const LLM_NAME = 'Gemma 1.1 7B (IT)'
// export const LLM_NAME = 'Meta Llama 3 8B Instruct'
// export const LLM_FILE_NAME = `mistral-7b-instruct-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Meta-Llama-3-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `dolphin-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Llama-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Lexi-Llama-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `supernova-lite-v1-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `gemma-3-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `qwen2.5-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Qwen3-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Llama-3-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `DeepSeek-R1-Distill-Llama-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Phi-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `gemma-${LLM_VERSION}.gguf`
// export const LLM_FILE_NAME = `Meta-Llama-3-${LLM_VERSION}.gguf`
export const LLM_DIR_PATH = path.join(MODELS_PATH, 'llm')
export const LLM_MANIFEST_PATH = path.join(LLM_DIR_PATH, 'manifest.json')
const LLM_MANIFEST = fs.existsSync(LLM_MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(LLM_MANIFEST_PATH, 'utf8'))
  : null
// Keep LEON_LLAMACPP_MODEL_PATH as the first-class override, and fall back to
// the default model installed by setup when the env var is empty.
export const DEFAULT_INSTALLED_LLM_PATH =
  typeof LLM_MANIFEST?.defaultInstalledLLMPath === 'string'
    ? LLM_MANIFEST.defaultInstalledLLMPath
    : ''
const CONFIGURED_LLAMACPP_MODEL_PATH =
  process.env['LEON_LLAMACPP_MODEL_PATH'] || DEFAULT_INSTALLED_LLM_PATH || ''
export const LLM_NAME = LLM_MANIFEST?.name || 'Local LLM'
export const LLM_VERSION = LLM_MANIFEST?.version || 'unknown'
export const LLM_FILE_NAME = CONFIGURED_LLAMACPP_MODEL_PATH
  ? path.basename(CONFIGURED_LLAMACPP_MODEL_PATH)
  : ''
export const LLM_NAME_WITH_VERSION = `${LLM_NAME} (${LLM_VERSION})`
export const LLM_PATH = CONFIGURED_LLAMACPP_MODEL_PATH
  ? path.resolve(process.cwd(), CONFIGURED_LLAMACPP_MODEL_PATH)
  : ''
export const LLM_MINIMUM_TOTAL_VRAM = 6
export const LLM_HIGH_TIER_MINIMUM_TOTAL_VRAM = 18
export const LLM_MINIMUM_FREE_VRAM = 6
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/QuantFactory/Meta-Llama-3-8B-Instruct-GGUF/resolve/main/Meta-Llama-3-8B-Instruct.Q5_K_S.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/QuantFactory/dolphin-2.9-llama3-8b-GGUF/resolve/main/dolphin-2.9-llama3-8b.Q5_K_S.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/Orenguteng/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF/resolve/main/Llama-3.1-8B-Lexi-Uncensored_V2_Q5.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/bartowski/Lexi-Llama-3-8B-Uncensored-GGUF/resolve/main/Lexi-Llama-3-8B-Uncensored-Q5_K_S.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/arcee-ai/Llama-3.1-SuperNova-Lite-GGUF/resolve/main/supernova-lite-v1.Q4_K_M.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/mlabonne/gemma-3-12b-it-abliterated-GGUF/resolve/main/gemma-3-12b-it-abliterated.q4_k_m.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q5_K_M.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q5_k_m.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/mradermacher/Llama-3-8B-Lexi-Uncensored-i1-GGUF/resolve/main/Llama-3-8B-Lexi-Uncensored.i1-Q5_K_S.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/mradermacher/DeepSeek-R1-Distill-Llama-8B-Abliterated-i1-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Abliterated.i1-Q5_K_S.gguf?download=true'*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/PrunaAI/Phi-3-mini-128k-instruct-GGUF-Imatrix-smashed/resolve/main/Phi-3-mini-128k-instruct.Q5_K_S.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/bartowski/gemma-1.1-7b-it-GGUF/resolve/main/gemma-1.1-7b-it-Q4_K_M.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_S.gguf?download=true'
*/
/*export const LLM_HF_DOWNLOAD_URL =
  'https://huggingface.co/bartowski/Meta-Llama-3-8B-Instruct-GGUF/resolve/main/Meta-Llama-3-8B-Instruct-Q4_K_S.gguf?download=true'
*/

/**
 * Misc
 */
export const MINIMUM_REQUIRED_RAM = 4
export const INSTANCE_ID = fs.existsSync(LEON_FILE_PATH)
  ? JSON.parse(fs.readFileSync(LEON_FILE_PATH, 'utf8')).instanceID
  : null
export const IS_GITHUB_ACTIONS = process.env['GITHUB_ACTIONS'] !== undefined
export const IS_GITPOD = process.env['GITPOD_WORKSPACE_URL'] !== undefined
