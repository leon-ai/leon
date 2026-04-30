import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { NVIDIA_LIBS_PATH, PYTORCH_TORCH_PATH } from '@bridge/constants'

const MODEL_BASE_NAME = 'Qwen3-TTS-12Hz-1.7B-Base'
const MODEL_DESIGN_NAME = 'Qwen3-TTS-12Hz-1.7B-VoiceDesign'
const MODEL_CUSTOM_NAME = 'Qwen3-TTS-12Hz-1.7B-CustomVoice'
const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

export type SupportedLanguage =
  | 'Auto'
  | 'Chinese'
  | 'English'
  | 'Japanese'
  | 'Korean'
  | 'German'
  | 'French'
  | 'Russian'
  | 'Portuguese'
  | 'Spanish'
  | 'Italian'

interface SynthesizeSpeechTask {
  text: string
  target_language?: SupportedLanguage
  language?: SupportedLanguage
  audio_path?: string
  output_path?: string
  speaker_reference_path?: string
  reference_audio_path?: string
  reference_text?: string
  x_vector_only_mode?: boolean
  max_new_tokens?: number
  do_sample?: boolean
  top_k?: number
  top_p?: number
  temperature?: number
  repetition_penalty?: number
  subtalker_dosample?: boolean
  subtalker_top_k?: number
  subtalker_top_p?: number
  subtalker_temperature?: number
  [key: string]: unknown
}

interface DesignVoiceTask {
  text: string
  target_language?: SupportedLanguage
  language?: SupportedLanguage
  instruct?: string
  audio_path?: string
  output_path?: string
  max_new_tokens?: number
  do_sample?: boolean
  top_k?: number
  top_p?: number
  temperature?: number
  repetition_penalty?: number
  subtalker_dosample?: boolean
  subtalker_top_k?: number
  subtalker_top_p?: number
  subtalker_temperature?: number
  [key: string]: unknown
}

interface CustomVoiceTask {
  text: string
  target_language?: SupportedLanguage
  language?: SupportedLanguage
  /**
   * Vivian for Chinese; Serena for Chinese; Uncle_Fu for Chinese;
   * Dylan for Chinese (Beijing dialect); Eric for Chinese (Sichuan dialect);
   * Ryan for English; Aiden for English; Ono_Anna for Japanese; Sohee for Korean
   */
  speaker:
    | 'Vivian'
    | 'Serena'
    | 'Uncle_Fu'
    | 'Dylan'
    | 'Eric'
    | 'Ryan'
    | 'Aiden'
    | 'Ono_Anna'
    | 'Sohee'
  instruct?: string
  audio_path?: string
  output_path?: string
  max_new_tokens?: number
  do_sample?: boolean
  top_k?: number
  top_p?: number
  temperature?: number
  repetition_penalty?: number
  subtalker_dosample?: boolean
  subtalker_top_k?: number
  subtalker_top_p?: number
  subtalker_temperature?: number
  [key: string]: unknown
}

interface DesignThenSynthesizeTask {
  design_text: string
  design_language?: SupportedLanguage
  design_instruct?: string
  texts: string[]
  languages?: SupportedLanguage[]
  output_paths: string[]
  design_max_new_tokens?: number
  design_do_sample?: boolean
  design_top_k?: number
  design_top_p?: number
  design_temperature?: number
  design_repetition_penalty?: number
  design_subtalker_dosample?: boolean
  design_subtalker_top_k?: number
  design_subtalker_top_p?: number
  design_subtalker_temperature?: number
  max_new_tokens?: number
  do_sample?: boolean
  top_k?: number
  top_p?: number
  temperature?: number
  repetition_penalty?: number
  subtalker_dosample?: boolean
  subtalker_top_k?: number
  subtalker_top_p?: number
  subtalker_temperature?: number
  [key: string]: unknown
}

export default class Qwen3TTSTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(Qwen3TTSTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      Qwen3TTSTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'qwen3_tts'
  }

  get toolkit(): string {
    return Qwen3TTSTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Synthesize speech with optional voice cloning using Qwen3-TTS.
   */
  async synthesizeSpeech(
    tasks: SynthesizeSpeechTask | SynthesizeSpeechTask[],
    device = 'auto',
    nvidiaLibsPath?: string,
    torchPath?: string
  ): Promise<SynthesizeSpeechTask[]> {
    return this.runTasks(
      'synthesize_speech',
      tasks,
      [MODEL_BASE_NAME],
      device,
      nvidiaLibsPath,
      torchPath
    )
  }

  /**
   * Design a new voice using Qwen3-TTS voice design model.
   */
  async designVoice(
    tasks: DesignVoiceTask | DesignVoiceTask[],
    device = 'auto',
    nvidiaLibsPath?: string,
    torchPath?: string
  ): Promise<DesignVoiceTask[]> {
    return this.runTasks(
      'design_voice',
      tasks,
      [MODEL_DESIGN_NAME],
      device,
      nvidiaLibsPath,
      torchPath
    )
  }

  /**
   * Synthesize speech with a custom voice prompt using Qwen3-TTS.
   */
  async customVoice(
    tasks: CustomVoiceTask | CustomVoiceTask[],
    device = 'auto',
    nvidiaLibsPath?: string,
    torchPath?: string
  ): Promise<CustomVoiceTask[]> {
    return this.runTasks(
      'custom_voice',
      tasks,
      [MODEL_CUSTOM_NAME],
      device,
      nvidiaLibsPath,
      torchPath
    )
  }

  /**
   * Design a voice and then synthesize multiple texts with it.
   */
  async designThenSynthesize(
    tasks: DesignThenSynthesizeTask | DesignThenSynthesizeTask[],
    device = 'auto',
    nvidiaLibsPath?: string,
    torchPath?: string
  ): Promise<DesignThenSynthesizeTask[]> {
    return this.runTasks(
      'design_then_synthesize',
      tasks,
      [MODEL_DESIGN_NAME, MODEL_BASE_NAME],
      device,
      nvidiaLibsPath,
      torchPath
    )
  }

  private async resolveResourceRoot(modelNames: string[]): Promise<string> {
    const modelPaths = await Promise.all(
      modelNames.map((modelName) => this.getResourcePath(modelName))
    )
    const roots = new Set(
      modelPaths.map((modelPath) => path.dirname(modelPath))
    )

    if (roots.size !== 1) {
      throw new Error(
        `Mismatched resource roots for models: ${modelNames.join(', ')}`
      )
    }

    return modelPaths.length > 0 ? path.dirname(modelPaths[0] ?? '') : ''
  }

  private async runTasks<T extends Record<string, unknown>>(
    functionName: string,
    tasks: T | T[],
    modelNames: string[],
    device: string,
    nvidiaLibsPath?: string,
    torchPath?: string
  ): Promise<T[]> {
    const taskArray = Array.isArray(tasks) ? tasks : [tasks]
    let tempDir: string | null = null
    let jsonFilePath: string | null = null

    try {
      const resourceRoot = await this.resolveResourceRoot(modelNames)
      const finalNvidiaLibsPath = nvidiaLibsPath ?? NVIDIA_LIBS_PATH
      const finalTorchPath = torchPath ?? PYTORCH_TORCH_PATH

      tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'qwen3_tts_tasks_')
      )
      jsonFilePath = path.join(tempDir, 'tasks.json')

      await fs.promises.writeFile(
        jsonFilePath,
        JSON.stringify(taskArray, null, 2),
        'utf8'
      )

      const args = [
        '--function',
        functionName,
        '--json_file',
        jsonFilePath,
        '--resource_path',
        resourceRoot,
        '--device',
        device,
        '--torch_path',
        finalTorchPath
      ]

      if (finalNvidiaLibsPath) {
        args.push('--nvidia_libs_path', finalNvidiaLibsPath)
      }

      await this.executeCommand({
        binaryName: 'qwen3_tts',
        args,
        options: { sync: true }
      })

      return taskArray
    } catch (error: unknown) {
      throw new Error(`Qwen3-TTS execution failed: ${(error as Error).message}`)
    }
  }
}
