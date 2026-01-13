import fs from 'node:fs'

import type {
  ChatHistoryItem,
  Llama,
  LlamaChatSession,
  LlamaContext,
  LlamaModel
} from 'node-llama-cpp'

import {
  HAS_LLM,
  HAS_LLM_ACTION_RECOGNITION,
  HAS_LLM_NLG,
  HAS_WARM_UP_LLM_DUTIES,
  IS_PRODUCTION_ENV,
  LLM_ACTIONS_CLASSIFIER_PATH,
  LLM_MINIMUM_FREE_VRAM,
  LLM_MINIMUM_TOTAL_VRAM,
  LLM_NAME_WITH_VERSION,
  LLM_PATH,
  LLM_PROVIDER,
  LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { ConversationLogger } from '@/conversation-logger'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import warmUpLlmDuties from '@/core/llm-manager/warm-up-llm-duties'
import { SYSTEM_PROMPT as SKILL_ROUTER_SYSTEM_PROMPT } from '@/core/llm-manager/llm-duties/skill-router-llm-duty'
import { StringHelper } from '@/helpers/string-helper'

interface CoreLLMDutyConfig {
  contextSize: number
  maxTokens?: number
  temperature?: number
  thoughtTokensBudget?: number
}
interface CoreLLMDuties {
  [LLMDuties.SkillRouter]: CoreLLMDutyConfig
  [LLMDuties.ActionCalling]: CoreLLMDutyConfig
  [LLMDuties.SlotFilling]: CoreLLMDutyConfig
  [LLMDuties.CustomNER]: CoreLLMDutyConfig
  [LLMDuties.ActionRecognition]?: CoreLLMDutyConfig
  [LLMDuties.Paraphrase]?: CoreLLMDutyConfig
}
type LLMManagerLlama = Llama | null
type LLMManagerModel = LlamaModel | null
type LLMManagerContext = LlamaContext | null
type ActionsClassifierContent = string | null
type SkillListContent = string | null

// Set to 0 to use the maximum threads supported by the current machine hardware
// export const LLM_THREADS = 6

// const TRAINED_CONTEXT_SIZE = 8_192
const DEFAULT_CORE_LLM_DUTIES_CONTEXT_SIZE = 2_048
// Give some VRAM space because the TCP server uses some VRAM too
// const TCP_SERVER_DELTA = 2_048
/**
 * Core LLM duties are the ones that rely on the same context.
 * Every core LLM duty counts as one sequence.
 * This allows to dynamically allocate the context size.
 * The conversation duty is not included because it needs a dedicated context to load history
 */
const CORE_LLM_DUTIES: CoreLLMDuties = {
  [LLMDuties.SkillRouter]: {
    // Dynamic context size according to the skill list
    contextSize: 0,
    maxTokens: 12,
    thoughtTokensBudget: 0,
    temperature: 0
  },
  [LLMDuties.ActionCalling]: {
    /**
     * An action may have ~128 tokens,
     * a skill may contain 10 actions,
     * we double that
     */
    contextSize: 2_048,
    maxTokens: 512,
    thoughtTokensBudget: 64,
    /**
     * Allow creative thinking. E.g. "Think of 3 snacks I can buy for Max, and add them to the list of your choice"
     */
    temperature: 0.8
  },
  [LLMDuties.SlotFilling]: {
    contextSize: 1_024,
    maxTokens: 512,
    thoughtTokensBudget: 128,
    temperature: 0.2
  },
  [LLMDuties.CustomNER]: {
    contextSize: DEFAULT_CORE_LLM_DUTIES_CONTEXT_SIZE
  },
  [LLMDuties.ActionRecognition]: {
    contextSize: DEFAULT_CORE_LLM_DUTIES_CONTEXT_SIZE
  },
  [LLMDuties.Paraphrase]: {
    contextSize: DEFAULT_CORE_LLM_DUTIES_CONTEXT_SIZE,
    thoughtTokensBudget: 0,
    temperature: 0.8
  }
}

/**
 * node-llama-cpp beta 3 docs:
 * @see https://github.com/withcatai/node-llama-cpp/pull/105
 */
export default class LLMManager {
  private static instance: LLMManager
  private _isLLMEnabled = false
  private _isLLMNLGEnabled = false
  private _isLLMActionRecognitionEnabled = false
  private _shouldWarmUpLLMDuties = false
  private _areLLMDutiesWarmedUp = false
  private _llama: LLMManagerLlama = null
  private _model: LLMManagerModel = null
  private _context: LLMManagerContext = null
  private _llmActionsClassifierContent: ActionsClassifierContent = null
  private _skillListContent: SkillListContent = null
  private _coreLLMDuties = CORE_LLM_DUTIES

  get llama(): Llama {
    return this._llama as Llama
  }

  get model(): LlamaModel {
    return this._model as LlamaModel
  }

  get context(): LlamaContext {
    return this._context as LlamaContext
  }

  get llmActionsClassifierContent(): ActionsClassifierContent {
    return this._llmActionsClassifierContent
  }

  get skillListContent(): SkillListContent {
    return this._skillListContent
  }

  get coreLLMDuties(): CoreLLMDuties {
    return this._coreLLMDuties
  }

  get isLLMEnabled(): boolean {
    return this._isLLMEnabled
  }

  get isLLMNLGEnabled(): boolean {
    return this._isLLMNLGEnabled
  }

  get isLLMActionRecognitionEnabled(): boolean {
    return this._isLLMActionRecognitionEnabled
  }

  get shouldWarmUpLLMDuties(): boolean {
    return this._shouldWarmUpLLMDuties
  }

  get areLLMDutiesWarmedUp(): boolean {
    return this._areLLMDutiesWarmedUp
  }

  constructor() {
    if (!LLMManager.instance) {
      LogHelper.title('LLM Manager')
      LogHelper.success('New instance')

      LLMManager.instance = this
    }
  }

  /**
   * Post checking after loading the LLM
   */
  private async postCheck(): Promise<void> {
    if (this._isLLMActionRecognitionEnabled) {
      const isActionsClassifierPathFound = fs.existsSync(
        LLM_ACTIONS_CLASSIFIER_PATH
      )

      if (!isActionsClassifierPathFound) {
        throw new Error(
          `The LLM action classifier is not found at "${LLM_ACTIONS_CLASSIFIER_PATH}". Please run "npm run train" and retry.`
        )
      }
    }
  }

  /**
   * Load the skill router skill list and other future
   * files that only need to be loaded once
   */
  private async singleLoad(): Promise<void> {
    if (!this._model) {
      throw new Error('LLM model is not loaded yet')
    }

    try {
      this._skillListContent = await fs.promises.readFile(
        LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH,
        'utf-8'
      )

      LogHelper.title('LLM Manager')
      LogHelper.success('Skill router skill list has been loaded')
    } catch (e) {
      throw new Error(`Failed to load the skill router skill list: ${e}`)
    }

    /**
     * Set dynamic context size for the skill router duty
     * according to the skill list content
     */
    const completeSkillRouterSystemPrompt = StringHelper.findAndMap(
      SKILL_ROUTER_SYSTEM_PROMPT,
      {
        '%SKILL_LIST%': this._skillListContent || ''
      }
    )
    const skillRouterSystemPromptLength = this._model.tokenize(
      completeSkillRouterSystemPrompt as string
    ).length
    const skillRouterContextSize =
      skillRouterSystemPromptLength +
      (this._coreLLMDuties[LLMDuties.SkillRouter].maxTokens ?? 0) +
      // For more history context safety buffer
      256

    this._coreLLMDuties[LLMDuties.SkillRouter].contextSize =
      skillRouterContextSize

    LogHelper.title('LLM Manager')
    LogHelper.info(
      `Allocated ${skillRouterContextSize} context size for ${LLMDuties.SkillRouter} duty`
    )

    // TODO: delete LLM action recognition
    if (this._isLLMActionRecognitionEnabled) {
      try {
        this._llmActionsClassifierContent = await fs.promises.readFile(
          LLM_ACTIONS_CLASSIFIER_PATH,
          'utf-8'
        )

        LogHelper.title('LLM Manager')
        LogHelper.success('LLM action classifier has been loaded')
      } catch (e) {
        throw new Error(`Failed to load the LLM action classifier: ${e}`)
      }
    }
  }

  public async loadLLM(): Promise<void> {
    /**
     * Get Llama even if LLM is not enabled because it provides good utilities
     * for graphics card information and other useful stuff
     */
    try {
      const { LlamaLogLevel, getLlama } = await Function(
        'return import("node-llama-cpp")'
      )()

      this._llama = await getLlama({
        // logLevel: LlamaLogLevel.disabled
        logLevel: LlamaLogLevel.debug
      })
    } catch (e) {
      LogHelper.title('LLM Manager')
      LogHelper.error(`LLM Manager failed to load. Cannot get model: ${e}`)
    }

    if (!HAS_LLM) {
      LogHelper.title('LLM Manager')
      LogHelper.warning(
        'LLM is not enabled because you have explicitly disabled it'
      )

      return
    }

    if (LLM_PROVIDER === LLMProviders.Local) {
      const [freeVRAMInGB, totalVRAMInGB] = await Promise.all([
        SystemHelper.getFreeVRAM(),
        SystemHelper.getTotalVRAM()
      ])
      const isLLMPathFound = fs.existsSync(LLM_PATH)
      const isCurrentFreeRAMEnough = LLM_MINIMUM_FREE_VRAM <= freeVRAMInGB
      const isTotalRAMEnough = LLM_MINIMUM_TOTAL_VRAM <= totalVRAMInGB

      /**
       * In case the LLM is not set up and
       * the current free RAM is enough to load the LLM
       */
      if (!isLLMPathFound && isCurrentFreeRAMEnough) {
        LogHelper.title('LLM Manager')
        LogHelper.warning(
          'The LLM is not set up yet whereas the current free RAM is enough to enable it. You can run the following command to set it up: "npm install"'
        )

        return
      }
      /**
       * In case the LLM is set up and
       * the current free RAM is not enough to load the LLM
       */
      if (isLLMPathFound && !isCurrentFreeRAMEnough) {
        LogHelper.title('LLM Manager')
        LogHelper.warning(
          'There is not enough free RAM to load the LLM. So the LLM will not be enabled.'
        )

        return
      }

      /**
       * In case the LLM is not found and
       * the total RAM is enough to load the LLM
       */
      if (!isLLMPathFound && isTotalRAMEnough) {
        LogHelper.title('LLM Manager')
        LogHelper.warning(
          `LLM is not enabled because it is not found at "${LLM_PATH}". Run the following command to set it up: "npm install"`
        )

        return
      }

      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        this._model = await this._llama.loadModel({
          modelPath: LLM_PATH,
          // Option available from node-llama-cpp@3.0.0-beta.38 but cannot compile well yet (in 2024-08-01)
          defaultContextFlashAttention: true
        })

        if (HAS_LLM_NLG) {
          this._isLLMNLGEnabled = true
        } else {
          // Remove the paraphrase duty if the NLG is not enabled
          delete this._coreLLMDuties[LLMDuties.Paraphrase]

          /*this._coreLLMDuties.splice(
            this._coreLLMDuties.indexOf(LLMDuties.Paraphrase),
            1
          )*/
        }

        if (HAS_LLM_ACTION_RECOGNITION) {
          this._isLLMActionRecognitionEnabled = true
        } else {
          // Remove the action recognition duty if the action recognition is not enabled
          delete this._coreLLMDuties[LLMDuties.ActionRecognition]

          /*this._coreLLMDuties.splice(
            this._coreLLMDuties.indexOf(LLMDuties.ActionRecognition),
            1
          )*/
        }

        /**
         * TODO now:
         *
         * TODO NEXT: A. Create Video Translator Skill to validate the toolkits -> tools architecture
         *  - Create tools architecture (cf. https://aistudio.google.com/prompts/1bwCCE3G247Ja3cR18vdd-K9Sji9F6-xY):
         *    - [ok] For toolkit binaries, make sure to download a fix version
         *    - [ok] No need for HTTP service for tools because it adds too much complexity
         *    - [ok] Create ffmpeg tool -> extract_audio
         *    - [ok] Create yt-dlp tool -> download_video
         *    - [ok] Fix logic-action-skill-handler, send message sync replaceMessageId
         *    - [ok] 2025-09-04: find a way to make tools report progress to actions without they become error messages for the brain child process
         *    - [ok] With leon.answer, when path are given in the answer, then we should be able to open the file explorer on the given path when we click on the path from the web app
         *      - [ok] Also, implement built-in functions, such as when executing child process: also automatically report which command is being executed (leon.answer())
         *      - [ok] Since we spawn new processes, we need to make sure to kill them properly once done, otherwise we'll have zombie processes
         *      - [ok] Instead of console.log() in base-tool, make use of leon.answer()
         *      - [ok] Once done for TypeScript, rewrite it for the Python SDK (base-tool.ts, leon.ts (for replaceMessageId)
         *    - [ok] Implement special UI for tools report (command outputs, etc.)
         *    - [ok] Create bash tool -> execute_command (+ shell skill that can run commands on the host based on remote LLM)
         *    - Create whisper_faster -> transcribe
         *      - [ok] Auto download Whisper model (into toolkits/music_audio/bins/faster-whisper-large-v3/) before executing binary
         *        - Multilang: https://huggingface.co/Systran/faster-whisper-large-v3
         *        - English only: https://huggingface.co/Systran/faster-distil-whisper-large-v3
         *      - [ok] In base-tool, implement a function "getResources" similar to getBinaryPath() to download resources (e.g. Whisper model)
         *      - [ok] Fix base-tool.ts TSLint errors
         *      - [ok] Auto download whisper_faster binary from leon-binaries repo
         *      - [ok] Run my GitHub workflow via the GitHub action UI. Create GitHub action to compile binaries cross platforms (see how to use GitHub Action CLI directly)
         *      - [ok] Remove pipfile package from faster_whisper in leon-binaries
         *      - [ok] Try whisper_faster end to end -> see if when download model.bin it still returns error
         *      - [ok] Remove TODOs from run_faster_whisper.py in leon-binaries
         *      - [ok] In base-tool.ts: should be able to add cliProgress: true without it reports errors. Hence, for log, I think we need to wrap logs so the brain will not think it is an error
         *      - [ok] Same for base_tool.py with dl.start and display=True
         *      - [ok] In yt-dlp tool, add tips from my personal notes
         *    - [ok] Be able to push data/args to context from skill actions. No need to use memory library SDK for simple memory. E.g. audio_path. Remove from music_audio transcribe_audio memory video translator, and use context instead
         *    - [ok] Try by using OpenAI tool to transcribe_audio (settings.json)
         *    - [ok] Create tool schemas to normalize tool function outputs across Leon
         *    - [ok] Create 11labs and openai tools for transcription
         *    - [ok] Make use of the ElevenLabs dubbing API instead, much simpler!
         *      - Dub API: https://elevenlabs.io/docs/api-reference/dubbing/create?explorer=true
         *      - Then get dubbed audio (progress + resource): https://elevenlabs.io/docs/api-reference/dubbing/audio/get?explorer=true
         *    - [ok] Fix issue when doing cross skill execution. To debug: quickly return/mock video_translator_skill actions instead of going through the full flow
         *    - [ok] 2025-12-09: get_speakers_references
         *    - [ok] 2025-12-09: detect_gender
         *    - [ok] 2025-12-11: Try with French video (multi speakers) to English video
         *    - [ok] 2025-12-14: Add transcription provider https://www.assemblyai.com/docs/api-reference/transcripts/submit
         *    - 2026-01-04:
         *      [ok] Implement chatterbox_onnx tool in video translator skill (add in create_new_audio action)
         *      [ok] Add settings to the video translator skill to control speech_synthesis provider (controlled from create_new_audio action)
         *      [ok] create_new_audio -> max chars in segments are still not respected, I saw 700+ chars in one segment (the one before the last one)
         *      [ok] once the audio segments assembled, the sound is low and then in it tends to increase, fix it, the sound level must be consistent
         *      [ok] we can hear sound overlaps once the audio segments are assembled
         *      [ ] Create action and tool about voice/instrumental audio separation
         *      [ ] better prompting for the translation (provide more context)
         *
         *      [ ] Try CosyVoice3 https://huggingface.co/FluffyBunnies/vibevoice-onnx-v2
         *      [ ] Try XTTS-v2
         *      [ ] Try VibeVoice
         *      [ ] Try Kokoro-82M-onnx
         *      [ ] Create edge-tts tool
         *      [ ] Convert models above to ONNX
         *    - 2025-12-11: Add voice cloning option, otherwise use the gender to generate
         *    - 2025-12-31: XTTS-v2 https://github.com/astramind-ai/Auralis and https://github.com/idiap/coqui-ai-TTS
         *    - 2025-12-11: Improve the translation quality and segmentation of the translation
         *    - 2025-12-11: Make use of dub-test-2 PoC for audio alignment
         *    - For getting speaker audio refs, child processes are crashing (out of memory). Need to debug, cf. https://aistudio.google.com/prompts/1ULyv7WoW93ZKi_ODPyuXkC46qfHn2lDi
         *    - Copy current DuckDB transcription and add new speakers for testing with different audio reference for voice cloning. Then work on it for dubbing multi speakers
         *    - Check this model for TTS + voice cloning: https://github.com/SWivid/F5-TTS
         *    - In the video_translator_skill, add option "has_cloning" to enable voice cloning. If not enabled, use the gender to generate
         *    - Should we remove toolkit skills from the skill router? We could still create dedicated skill if we really want to expose a specific one
         *    - Use open-source models for video translation:
         *      - https://aistudio.google.com/prompts/1WIgTwl9lGBWJtXjj8Ec7RWLA_Zt4kM3h
         *      - https://chat.qwen.ai/c/52cc9526-caf9-43d8-81c4-8cde15c0c6c3
         *      - Voice cloning: https://docs.fish.audio/resources/best-practices/voice-cloning
         *      - RVC for voice cloning (transfer learning based voice conversion)
         *      - 2025-11-11:
         *      - Voice cloning + TTS with Pay-as-you-go pricing: https://www.resemble.ai/
         *      - Main offline TTS? https://github.com/resemble-ai/chatterbox
         *      - Use voice cloning only with online providers!
         *        - clone https://github.com/myshell-ai/OpenVoice/blob/main/demo_part2.ipynb
         *        - Can combine voices to get more voices: https://www.reddit.com/r/LocalLLaMA/comments/1mdu9gr/is_there_a_way_to_download_more_kokoro_tts_voices/
         *        - On-device TTS + Voice Cloning English only: https://huggingface.co/neuphonic/neutts-air
         *      - Kokoro for TTS (text to speech); https://github.com/thewh1teagle/kokoro-onnx?tab=readme-ov-file
         *        - Use Kokoro ONNX? https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
         *        - Close to voice cloning with Kokoro: https://github.com/RobViren/kvoicewalk
         *        - OR (Coqui fork voice cloning): https://github.com/idiap/coqui-ai-TTS
         *        - OR: https://github.com/boson-ai/higgs-audio
         *        - OR: https://github.com/fishaudio/fish-speech
         *        - OR: https://github.com/astramind-ai/Auralis
         *        - OR: https://github.com/SesameAILabs/csm
         *        - OR: https://github.com/nari-labs/dia
         *        - OR? https://github.com/canopyai/Orpheus-TTS
         *      - Adjusts audio timing
         *      - Ignore voice cloning for now, just do: translation -> TTS with timing adjustment -> merge audio with video
         *      - Then add voice cloning; then speaker diarization
         *      - Steps:
         *        1. Faster Whisper → segments + timestamps + speaker diarization
         *        2. OpenRouter (Gemini) → translate each segment
         *        3. XTTS-v2 / OpenVoice → TTS + voice cloning in one step
         *          (using original audio sample per speaker)
         *        4. FFmpeg → time-stretch to match original duration
         *        5. FFmpeg → concatenate all segments
         *        6. FFmpeg → merge audio with video
         *    - Download video > extract audio > transcribe + diarize > translate into target language > detect gender (later) > clone voice (later) > text to speech each segment > merge audio with video > upload video to target platform according to settings (later)
         *    - Replace camelCase props in SkillAnswerCoreData to snake_case
         *    - Create "video_streaming_toolkit_skill" (ffmpeg related stuff?) and "music_audio_toolkit_skill", such common skills contain actions that can be reused by other skills
         *    - Settings priority: 1. caller action (video_translator:*); 2. called action (music_audio:*)
         *    - Create openai_audio tool -> transcribe; translate; synthesize, etc.
         *    - Now that we share the CUDA runtime, we can remove it from all current Leon's binaries (e.g. TCP Server, etc.) and point the path instead
         *    - [ok] In video_translator skill, can add this in flow: "transcriber:transcribe_audio" to execute an action from another skill; but need to config transcribe_audio within this skill need to find a way
         *      VideoTranslator settings
                 *  - transcribe action {
                 *    tool: whisper_faster, gladia, elevenlabs, openai_audio
                 *  }
         *    - Create pyannote tool -> diarize -> create action to merge diarization with transcription (already done in PoC)
         *    - Tool to detect gender for each voice -> https://huggingface.co/JaesungHuh/voice-gender-classifier ; Need to detect gender for each speaker
         *    - In utils SDKs, create formatFilename function to replace whitespaces in filenames with underscores (if a path is given, then make sure to only replace the filename and not the path). Then use this new utility in tools/actions that save files
         *    - If action not found, try to find it in other skills (default settings to 3 tries). E.g. "Transcribe the audio from this file xxx"
         *    - Cf. Discord private message about reported XSS
         *    - Use kokoro tool -> synthesize -> Use ONNX? https://github.com/thewh1teagle/kokoro-onnx ; https://huggingface.co/hexgrad/Kokoro-82M ; can decide to clone voice with 11Labs
         *    - Create indextts2 tool for voice dubbing/cloning https://index-tts.github.io/index-tts2.github.io/
         *    - Create openai_audio (then openai_image, openai_video, etc.) tool (openai provides many APIs, hence, we can have a tool for each toolkit) -> transcribe; translate; synthesize, etc.
         *    - Create gladia tool -> transcribe; diarize
         *    - Rename VideoTranslator by "VideoDubbing"?
         *    - Fix setup skill settings on install (cf. setup-skills.js)
         *    - Make VideoTranslator more appealing (download video widget must be prettier, etc.)
         *    - Can create one skill per action we already use in previous skills (VideoDownloader, AudioExtractor, etc.) with only one action per skill. And reuse the widgets somehow from the VideoTranslator skill
         *    - E.g. Summarize the keypoints of this video... (yt-dlp download subtitles, llm gemini 2.5 pro summarize): Create openrouter, localllm tools (use HTTP to request core, hence need to implement openrouter in core) -> prompt (for general purpose)
         *    - Summarize video -> then auto trim/cut video based on the summary (use ffmpeg to cut the video); need to get the timestamps from the summary
         *    - Create elevenlabs tool -> synthesize; transcribe; clone; diarize
         *    - Rule: a tool cannot call another tool, otherwise this becomes a skill action
         *    - Create Transcriber skill (allow provider selection from settings (asr; diarization))
         *      - action 1: transcribe_without_diarization
         *      - action 2: transcribe_with_diarization (call whisper_faster (or cloud tool according to given settings) + pyannote (or cloud tool according to given settings) tools)
         *      - ...
         *      - Does it means we need to allow to execute a skill action from another skill action? In the "flow" (skill.json) and "next_action" (action code)
         *    - Create EducationalVideoCreator (find a better name) skill (based on what I did for my YT channel)
         *
         *    - Create one pipenv project for each binary; one .spec file for each binary; one github workflow for each binary; common pyinstaller at the root for /tool_bins/
         *    - For every binary, need to have another tool from cloud service (e.g. 11Labs, etc.) so owners that don't have powerful-enough hardware can use cloud services instead
         *    - With auto binary/model download if it is a requirement and not downloaded yet; output to the owner that it is downloading the binary/model
         *    - Cf. https://chatgpt.com/c/68b5c2c6-ec88-832f-aa44-3b7ada3171a3 -> For projects that aren't already compiled (Pyannote, WhisperX, etc.), need to compile them ourselves via GitHub Actions + Pyinstaller or cx_freeze. Keep compile setup files in /tool_bins/ folder. E.g. /tool_bins/whisperx/setup.py, /tool_bins/whisperx/whisperx, etc.
         *    - Tool settings OR use skill settings? (OpenRouter API key, etc.)
         * TODO NEXT: B. Then create a Skill Writer skill where Leon can write a skill > actions by himself based on examples and given owner query (e.g. to_do list, video translator, etc.) and current architecture. Leon can also write tools by himself. If a skill is not found, then we can fallback so Leon can suggest to develop a skill for the owner
         *  - Use https://github.com/anomalyco/opencode for code generation?
         *  - Use https://zenmux.ai/volcengine/doubao-seed-code ?
         *  - Start by building simple skills:
         *    "what are the gender of the speakers in this video?" -> use existing classifier tool;
         *    "summarize this video", etc.
         *    "Clone Elon Musk's voice and say "SpaceX is the most ambitious company on Earth!"" -> research about Elon Musk video/audio samples, download it, and then use XTTS-2 (or something else) to clone the voice and synthesize the text
         *    "I need to learn the following words in Chinese: ..., ..., .... Please challenge me to pronounce them correctly and to remember them by giving me examples and sentences"
         * TODO NEXT: C. Create the autonomous mode where we give the tools directly to Leon (ReAct). E.g. "Can you download the audiobook for Hunger Games 2 and Hunger Games 3?"
         *  - Make use of OpenRouter; https://zenmux.ai/ etc.
         * TODO: main goal with A, B, C:
         *  - A: we have a clear breakdown of the atomic structure: skills > actions > toolkits > tools > functions
         *  - B: Leon can write skills and tools by himself (useful when it is a common scenario and that it just needs to be executed and needs to be reliable)
         *  - C: Leon can use the tools directly to achieve the owner's goals and if the necessary tool isn't found, Leon can suggest to develop one for the owner (B.)
         * TODO: 2 skills to build based A, B, C:
         *  - TODO 1. Based on my French YouTube video, create a video that will dub my voice in English, get transcription from YouTube, select all the key moments and create a 1 minute video automatically so I can post on Twitter
         *  - TODO 2. Go on my Twitter account and unfollow the followers that look like bot or spam accounts. Ask me for confirmation before unfollow
         * TODO: replace Pipenv (and Pyenv?) with uv
         * Tools:
         * - video_streaming
         *  - yt-dlp
         *  - ffmpeg
         * - music_audio
         *  - pyannote
         *  - whisperx
         * - communication (for LLM translation)
         *  - openrouter
         *
         * ---
         * [ok] 1. Dynamic context size (min and max) according to every LLM duty. If LLM duty does not have a specific context size, use the default one.
         *  To do this, hold a contextSize manager state in LLM Manager for every duty and set it from LLM manager. e.g. SkillRouterLLMDuty.contextSize = xxx, because LLM Manager isn't initialized yet.
         *  Use CORE_LLM_DUTIES and loop in, create a "new Set"?
         * [ok] 2. Skill router duty should have a dynamic context size according to the number of skills.
         * [ok] 3. Centralize LLM duties config in this file (maxTokens, contextSize, temperature, etc.)
         * 4. Create function calling LLM duty.
         *   [ok] 4.a. Provide more context (for skill router + action calling) to handle such cases: "Show me the groceries list" then "The lessons list too"
         *   4.b. Handle missing params:
         *     Start to reorganize everything correctly:
         *      [ok] Fully implement the skill router and action calling duties
         *      [ok] Implement duties correctly with the NLU class (create dedicated methods in NLU class)
         *      [ok] Pass NLP.js built-in entities (numbers, duration, etc.) to actions as well as the function calling arguments. Can merge them, so skill developers will have more data
         *      [ok] Update NLU result object to pass to the brain execution
         *      [ok] newEntities, contextEntities, newArguments, contextArguments, newSentiment, contextSentiment, etc.
         *        - new = new utterance; context = all previous utterances within the same context
         *      [ok] Update NLU result to get the current skill config (to get flow later) and current action config
         *      [ok] "actionFunction" in main.ts and main.py bridges. actionFunction() + TS -> use camelCase; PY -> use snake_case for params naming. Correctly name params, just use single object, same as React component signature
         *      [ok] Continue on "handleLogicActionSkill"
         *      [ok] Use esbuild instead of ncc. Try to compile but has error need to follow up
         *      [ok] Fix Python skill execution. Somehow the action file name needed to be renamed from "run.py" to "greet.py"
         *      [ok] Implement helper getSkillActionLocaleConfig
         *      [ok] Fix context duplicate data because of "await this.updateNLUProcessResult(...)"
         *      [ok] Copy the "good_bye" skill and implement the dialog type. Need to handle the "locales/{lang}.json" structure first since it's based on the answers
         *      [ok] In dialog skills answers, check from the context if there is any actionArgument or entities that would match any {{ PLACEHOLDER }} and replace it with the actual value
         *      [ok] Refactor brain with logic/dialog static class handlers + cf. Copilot chat for how to split static methods within the dialog action handler class
         *      [ok] Implement the locale to the timer skill. And verify all actions
         *      [ok] In bridges/nodejs/src/constants.ts and bridges/python/src/constants.py, change the SKILL_CONFIG by removing the config/{lang}.json and only use the locale config. Need to add "variables" and "widget_contents" to the local config too. When implementing variables, check for dialog skill answers if it has conflict
         *      [ok] When action calling, also need to provide non-missing action arguments or need to set the active state with collected params OR fix the slot filling, it needs to push the slots into the context, not only the active state
         *      [ok] Fix skill output chunk parsing. Add new line and read line by line in the brain. skillOutput is empty on data end, need to check; long stdout output because now we send much more data? leon.py, fix widgets (test with todo list skill, etc.) "Add 1l of water, a pillow and a pair of socks to my shopping list please"
         *      [ok] Verify to_do list widget onChange (entities -> action argument) when click checkbox
         *      [ok] Reimplement HTTP APIs for watch (fetch [to do now] + run action [ok]) as per core rewrite changes
         *      [ok] Related to the issue below. For the action calling duty, it tries to run multiple tools: "Create a computer list, think of the main components of a computer and add them to the list". Need to create an action call queue that will run the actions one by one, and wait for the previous action to finish before running the next one. This will allow to run multiple actions in a single utterance, e.g. "Create a computer list, think of the main components of a computer and add them to the list" -> should run 2 actions:
         *      (only allow sequential actions calling within the same skill; for other skills we need to work on the autonomous mode later)
         *      <tool_call>
         * {"name": "create_list", "arguments": {"list_name": "computer"}}
         * </tool_call>
         * <tool_call>
         * {"name": "add_todos", "arguments": {"list_name": "computer", "items": ["CPU", "RAM", "Hard Drive", "Motherboard", "Power Supply"]}}
         * </tool_call>
         *      [ok] (related to below issue 2025-08-19) when "clean active state", should we also clean action router duty and skill router duty? The action router duty seems to be overloaded after a while, cf. usedInputTokens
         *      [ok] "Add tomatoes, potatoes, 1kg of rice to the shopping list" -> issue, it will grab previous list. "Check potatoes from the shopping list" -> does not check because does not go through end data, only on data
         *      [ok] Add "common_answers" to locale config for reusable answers across actions (leon.ts + leon.py); test it with the todo list skill (list_does_not_exist, list_already_exists, etc.)
         *      [ok] (finally no need for query_resolver for now, action args are enough) instead of creating a new multi-tasking duty, maybe we can use the next action arguments? E.g. for "replay" we could have a boolean. By using param description, should automatically set true or false when the param type is boolean so skill devs don't need to care about this. Or just use our global resolver?
         *      [ok] Flow implementation
         *      [ok] Action loop -> fix nlu.ts with conv state / description from undefined param (param.description)
         *      [ok] Try: if in loop and send not-relevant utterance, see what happens, need to clean up?
         *      [ok] Handle suggestions (Aurora component)
         *      [ok] In action calling, if there is a flow and the first action of the flow does not need any argument then directly return the response without going through the LLM inference
         [ok] If a skill only has one action that require no parameters, then directly execute it after the skill router duty (no need to go through the action calling duty)
         *      [ok] MBTI skill: don't use config.json for questions, use answers + fix disposable timer
         *      [ok] For custom duties in skills, optimize the memory so it won't always reload the context, etc. Cf. MBTI skill and translation. To optimize: provide default disposeTimeout and as param too, once timed out, it will clean up the context and dispose the sequence. In this way, actions hitting the same custom duty within the time window will hit the same context and sequence so the inference will be faster.
         *      [ok] Rebuild MBTI skill with custom LLM duty request to resolve form questions
         *      TODO NEXT 2025-08-26: rebuild Akinator https://github.com/Ombucha/akinator.py
         *      TODO NEXT 2025-08-03: maybe there is no need for a flow for the translator skill? A simple action should be enough with the 2 params (target_language and text_to_translate). Maybe I should just implement the loop concept for this case? Test the following cases: flow -> 1. "Can you please help me to translate some text into French?" > "The sky is blue"; 2. "Please help me to translate some text" > "Into French please" > "The sky is blue"; 3. "Please translate this text into French: the sky is blue"; 4. Please translate this text "the sky is blue" > "Into French"
         *      TODO NEXT 2025-07-30: continue to rebuild the translator-poc skill. Need to implement the flow and think carefully about the whole set_up answers system, etc.
         *      TODO NEXT 2025-07-23: rebuild the "good_bye", "partner_assistant", "color" and "translator-poc" skills
         *      TODO NEXT 2025-07-18: copy translator-poc skill (do this later since it involves the loop concept), handle dialog action logic. Need to handle the "locales/{lang}.json" structure first since it's based on the answers
         *      TODO NEXT 2025-08-03: fix bridge main.py with optional params (params and params_helper), e.g. with partner assistant action
         *      TODO NEXT 2025-08-25: when in a loop, waiting for arg, just send an utterance that cannot be recognized such as "blabla" -> handle this case
         *      Delete global-resolvers since we rely on LLM action args and slot filling now
         *      Implement personality via the paraphrase duty? Switch to another model?
         *      [ok] In fetch-widget/get.ts, need to execute new brain method; and replace "currentEntities", "classification" with the new structure
         *      Delete or refactor the chunks where there are "TODO: core rewrite" comments
         *      Rename all Python actions from "run.py" to actual action name, e.g. "greet.py", etc. Because with the LLM approach we need to provide better meaningful names for the actions
         *      Replace "%owner_name%" placeholder with {{ owner_name }} syntax in skill answers and all generic answers (e.g. %skill_name%, etc.); check "wernicke(" calls
         *      Create schema for locales/{lang}.json files. With limited action key config (only "answers" and "missing_params_follow_ups" for now?)
         *      Create new "runSkillAction" brain method and remove legacy "execute" method
         *      Then continue to rewrite the logic of the brain execution; then continue on the flow and loop
         *      Build bridges + rewrite all skills with the new params
         *      Remove "next_action" and implement "flow" (skill schema, get first action of the flow and ignore all other actions within the flow)
         *      Replace "getSkillConfig", etc. helpers from SkillDomainHelper with new helpers + rename SkillDomainHelper to SkillHelper
         *      [ok] Handle "is_loop"
         *      Delete all "config" folders in skills, and replace with "locales/{lang}.json" files
         *      Should delete legacy code?
         *      Make sure telemetry is working well with the new core
         *      Guess The Number skill: rework on loop logic (create "resolving" duty for very custom inputs, cf. MBTI?)
         *      Rochambeau skill
         *      [ok] Rework the MBTI skill with resolver skill. Once done, from there we can consider the rewrite of the core as nearly completed
         *      Check suggestions. Already done with widgets before? Need to check previous progress in Trello cards
         *        - Re-enable them from brain.ts, search for "// Send suggestions to the client"
         *      "dialog" skill type: rework it with new core. It is a good solution for Q&A. E.g. specific knowledge base, etc. Create a dialog skill for Leon itself about general questions (what it can do, why Leon has been created, who created Leon, when was the last update, how to develop new skill, how to contribute, some Easter eggs, etc.)
         *      Recreate all "dialog" skills with the new core. Remove feature for nested data such as in partner_assistant skill (not very useful, medium code complexity, poor ROI)
         *      Allow "missing_param_follow_ups" in skill config to handle customized missing params follow-ups
         *      Delete all legacy core code
         *      Delete .extractEntities method from NER class to replace with new one (extractBuiltInEntities)
         *      Create new structure tools in bridges with skills folder; remove domains (no need to implement tools for now)
         *      Create the fake weather skill (implement tools)
         *      Implement locales/{lang}.json in skills with new properties, and dynamic translation %PLACEHOLDER%
         *      [ok] (PLAN CHANGED, DO NOT DO THIS) -> Implement config/{lang}.json in skills with new properties (cf. Trello card description)
         *      [ok] Implement slot filling duty > missing params > conversation state
         *      [ok] Research (redevelop next_action?) and create resolver duty / loop in skills (guess the number, rochambeau, MBTI test, etc.)
         *      If action is not found, then fallback to a duty for chitchat/help with Leon's personality
         *      Implement toolkits and tools (E.g. weather toolkit (folder) > several providers (each provider is a tool class, they must contain the same methods between each other as most as possible). Cf. MVP. And create the toolkit finder duty logic when the Leon instance includes +64 skills
         *      Create real weather skill with tools (one tool for each provider, can choose provider in skill settings)
         *      After everything is confirmed, then migrate all skills with the new configs
         *      Clean up NLU class, etc. if not used anymore
         *      Add this to do list to the Trello card description for history and future references (blog post, etc.)
         *
         *     [ok] In DSL, at the same level as "type": "logic", need to add field: "optional_params": []
         *      If this param is missing, but is included in the optional_params array, then still execute the action and let the skill developer handles the logic
         *
         *     Handle new skill config props same as I mentioned in the Trello card description
         *
         *     Still need to create config/{lang}.json in skills to handle customized properties of the skill configs. E.g. missing params follow-up questions, etc.
         *   4.c. Add system prompt context size log info for each LLM duty
         * 5. Action calling duty warm up
         * 6. Multi-turn conversation (resolve LLM duty). Cf. MVP notes
         * 7. Once actions work well, then try to enable the history again for action calling and skill router duties. Because it will save messages in the history since actions aren't broken anymore. Just load 8 messages.
         *
         * Needed duties:
         * - skill router
         * - function calling
         * - resolver
         * - paraphrase
         * - custom NER
         * - conversation
         * - summarizer??? (skill developers can choose to make use of this duty from their skill, so it can take the original user query, all the data grabbed after the skill execution, and summarize it). E.g. "Did I added tomatoes to my shopping list?" > get_list_items response > "Yes, you added tomatoes to your shopping list."
         * - custom
         */

        try {
          // Load files that only need to be loaded once
          await this.singleLoad()
        } catch (e) {
          LogHelper.title('LLM Manager')
          LogHelper.error(`LLM Manager failed to single load: ${e}`)

          process.exit(1)
        }

        const coreLLMContextSizeValues = Object.values(this._coreLLMDuties).map(
          (duty) => duty.contextSize
        )
        const minCoreLLMContextSize = Math.min(...coreLLMContextSizeValues)
        const maxCoreLLMContextSize = Math.max(...coreLLMContextSizeValues)

        this._context = await this._model.createContext({
          sequences: Object.keys(this._coreLLMDuties).length,
          // threads: LLM_THREADS,
          contextSize: {
            min: minCoreLLMContextSize,
            max: maxCoreLLMContextSize
          }
        })
        this._isLLMEnabled = true

        LogHelper.title('LLM Manager')
        LogHelper.success(`${LLM_NAME_WITH_VERSION} LLM has been loaded`)
      } catch (e) {
        LogHelper.title('LLM Manager')
        LogHelper.error(`LLM Manager failed to load. Cannot load model: ${e}`)
      }
    } else {
      if (!Object.values(LLMProviders).includes(LLM_PROVIDER as LLMProviders)) {
        LogHelper.warning(
          `The LLM provider "${LLM_PROVIDER}" does not exist or is not yet supported`
        )

        return
      }

      this._isLLMEnabled = true

      if (HAS_LLM_NLG) {
        this._isLLMNLGEnabled = true
      }
      if (HAS_LLM_ACTION_RECOGNITION) {
        this._isLLMActionRecognitionEnabled = true
      }
    }

    this._shouldWarmUpLLMDuties =
      (IS_PRODUCTION_ENV || HAS_WARM_UP_LLM_DUTIES) &&
      this._isLLMEnabled &&
      LLM_PROVIDER === LLMProviders.Local

    try {
      // Post checking after loading the LLM
      await this.postCheck()
    } catch (e) {
      LogHelper.title('LLM Manager')
      LogHelper.error(`LLM Manager failed to post check: ${e}`)

      process.exit(1)
    }

    if (this._shouldWarmUpLLMDuties) {
      this.warmUpLLMDuties()
    }
  }

  public async warmUpLLMDuties(): Promise<void> {
    try {
      LogHelper.title('LLM Manager')
      LogHelper.info('Warming up LLM duties...')

      await warmUpLlmDuties(Object.keys(this._coreLLMDuties) as LLMDuties[])

      this._areLLMDutiesWarmedUp = true
    } catch (e) {
      LogHelper.title('LLM Manager')
      LogHelper.error(`LLM Manager failed to warm up LLM duties: ${e}`)

      this._areLLMDutiesWarmedUp = false
    }
  }

  public async loadHistory(
    conversationLogger: ConversationLogger,
    session: LlamaChatSession,
    options?: { nbOfLogsToLoad?: number }
  ): Promise<ChatHistoryItem[]> {
    const [systemMessage] = session.getChatHistory()
    let conversationLogs

    if (options) {
      conversationLogs = await conversationLogger.load(options)
    } else {
      conversationLogs = await conversationLogger.load()
    }

    if (!conversationLogs) {
      return [systemMessage] as ChatHistoryItem[]
    }

    const history =
      conversationLogs?.map((messageRecord) => {
        if (!messageRecord || !messageRecord.message) {
          messageRecord.message = ''
        }

        if (messageRecord.who === 'owner') {
          return {
            type: 'user',
            text: messageRecord.message
          }
        }

        return {
          type: 'model',
          response: [messageRecord.message]
        }
      }) ?? []

    return [systemMessage, ...history] as ChatHistoryItem[]
  }
}
