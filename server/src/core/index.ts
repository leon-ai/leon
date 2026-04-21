import { EventEmitter } from 'node:events'

import {
  HOST,
  PORT,
  PROFILE_CONVERSATION_LOG_PATH,
  PYTHON_TCP_SERVER_HOST,
  PYTHON_TCP_SERVER_PORT
} from '@/constants'
import TCPClient from '@/core/tcp-client'
import HTTPServer from '@/core/http-server/http-server'
import SocketServer from '@/core/socket-server'
import SpeechToText from '@/core/stt/stt'
import TextToSpeech from '@/core/tts/tts'
import AutomaticSpeechRecognition from '@/core/asr/asr'
import NaturalLanguageUnderstanding from '@/core/nlp/nlu/nlu'
import Brain from '@/core/brain/brain'
import LLMManager from '@/core/llm-manager/llm-manager'
import LLMProvider from '@/core/llm-manager/llm-provider'
import Persona from '@/core/llm-manager/persona'
import ToolkitRegistry from '@/core/toolkit-registry'
import ContextManager from '@/core/context-manager'
import MemoryManager from '@/core/memory-manager'
import SelfModelManager from '@/core/self-model-manager'
import PulseManager from '@/core/pulse-manager'
import ToolExecutor from '@/core/tool-executor'
import { ConversationLogger } from '@/conversation-logger'
import { ToolCallLogger } from '@/tool-call-logger'

/**
 * Register core nodes
 */

export const PYTHON_TCP_CLIENT = new TCPClient(
  'Python',
  String(PYTHON_TCP_SERVER_HOST),
  PYTHON_TCP_SERVER_PORT
)

export const EVENT_EMITTER = new EventEmitter()

/**
 * Register core singletons
 */

export const LLM_PROVIDER = new LLMProvider()

export const LLM_MANAGER = new LLMManager()

export const CONVERSATION_LOGGER = new ConversationLogger({
  loggerName: 'Conversation Logger',
  fileName: 'conversation_log.json',
  filePath: PROFILE_CONVERSATION_LOG_PATH,
  nbOfLogsToKeep: 1_024,
  nbOfLogsToLoad: 256
})
export const TOOL_CALL_LOGGER = new ToolCallLogger({
  loggerName: 'Tool Call Logger',
  fileName: 'tool-calls.json',
  nbOfLogsToKeep: 8
})

export const HTTP_SERVER = new HTTPServer(String(HOST), PORT)

export const SOCKET_SERVER = new SocketServer()

export const TOOLKIT_REGISTRY = new ToolkitRegistry()

export const TOOL_EXECUTOR = new ToolExecutor()

export const PERSONA = new Persona()

export const CONTEXT_MANAGER = new ContextManager()
export const MEMORY_MANAGER = new MemoryManager()
export const SELF_MODEL_MANAGER = new SelfModelManager()
export const PULSE_MANAGER = new PulseManager()

export const STT = new SpeechToText()

export const TTS = new TextToSpeech()

export const ASR = new AutomaticSpeechRecognition()

export const NLU = new NaturalLanguageUnderstanding()

export const BRAIN = new Brain()
