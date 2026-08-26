import { EventEmitter } from 'node:events'

import {
  HOST,
  PORT,
  PYTHON_TCP_SERVER_HOST,
  PYTHON_TCP_SERVER_PORT
} from '@/constants'
import TCPClient from '@/core/tcp-client'
import HTTPServer from '@/core/http-server/http-server'
import SocketServer from '@/core/socket-server'
import ASRProvider from '@/core/asr/asr-provider'
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
import PostTurnMaintenanceQueue from '@/core/post-turn-maintenance-queue'
import ToolExecutor from '@/core/tool-executor'
import { ToolProviderRegistry } from '@/core/tool-provider/tool-provider-registry'
import { ComputerUseToolProvider } from '@/core/computer-use/computer-use-tool-provider'
import { ConversationLogger } from '@/conversation-logger'
import { ToolCallLogger } from '@/tool-call-logger'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'

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

export const LLM_PROVIDER = createProfileServiceProxy(
  'llm-provider',
  () => new LLMProvider()
)

export const LLM_MANAGER = createProfileServiceProxy(
  'llm-manager',
  () => new LLMManager()
)

export const CONVERSATION_LOGGER = createProfileServiceProxy(
  'conversation-logger',
  () =>
    new ConversationLogger({
      loggerName: 'Conversation Logger',
      fileName: 'conversation_log.json',
      nbOfLogsToKeep: 1_024,
      nbOfLogsToLoad: 256
    })
)
export const TOOL_CALL_LOGGER = createProfileServiceProxy(
  'tool-call-logger',
  () =>
    new ToolCallLogger({
      loggerName: 'Tool Call Logger',
      fileName: 'tool-calls.json',
      nbOfLogsToKeep: 8
    })
)

export const HTTP_SERVER = new HTTPServer(String(HOST), PORT)

export const SOCKET_SERVER = new SocketServer()

export const TOOLKIT_REGISTRY = createProfileServiceProxy(
  'toolkit-registry',
  () => new ToolkitRegistry()
)

export const TOOL_EXECUTOR = createProfileServiceProxy(
  'tool-executor',
  () => new ToolExecutor()
)

export const TOOL_PROVIDER_REGISTRY = new ToolProviderRegistry()
TOOL_PROVIDER_REGISTRY.register(new ComputerUseToolProvider())

export const PERSONA = createProfileServiceProxy(
  'persona',
  () => new Persona()
)

export const CONTEXT_MANAGER = createProfileServiceProxy(
  'context-manager',
  () => new ContextManager()
)
export const MEMORY_MANAGER = createProfileServiceProxy(
  'memory-manager',
  () => new MemoryManager()
)
export const SELF_MODEL_MANAGER = createProfileServiceProxy(
  'self-model-manager',
  () => new SelfModelManager()
)
export const PULSE_MANAGER = createProfileServiceProxy(
  'pulse-manager',
  () => new PulseManager()
)
export const POST_TURN_MAINTENANCE_QUEUE = createProfileServiceProxy(
  'post-turn-maintenance-queue',
  () => new PostTurnMaintenanceQueue()
)

export const ASR_ENGINE = new ASRProvider()

export const TTS = new TextToSpeech()

export const ASR = new AutomaticSpeechRecognition()

export const NLU = createProfileServiceProxy(
  'nlu',
  () => new NaturalLanguageUnderstanding(),
  getActiveConversationSessionId
)

export const BRAIN = createProfileServiceProxy(
  'brain',
  () => new Brain(),
  getActiveConversationSessionId
)
