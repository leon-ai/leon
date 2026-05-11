import type { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { Server as SocketIOServer, Socket } from 'socket.io'
import axios from 'axios'

import {
  LANG,
  HAS_STT,
  HAS_TTS,
  SHOULD_START_PYTHON_TCP_SERVER,
  IS_DEVELOPMENT_ENV,
  API_VERSION,
  WEB_APP_DEV_SERVER_PORT
} from '@/constants'
import {
  HTTP_SERVER,
  PYTHON_TCP_CLIENT,
  ASR,
  STT,
  TTS,
  NLU,
  BRAIN,
  LLM_PROVIDER,
  CONVERSATION_LOGGER
} from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { Telemetry } from '@/telemetry'
import { LLMProviders } from '@/core/llm-manager/types'
import { StringHelper } from '@/helpers/string-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { RoutingMode } from '@/types'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'

const DEFAULT_CLIENT_CAPABILITIES = {
  supportsWidgets: true
}
const HOTWORD_NODE_CLIENT = 'hotword-node'
const SYSTEM_WIDGET_HISTORY_MODE = 'system_widget'

interface HotwordDataEvent {
  hotword: string
  buffer: Buffer
}

interface ClientCapabilities {
  supportsWidgets: boolean
}

interface InitDataEvent {
  client: string
  capabilities?: Partial<ClientCapabilities>
  sessionId?: string
}

interface UtteranceDataEvent {
  client: string
  value: string
  sentAt?: number
  commandContext?: {
    forcedRoutingMode?: RoutingMode
    forcedSkillName?: string
    forcedToolName?: string
  }
  sessionId?: string
}

interface WidgetDataEvent {
  method: {
    methodName: string
    methodParams: Record<string, string | number | undefined | unknown[]>
  }
  // Data returned from Aurora components
  data: Record<string, string | number | undefined | unknown[]>
}

interface ConnectedChatClient {
  client: string
  capabilities: ClientCapabilities
  sessionId: string
  socket: Socket<DefaultEventsMap, DefaultEventsMap>
}

export default class SocketServer {
  private static instance: SocketServer
  private readonly chatClients = new Map<string, ConnectedChatClient>()

  public socket: Socket<DefaultEventsMap, DefaultEventsMap> | undefined =
    undefined

  constructor() {
    if (!SocketServer.instance) {
      LogHelper.title('Socket Server')
      LogHelper.success('New instance')

      SocketServer.instance = this
    }
  }

  private setActiveSocket(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>
  ): void {
    this.socket = socket
  }

  private normalizeInitData(data: string | InitDataEvent): InitDataEvent {
    if (typeof data === 'string') {
      return {
        client: data,
        capabilities: { ...DEFAULT_CLIENT_CAPABILITIES }
      }
    }

    return {
      client: data.client,
      ...(data.sessionId ? { sessionId: data.sessionId } : {}),
      capabilities: {
        ...DEFAULT_CLIENT_CAPABILITIES,
        ...(data.capabilities || {})
      }
    }
  }

  private registerChatClient(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    initData: InitDataEvent
  ): void {
    if (initData.client === HOTWORD_NODE_CLIENT) {
      return
    }

    this.chatClients.set(socket.id, {
      client: initData.client,
      capabilities: {
        ...DEFAULT_CLIENT_CAPABILITIES,
        ...(initData.capabilities || {})
      },
      sessionId:
        initData.sessionId || CONVERSATION_SESSION_MANAGER.getActiveSessionId(),
      socket
    })
  }

  private setChatClientSession(socketId: string, sessionId: string): void {
    const chatClient = this.chatClients.get(socketId)

    if (!chatClient) {
      return
    }

    chatClient.sessionId = sessionId
  }

  private unregisterChatClient(socketId: string): void {
    this.chatClients.delete(socketId)

    if (this.socket?.id === socketId) {
      this.socket = undefined
    }
  }

  public emitToChatClients(
    eventName: string,
    payload?: unknown,
    options?: { sessionId?: string | null }
  ): void {
    for (const chatClient of this.chatClients.values()) {
      if (options?.sessionId && chatClient.sessionId !== options.sessionId) {
        continue
      }

      if (typeof payload === 'undefined') {
        chatClient.socket.emit(eventName)
      } else {
        chatClient.socket.emit(eventName, payload)
      }
    }
  }

  public emitToOtherChatClients(
    sourceSocketId: string,
    eventName: string,
    payload?: unknown,
    options?: { sessionId?: string | null }
  ): void {
    for (const [socketId, chatClient] of this.chatClients.entries()) {
      if (socketId === sourceSocketId) {
        continue
      }

      if (options?.sessionId && chatClient.sessionId !== options.sessionId) {
        continue
      }

      if (typeof payload === 'undefined') {
        chatClient.socket.emit(eventName)
      } else {
        chatClient.socket.emit(eventName, payload)
      }
    }
  }

  private transformAnswerForClient(
    answerData: unknown,
    capabilities: ClientCapabilities
  ): Record<string, unknown> | string | null {
    if (typeof answerData === 'string') {
      return answerData
    }

    if (!answerData || typeof answerData !== 'object') {
      return null
    }

    const answerDataRecord = answerData as Record<string, unknown>

    const hasWidgetPayload =
      'componentTree' in answerDataRecord &&
      'id' in answerDataRecord &&
      'widget' in answerDataRecord

    if (!hasWidgetPayload || capabilities.supportsWidgets) {
      return answerDataRecord
    }

    const fallbackText =
      typeof answerDataRecord['fallbackText'] === 'string'
        ? answerDataRecord['fallbackText']
        : typeof answerDataRecord['answer'] === 'string'
          ? answerDataRecord['answer']
          : ''

    if (!fallbackText) {
      return null
    }

    return {
      answer: fallbackText,
      ...(typeof answerDataRecord['historyMode'] === 'string'
        ? { historyMode: answerDataRecord['historyMode'] }
        : {}),
      ...(typeof answerDataRecord['replaceMessageId'] === 'string'
        ? { replaceMessageId: answerDataRecord['replaceMessageId'] }
        : {}),
      ...(typeof answerDataRecord['id'] === 'string'
        ? { messageId: answerDataRecord['id'] }
        : {})
    }
  }

  public emitAnswerToChatClients(
    answerData: unknown,
    options?: { sessionId?: string | null }
  ): void {
    const sessionId =
      options?.sessionId || CONVERSATION_SESSION_MANAGER.getCurrentSessionId()
    const answerDataRecord =
      answerData && typeof answerData === 'object'
        ? (answerData as Record<string, unknown>)
        : null

    if (
      answerDataRecord &&
      answerDataRecord['historyMode'] === SYSTEM_WIDGET_HISTORY_MODE
    ) {
      const messageId =
        typeof answerDataRecord['replaceMessageId'] === 'string'
          ? answerDataRecord['replaceMessageId']
          : typeof answerDataRecord['id'] === 'string'
            ? answerDataRecord['id']
            : null
      const fallbackText =
        typeof answerDataRecord['fallbackText'] === 'string'
          ? answerDataRecord['fallbackText']
          : typeof answerDataRecord['answer'] === 'string'
            ? answerDataRecord['answer']
            : ''

      if (messageId) {
        void CONVERSATION_LOGGER.upsert(
          {
            who: 'leon',
            message: fallbackText,
            messageId,
            isAddedToHistory: false,
            widget: answerDataRecord as never
          }
        )
      }
    }

    for (const chatClient of this.chatClients.values()) {
      if (sessionId && chatClient.sessionId !== sessionId) {
        continue
      }

      const transformedAnswerData = this.transformAnswerForClient(
        answerData,
        chatClient.capabilities
      )

      if (transformedAnswerData === null) {
        continue
      }

      chatClient.socket.emit('answer', transformedAnswerData)
    }
  }

  private monitorLLMInitialization(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    options: {
      usesLlamaCPP: boolean
    }
  ): void {
    let llamaServerInterval: NodeJS.Timeout | null = null

    const clearIntervals = (): void => {
      if (llamaServerInterval) {
        clearInterval(llamaServerInterval)
        llamaServerInterval = null
      }
    }

    if (options.usesLlamaCPP && !LLM_PROVIDER.isLlamaCPPServerReady) {
      llamaServerInterval = setInterval(() => {
        if (!socket.connected) {
          clearIntervals()
          return
        }

        const llamaServerBootStatus = LLM_PROVIDER.llamaCPPServerBootStatus

        if (
          llamaServerBootStatus === 'success' ||
          llamaServerBootStatus === 'error'
        ) {
          socket.emit('init-llama-server-boot', llamaServerBootStatus)
          clearInterval(llamaServerInterval as NodeJS.Timeout)
          llamaServerInterval = null
        }
      }, 500)
    }

    socket.once('disconnect', clearIntervals)
  }

  public async init(): Promise<void> {
    const io = IS_DEVELOPMENT_ENV
      ? new SocketIOServer(HTTP_SERVER.httpServer, {
          cors: { origin: `${HTTP_SERVER.host}:${WEB_APP_DEV_SERVER_PORT}` }
        })
      : new SocketIOServer(HTTP_SERVER.httpServer)

    let sttState = 'disabled'
    let ttsState = 'disabled'

    if (HAS_STT) {
      sttState = 'enabled'

      await STT.init()
    }
    if (HAS_TTS) {
      ttsState = 'enabled'

      await TTS.init(LangHelper.getShortCode(LANG))
    }

    LogHelper.title('Initialization')
    LogHelper.success(`STT ${sttState}`)
    LogHelper.success(`TTS ${ttsState}`)

    io.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      this.setActiveSocket(socket)

      // Init
      socket.on('init', async (data: string | InitDataEvent) => {
        this.setActiveSocket(socket)

        const initData = this.normalizeInitData(data)

        this.registerChatClient(socket, initData)

        LogHelper.info(`Type: ${initData.client}`)
        LogHelper.info(`Socket ID: ${socket.id}`)

        socket.emit('init-client-core-server-handshake', 'success')

        // TODO
        // const provider = await addProvider(socket.id)

        // Check whether the Python TCP client is connected to the Python TCP server
        if (!SHOULD_START_PYTHON_TCP_SERVER) {
          socket.emit('ready')
          socket.emit('init-tcp-server-boot', 'success')
        } else if (PYTHON_TCP_CLIENT.isConnected) {
          socket.emit('ready')
          socket.emit('init-tcp-server-boot', 'success')
        } else {
          PYTHON_TCP_CLIENT.ee.on('connected', () => {
            socket.emit('ready')
            socket.emit('init-tcp-server-boot', 'success')
          })
        }

        const usesLlamaCPP = [
          CONFIG_STATE.getModelState().getWorkflowTarget(),
          CONFIG_STATE.getModelState().getAgentTarget()
        ].some(
          (target) =>
            target.isEnabled &&
            target.isResolved &&
            target.provider === LLMProviders.LlamaCPP
        )

        if (usesLlamaCPP) {
          socket.emit('init-llama-server-boot', LLM_PROVIDER.llamaCPPServerBootStatus)
        }

        this.monitorLLMInitialization(socket, {
          usesLlamaCPP
        })

        if (initData.client === HOTWORD_NODE_CLIENT) {
          // Hotword triggered
          socket.on('hotword-detected', (hotwordData: HotwordDataEvent) => {
            this.setActiveSocket(socket)

            LogHelper.title('Socket')
            LogHelper.success(`Hotword ${hotwordData.hotword} detected`)

            socket.broadcast.emit('enable-record')
          })
        } else {
          socket.on('session-change', (sessionId: string) => {
            this.setActiveSocket(socket)
            const session = CONVERSATION_SESSION_MANAGER.setActiveSession(
              sessionId
            )

            this.setChatClientSession(socket.id, session.id)
          })

          // Listen for new utterance
          socket.on('utterance', async (utteranceData: UtteranceDataEvent) => {
            this.setActiveSocket(socket)
            const sessionId =
              utteranceData.sessionId ||
              this.chatClients.get(socket.id)?.sessionId ||
              CONVERSATION_SESSION_MANAGER.getActiveSessionId()

            LogHelper.title('Socket')
            LogHelper.info(
              `${utteranceData.client} emitted: ${utteranceData.value}`
            )

            this.emitToChatClients('is-typing', true, { sessionId })

            const { value: utterance } = utteranceData
            const ownerMessageId = `owner-${Date.now()}-${StringHelper.random(6)}`
            const ownerMessageSentAt =
              typeof utteranceData.sentAt === 'number'
                ? utteranceData.sentAt
                : Date.now()

            this.emitToOtherChatClients(
              socket.id,
              'owner-utterance',
              {
                utterance,
                messageId: ownerMessageId,
                sentAt: ownerMessageSentAt
              },
              { sessionId }
            )

            try {
              await CONVERSATION_SESSION_MANAGER.runWithSession(
                sessionId,
                async () => {
                  LogHelper.time('Utterance processed in')

                  // Always interrupt Leon's voice on answer
                  BRAIN.setIsTalkingWithVoice(false, { shouldInterrupt: true })

                  BRAIN.isMuted = false
                  const processedData = await NLU.process(utterance, {
                    ownerMessageId,
                    ...(utteranceData.commandContext?.forcedRoutingMode
                      ? {
                          forcedRoutingMode:
                            utteranceData.commandContext.forcedRoutingMode
                        }
                      : {}),
                    ...(utteranceData.commandContext?.forcedSkillName
                      ? {
                          forcedSkillName:
                            utteranceData.commandContext.forcedSkillName
                        }
                      : {}),
                    ...(utteranceData.commandContext?.forcedToolName
                      ? {
                          forcedToolName:
                            utteranceData.commandContext.forcedToolName
                        }
                      : {})
                  })

                  if (processedData) {
                    Telemetry.utterance(processedData)
                  }

                  LogHelper.title('Execution Time')
                  LogHelper.timeEnd('Utterance processed in')
                }
              )
            } catch (e) {
              LogHelper.error(`Failed to process utterance: ${e}`)
            } finally {
              this.emitToChatClients('is-typing', false, { sessionId })
            }
          })

          // Handle new local ASR engine recording
          socket.on('asr-start-record', () => {
            this.setActiveSocket(socket)
            PYTHON_TCP_CLIENT.emit('asr_start_recording', null)
          })

          // Handle automatic speech recognition
          socket.on('recognize', async (buffer: Buffer) => {
            this.setActiveSocket(socket)

            try {
              await ASR.encode(buffer)
            } catch (e) {
              LogHelper.error(
                `ASR - Failed to encode audio blob to WAVE file: ${e}`
              )
            }
          })

          // Listen for widget events
          socket.on('widget-event', async (event: WidgetDataEvent) => {
            this.setActiveSocket(socket)
            const sessionId =
              this.chatClients.get(socket.id)?.sessionId ||
              CONVERSATION_SESSION_MANAGER.getActiveSessionId()

            LogHelper.title('Socket')
            LogHelper.info(`Widget event: ${JSON.stringify(event)}`)

            this.emitToChatClients('is-typing', true, { sessionId })

            try {
              await CONVERSATION_SESSION_MANAGER.runWithSession(
                sessionId,
                async () => {
                  const { method } = event

                  if (method.methodName === 'send_utterance') {
                    const utterance = method.methodParams['utterance']

                    if (method.methodParams['from'] === 'leon') {
                      await BRAIN.talk(utterance as string, true)
                    } else {
                      socket.emit('widget-send-utterance', utterance)
                    }
                  } else if (method.methodName === 'run_skill_action') {
                    const { actionName, params } = method.methodParams

                    await axios.post(
                      `${HTTP_SERVER.host}:${HTTP_SERVER.port}/api/${API_VERSION}/run-action`,
                      {
                        skill_action: actionName,
                        action_params: params,
                        session_id: sessionId
                      }
                    )
                  }
                }
              )
            } catch (e) {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error
              LogHelper.error(`Failed to handle widget event: ${e.errors || e}`)
            } finally {
              this.emitToChatClients('is-typing', false, { sessionId })
            }
          })
        }
      })

      socket.once('disconnect', () => {
        this.unregisterChatClient(socket.id)
        // TODO
        // deleteProvider(this.socket.id)
      })
    })
  }
}
