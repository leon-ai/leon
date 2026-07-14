import type { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { Server as SocketIOServer, Socket } from 'socket.io'
import axios from 'axios'

import {
  LANG,
  HAS_ASR,
  HAS_TTS,
  SHOULD_START_PYTHON_TCP_SERVER,
  IS_DEVELOPMENT_ENV,
  IS_CLIENT_INTERFACE_AUTH_ENABLED,
  API_VERSION,
  CLIENT_INTERFACE_ALLOWED_ORIGINS,
  WEB_APP_DEV_SERVER_PORT
} from '@/constants'
import {
  HTTP_SERVER,
  PYTHON_TCP_CLIENT,
  ASR,
  ASR_ENGINE,
  TTS,
  NLU,
  BRAIN,
  LLM_PROVIDER,
  CONVERSATION_LOGGER,
  TOOLKIT_REGISTRY
} from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { Telemetry } from '@/telemetry'
import { LLMProviders } from '@/core/llm-manager/types'
import { StringHelper } from '@/helpers/string-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { RoutingMode } from '@/types'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import {
  LEON_CLIENT_INTERFACE_DEFAULT_CLIENT_TYPE,
  LEON_CLIENT_INTERFACE_EVENTS,
  LEON_CLIENT_INTERFACE_PROTOCOL_VERSION,
  type LeonClientCapabilities,
  type LeonClientDescriptor,
  type LeonClientInterfaceAnswerPayload,
  type LeonClientInterfaceErrorPayload,
  type LeonClientInterfaceInitPayload,
  type LeonClientInterfaceProtocol,
  type LeonClientInterfaceSuggestionsPayload,
  type LeonClientInterfaceTokenPayload,
  type LeonClientInterfaceTypingPayload,
  type LeonClientInterfaceUtterancePayload
} from '@/core/leon-interface/types'
import {
  authenticateProfileCredential,
  readProfileCredentialFromHeaders,
  readStoredProfileToken
} from '@/core/profile-auth'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import {
  LINK_EVENTS,
  LINK_PROTOCOL_VERSION,
  type LinkInitPayload,
  type LinkToolProgressPayload,
  type LinkToolResultPayload
} from '@/core/link/types'
import { LINK_REGISTRY } from '@/core/link/link-registry'

const DEFAULT_CLIENT_CAPABILITIES = {
  supportsWidgets: true,
  supportsTokenStreaming: true,
  supportsVoice: true
}
const HOTWORD_NODE_CLIENT = 'hotword-node'
const SYSTEM_WIDGET_HISTORY_MODE = 'system_widget'
const CLIENT_ID_RANDOM_LENGTH = 6
const OWNER_MESSAGE_ID_RANDOM_LENGTH = 6
const LEON_CLIENT_INTERFACE_UNSUPPORTED_PROTOCOL_ERROR =
  'unsupported_protocol_version'
const LEON_CLIENT_INTERFACE_INVALID_MESSAGE_ERROR = 'invalid_owner_message'
const LEON_CLIENT_INTERFACE_PROCESSING_ERROR = 'owner_message_processing_failed'
const LEON_CLIENT_INTERFACE_UNAUTHORIZED_ERROR = 'unauthorized'

interface HotwordDataEvent {
  hotword: string
  buffer: Buffer
}

interface InitDataEvent {
  client: string
  capabilities?: Partial<LeonClientCapabilities>
  sessionId?: string
}

interface UtteranceDataEvent {
  client: string
  value: string
  messageId?: string
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
  id: string
  client: string
  clientType: string
  capabilities: LeonClientCapabilities
  protocol: LeonClientInterfaceProtocol
  profileName: string
  sessionId: string
  socket: Socket<DefaultEventsMap, DefaultEventsMap>
}

export default class SocketServer {
  private static instance: SocketServer
  private readonly chatClients = new Map<string, ConnectedChatClient>()
  private readonly linkClients = new Map<
    string,
    { profileName: string, deviceId: string }
  >()

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

  private normalizeLeonClientDescriptor(
    client: string | LeonClientDescriptor
  ): Required<Pick<LeonClientDescriptor, 'id' | 'type'>> &
    Pick<LeonClientDescriptor, 'name' | 'version'> {
    if (typeof client === 'string') {
      return {
        id: client,
        type: LEON_CLIENT_INTERFACE_DEFAULT_CLIENT_TYPE
      }
    }

    const clientType =
      client.type?.trim() || LEON_CLIENT_INTERFACE_DEFAULT_CLIENT_TYPE
    const clientId =
      client.id?.trim() ||
      `${clientType}-${Date.now()}-${StringHelper.random(CLIENT_ID_RANDOM_LENGTH)}`

    return {
      id: clientId,
      type: clientType,
      ...(client.name ? { name: client.name } : {}),
      ...(client.version ? { version: client.version } : {})
    }
  }

  private registerChatClient(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    initData: InitDataEvent,
    profileName: string,
    protocol: LeonClientInterfaceProtocol = 'legacy'
  ): ConnectedChatClient {
    const chatClient = {
      id: initData.client,
      client: initData.client,
      clientType: protocol === 'legacy' ? 'web_app' : initData.client,
      capabilities: {
        ...DEFAULT_CLIENT_CAPABILITIES,
        ...(initData.capabilities || {})
      },
      protocol,
      profileName,
      sessionId:
        initData.sessionId || CONVERSATION_SESSION_MANAGER.getActiveSessionId(),
      socket
    }

    if (initData.client !== HOTWORD_NODE_CLIENT) {
      this.chatClients.set(socket.id, chatClient)
    }

    return chatClient
  }

  private registerLeonClient(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    initData: LeonClientInterfaceInitPayload,
    profileName: string
  ): ConnectedChatClient {
    const client = this.normalizeLeonClientDescriptor(initData.client)
    const chatClient = {
      id: client.id,
      client: client.name || client.id,
      clientType: client.type,
      capabilities: {
        ...DEFAULT_CLIENT_CAPABILITIES,
        ...(initData.capabilities || {})
      },
      protocol: 'leon_client' as const,
      profileName,
      sessionId:
        initData.sessionId || CONVERSATION_SESSION_MANAGER.getActiveSessionId(),
      socket
    }

    this.chatClients.set(socket.id, chatClient)

    return chatClient
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

  private getAllowedSocketOrigins(): string[] {
    const origins = new Set(CLIENT_INTERFACE_ALLOWED_ORIGINS)

    if (IS_DEVELOPMENT_ENV) {
      origins.add(`${HTTP_SERVER.host}:${WEB_APP_DEV_SERVER_PORT}`)
    }

    return [...origins]
  }

  private isSocketOriginAllowed(origin: string | undefined): boolean {
    if (!origin) {
      return true
    }

    const allowedOrigins = this.getAllowedSocketOrigins()

    if (allowedOrigins.length === 0) {
      return true
    }

    return allowedOrigins.includes(origin)
  }

  private getSocketAuthToken(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    initData?: { token?: string }
  ): string {
    const handshakeAuthToken = socket.handshake.auth?.['token']
    const headerToken = socket.handshake.headers['x-leon-client-token']

    if (typeof initData?.token === 'string') {
      return initData.token
    }

    if (typeof handshakeAuthToken === 'string') {
      return handshakeAuthToken
    }

    if (typeof headerToken === 'string') {
      return headerToken
    }

    return ''
  }

  private isLeonClientInterfaceAuthorized(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    initData?: { token?: string }
  ): string | null {
    const initToken = this.getSocketAuthToken(socket, initData)
    const headerToken = readProfileCredentialFromHeaders({
      authorization: socket.handshake.headers.authorization,
      cookie: socket.handshake.headers.cookie,
      'x-leon-profile-token': String(
        socket.handshake.headers['x-leon-profile-token'] || ''
      ),
      'x-leon-client-token': String(
        socket.handshake.headers['x-leon-client-token'] || ''
      )
    })
    const token = initToken || headerToken

    if (!token && !IS_CLIENT_INTERFACE_AUTH_ENABLED) {
      return LEON_PROFILE_NAME
    }

    const credential = authenticateProfileCredential(token)

    if (credential) {
      return credential.profileName
    }

    // Accept the former unprefixed token for the startup profile during migration.
    const legacyDefaultToken = readStoredProfileToken(LEON_PROFILE_NAME)

    return token && token === legacyDefaultToken ? LEON_PROFILE_NAME : null
  }

  private emitSocketEvent(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    eventName: string,
    payload?: unknown
  ): void {
    if (typeof payload === 'undefined') {
      socket.emit(eventName)
    } else {
      socket.emit(eventName, payload)
    }
  }

  private emitLeonClientInterfaceEvent(
    chatClient: ConnectedChatClient,
    eventName: string,
    payload?: unknown,
    options?: { sessionId?: string | null }
  ): void {
    if (eventName === 'is-typing') {
      const typingPayload: LeonClientInterfaceTypingPayload = payload === true

      chatClient.socket.emit(
        LEON_CLIENT_INTERFACE_EVENTS.isTyping,
        typingPayload
      )
      return
    }

    if (eventName === 'suggest' && Array.isArray(payload)) {
      const suggestionsPayload: LeonClientInterfaceSuggestionsPayload =
        payload.filter(
          (suggestion): suggestion is string => typeof suggestion === 'string'
        )

      chatClient.socket.emit(
        LEON_CLIENT_INTERFACE_EVENTS.suggest,
        suggestionsPayload
      )
      return
    }

    if (eventName === 'owner-utterance') {
      const ownerMessagePayload = payload as Record<string, unknown> | null
      const message =
        typeof ownerMessagePayload?.['utterance'] === 'string'
          ? ownerMessagePayload['utterance']
          : null

      if (!message) {
        return
      }

      chatClient.socket.emit(LEON_CLIENT_INTERFACE_EVENTS.ownerUtterance, {
        utterance: message,
        ...(typeof ownerMessagePayload?.['messageId'] === 'string'
          ? { messageId: ownerMessagePayload['messageId'] }
          : {}),
        ...(typeof ownerMessagePayload?.['sentAt'] === 'number'
          ? { sentAt: ownerMessagePayload['sentAt'] }
          : {}),
        ...(options?.sessionId ? { sessionId: options.sessionId } : {})
      })
      return
    }

    if (
      eventName === 'llm-token' ||
      eventName === 'llm-reasoning-token'
    ) {
      if (!chatClient.capabilities.supportsTokenStreaming) {
        return
      }

      const tokenData = payload as Record<string, unknown> | null
      const token =
        typeof tokenData?.['token'] === 'string' ? tokenData['token'] : null
      const generationId =
        typeof tokenData?.['generationId'] === 'string'
          ? tokenData['generationId']
          : null

      if (!token || !generationId) {
        return
      }

      const tokenPayload: LeonClientInterfaceTokenPayload = {
        token,
        generationId,
        ...(typeof tokenData?.['phase'] === 'string'
          ? { phase: tokenData['phase'] }
          : {})
      }

      chatClient.socket.emit(
        eventName === 'llm-token'
          ? LEON_CLIENT_INTERFACE_EVENTS.llmToken
          : LEON_CLIENT_INTERFACE_EVENTS.llmReasoningToken,
        tokenPayload
      )
    }
  }

  public emitToChatClients(
    eventName: string,
    payload?: unknown,
    options?: { sessionId?: string | null }
  ): void {
    for (const chatClient of this.chatClients.values()) {
      if (chatClient.profileName !== getActiveProfileName()) {
        continue
      }

      if (options?.sessionId && chatClient.sessionId !== options.sessionId) {
        continue
      }

      if (chatClient.protocol === 'leon_client') {
        this.emitLeonClientInterfaceEvent(
          chatClient,
          eventName,
          payload,
          options
        )
        continue
      }

      this.emitSocketEvent(chatClient.socket, eventName, payload)
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

      if (chatClient.profileName !== getActiveProfileName()) {
        continue
      }

      if (options?.sessionId && chatClient.sessionId !== options.sessionId) {
        continue
      }

      if (chatClient.protocol === 'leon_client') {
        this.emitLeonClientInterfaceEvent(
          chatClient,
          eventName,
          payload,
          options
        )
        continue
      }

      this.emitSocketEvent(chatClient.socket, eventName, payload)
    }
  }

  private transformAnswerForClient(
    answerData: unknown,
    capabilities: LeonClientCapabilities
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
      if (chatClient.profileName !== getActiveProfileName()) {
        continue
      }

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

      if (chatClient.protocol === 'leon_client') {
        const answerPayload: LeonClientInterfaceAnswerPayload =
          transformedAnswerData

        chatClient.socket.emit(
          LEON_CLIENT_INTERFACE_EVENTS.answer,
          answerPayload
        )
        continue
      }

      chatClient.socket.emit('answer', transformedAnswerData)
    }
  }

  private monitorLLMInitialization(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    options: {
      profileName: string
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

        runWithProfileContext({ profileName: options.profileName }, () => {
          const llamaServerBootStatus = LLM_PROVIDER.llamaCPPServerBootStatus

          if (
            llamaServerBootStatus === 'success' ||
            llamaServerBootStatus === 'error'
          ) {
            socket.emit('init-llama-server-boot', llamaServerBootStatus)
            clearInterval(llamaServerInterval as NodeJS.Timeout)
            llamaServerInterval = null
          }
        })
      }, 500)
    }

    socket.once('disconnect', clearIntervals)
  }

  private emitLeonClientReady(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    sessionId: string
  ): void {
    socket.emit(LEON_CLIENT_INTERFACE_EVENTS.ready, {
      protocolVersion: LEON_CLIENT_INTERFACE_PROTOCOL_VERSION,
      sessionId
    })
  }

  private emitLeonClientError(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    payload: LeonClientInterfaceErrorPayload
  ): void {
    socket.emit(LEON_CLIENT_INTERFACE_EVENTS.error, payload)
  }

  private emitClientRuntimeReady(chatClient: ConnectedChatClient): void {
    if (chatClient.protocol === 'leon_client') {
      this.emitLeonClientReady(chatClient.socket, chatClient.sessionId)
      return
    }

    chatClient.socket.emit('ready')
    chatClient.socket.emit('init-tcp-server-boot', 'success')
  }

  private emitClientRuntimeReadyWhenAvailable(
    chatClient: ConnectedChatClient
  ): void {
    if (!SHOULD_START_PYTHON_TCP_SERVER || PYTHON_TCP_CLIENT.isConnected) {
      this.emitClientRuntimeReady(chatClient)
      return
    }

    PYTHON_TCP_CLIENT.ee.on('connected', () => {
      this.emitClientRuntimeReady(chatClient)
    })
  }

  private shouldMonitorLlamaCPPInitialization(): boolean {
    return [
      CONFIG_STATE.getModelState().getWorkflowTarget(),
      CONFIG_STATE.getModelState().getAgentTarget()
    ].some(
      (target) =>
        target.isEnabled &&
        target.isResolved &&
        target.provider === LLMProviders.LlamaCPP
    )
  }

  private async handleOwnerMessage(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    utteranceData: UtteranceDataEvent
  ): Promise<void> {
    const profileName =
      this.chatClients.get(socket.id)?.profileName || LEON_PROFILE_NAME

    await runWithProfileContext({ profileName }, async () => {
      await this.processOwnerMessage(socket, utteranceData)
    })
  }

  private async processOwnerMessage(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    utteranceData: UtteranceDataEvent
  ): Promise<void> {
    this.setActiveSocket(socket)

    const chatClient = this.chatClients.get(socket.id)
    const sessionId =
      utteranceData.sessionId ||
      chatClient?.sessionId ||
      CONVERSATION_SESSION_MANAGER.getActiveSessionId()
    const utterance = utteranceData.value.trim()

    if (!utterance) {
      if (chatClient?.protocol === 'leon_client') {
        this.emitLeonClientError(socket, {
          code: LEON_CLIENT_INTERFACE_INVALID_MESSAGE_ERROR,
          message: 'Owner message cannot be empty.',
          sessionId
        })
      }

      return
    }

    LogHelper.title('Socket')
    LogHelper.info(`${utteranceData.client} emitted: ${utterance}`)

    this.emitToChatClients('is-typing', true, { sessionId })

    const ownerMessageId =
      utteranceData.messageId ||
      `owner-${Date.now()}-${StringHelper.random(OWNER_MESSAGE_ID_RANDOM_LENGTH)}`
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
            void Telemetry.utterance(processedData)
          }

          LogHelper.title('Execution Time')
          LogHelper.timeEnd('Utterance processed in')
        }
      )
    } catch (e) {
      LogHelper.error(`Failed to process utterance: ${e}`)

      if (chatClient?.protocol === 'leon_client') {
        this.emitLeonClientError(socket, {
          code: LEON_CLIENT_INTERFACE_PROCESSING_ERROR,
          message: 'Failed to process owner message.',
          sessionId
        })
      }
    } finally {
      this.emitToChatClients('is-typing', false, { sessionId })
    }
  }

  private async handleWidgetEvent(
    socket: Socket<DefaultEventsMap, DefaultEventsMap>,
    event: WidgetDataEvent
  ): Promise<void> {
    const profileName =
      this.chatClients.get(socket.id)?.profileName || LEON_PROFILE_NAME

    await runWithProfileContext({ profileName }, async () => {
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
              return
            }

            if (method.methodName === 'run_skill_action') {
              const { actionName, params } = method.methodParams
              const profileSecret = readStoredProfileToken(profileName)

              await axios.post(
                `${HTTP_SERVER.host}:${HTTP_SERVER.port}/api/${API_VERSION}/run-action`,
                {
                  skill_action: actionName,
                  action_params: params,
                  session_id: sessionId
                },
                {
                  headers: profileSecret
                    ? {
                        'x-leon-profile-token': `${profileName}:${profileSecret}`
                      }
                    : {}
                }
              )
            }
          }
        )
      } catch (error) {
        LogHelper.error(`Failed to handle widget event: ${String(error)}`)
      } finally {
        this.emitToChatClients('is-typing', false, { sessionId })
      }
    })
  }

  public async init(): Promise<void> {
    const io = new SocketIOServer(HTTP_SERVER.httpServer, {
      cors: {
        origin: (origin, callback): void => {
          callback(null, this.isSocketOriginAllowed(origin))
        },
        credentials: true
      }
    })

    let asrState = 'disabled'
    let ttsState = 'disabled'

    if (HAS_ASR) {
      asrState = 'enabled'

      await ASR_ENGINE.init()
    }
    if (HAS_TTS) {
      ttsState = 'enabled'

      await TTS.init(LangHelper.getShortCode(LANG))
    }

    LogHelper.title('Initialization')
    LogHelper.success(`ASR ${asrState}`)
    LogHelper.success(`TTS ${ttsState}`)

    io.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      this.setActiveSocket(socket)

      socket.on(
        LINK_EVENTS.init,
        async (data: LinkInitPayload) => {
          const profileName = this.isLeonClientInterfaceAuthorized(socket, data)

          if (
            !profileName ||
            data?.protocolVersion !== LINK_PROTOCOL_VERSION ||
            !data.device?.id?.trim() ||
            !Array.isArray(data.toolkits)
          ) {
            socket.emit(LINK_EVENTS.error, {
              code: 'link_init_rejected',
              message: 'Link authentication or protocol is invalid.'
            })
            socket.disconnect(true)
            return
          }

          await runWithProfileContext({ profileName }, async () => {
            await ensureActiveProfileRuntime()
            await TOOLKIT_REGISTRY.load()
            TOOLKIT_REGISTRY.registerLinkTools(
              data.device.id,
              data.toolkits
            )
            LINK_REGISTRY.register({
              profileName,
              device: data.device,
              toolkits: data.toolkits,
              transport: socket
            })
          })

          this.linkClients.set(socket.id, {
            profileName,
            deviceId: data.device.id
          })
          socket.on(
            LINK_EVENTS.toolProgress,
            (payload: LinkToolProgressPayload) => {
              LINK_REGISTRY.handleProgress(
                profileName,
                data.device.id,
                payload
              )
            }
          )
          socket.on(
            LINK_EVENTS.toolResult,
            (payload: LinkToolResultPayload) => {
              LINK_REGISTRY.handleResult(
                profileName,
                data.device.id,
                payload
              )
            }
          )
          socket.emit(LINK_EVENTS.ready, {
            protocolVersion: LINK_PROTOCOL_VERSION,
            profileName,
            deviceId: data.device.id
          })
        }
      )

      socket.on(
        LEON_CLIENT_INTERFACE_EVENTS.init,
        async (data: LeonClientInterfaceInitPayload) => {
          this.setActiveSocket(socket)

          const profileName = this.isLeonClientInterfaceAuthorized(socket, data)

          if (!profileName) {
            this.emitLeonClientError(socket, {
              code: LEON_CLIENT_INTERFACE_UNAUTHORIZED_ERROR,
              message: 'Unauthorized Leon client interface connection.'
            })
            socket.disconnect(true)
            return
          }

          if (
            data.protocolVersion &&
            data.protocolVersion !== LEON_CLIENT_INTERFACE_PROTOCOL_VERSION
          ) {
            this.emitLeonClientError(socket, {
              code: LEON_CLIENT_INTERFACE_UNSUPPORTED_PROTOCOL_ERROR,
              message: `Unsupported Leon client protocol version: ${data.protocolVersion}`
            })
            return
          }

          const chatClient = await runWithProfileContext(
            { profileName },
            async () => {
              await ensureActiveProfileRuntime()
              return this.registerLeonClient(socket, data, profileName)
            }
          )

          LogHelper.info(`Type: ${chatClient.clientType}`)
          LogHelper.info(`Client ID: ${chatClient.id}`)
          LogHelper.info(`Socket ID: ${socket.id}`)

          this.emitClientRuntimeReadyWhenAvailable(chatClient)

          const usesLlamaCPP = runWithProfileContext(
            { profileName },
            () => this.shouldMonitorLlamaCPPInitialization()
          )

          if (usesLlamaCPP) {
            runWithProfileContext({ profileName }, () => {
              socket.emit(
                'init-llama-server-boot',
                LLM_PROVIDER.llamaCPPServerBootStatus
              )
            })
          }

          this.monitorLLMInitialization(socket, {
            profileName,
            usesLlamaCPP
          })

          socket.on(
            LEON_CLIENT_INTERFACE_EVENTS.utterance,
            async (payload: LeonClientInterfaceUtterancePayload) => {
              const message =
                typeof payload?.value === 'string' ? payload.value : ''

              await this.handleOwnerMessage(socket, {
                client: chatClient.client,
                value: message,
                ...(payload.messageId ? { messageId: payload.messageId } : {}),
                ...(typeof payload.sentAt === 'number'
                  ? { sentAt: payload.sentAt }
                  : {}),
                sessionId: payload.sessionId || chatClient.sessionId,
                ...(payload.commandContext
                  ? { commandContext: payload.commandContext }
                  : {})
              })
            }
          )

          socket.on('session-change', (sessionId: string) => {
            runWithProfileContext({ profileName }, () => {
              this.setActiveSocket(socket)
              const session = CONVERSATION_SESSION_MANAGER.setActiveSession(
                sessionId
              )

              this.setChatClientSession(socket.id, session.id)
            })
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
            await this.handleWidgetEvent(socket, event)
          })
        }
      )

      // Init
      socket.on('init', async (data: string | InitDataEvent) => {
        this.setActiveSocket(socket)

        const initData = this.normalizeInitData(data)
        const profileName = this.isLeonClientInterfaceAuthorized(socket)

        if (!profileName) {
          socket.emit('unauthorized')
          socket.disconnect(true)
          return
        }

        const chatClient = await runWithProfileContext(
          { profileName },
          async () => {
            await ensureActiveProfileRuntime()
            return this.registerChatClient(socket, initData, profileName)
          }
        )

        LogHelper.info(`Type: ${initData.client}`)
        LogHelper.info(`Socket ID: ${socket.id}`)

        socket.emit('init-client-core-server-handshake', 'success')

        // TODO
        // const provider = await addProvider(socket.id)

        this.emitClientRuntimeReadyWhenAvailable(chatClient)

        const usesLlamaCPP = runWithProfileContext(
          { profileName },
          () => this.shouldMonitorLlamaCPPInitialization()
        )

        if (usesLlamaCPP) {
          runWithProfileContext({ profileName }, () => {
            socket.emit(
              'init-llama-server-boot',
              LLM_PROVIDER.llamaCPPServerBootStatus
            )
          })
        }

        this.monitorLLMInitialization(socket, {
          profileName,
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
            runWithProfileContext({ profileName }, () => {
              this.setActiveSocket(socket)
              const session = CONVERSATION_SESSION_MANAGER.setActiveSession(
                sessionId
              )

              this.setChatClientSession(socket.id, session.id)
            })
          })

          // Listen for new utterance
          socket.on('utterance', async (utteranceData: UtteranceDataEvent) => {
            await this.handleOwnerMessage(socket, utteranceData)
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
            await this.handleWidgetEvent(socket, event)
          })
        }
      })

      socket.once('disconnect', () => {
        this.unregisterChatClient(socket.id)
        const linkClient = this.linkClients.get(socket.id)

        if (linkClient) {
          runWithProfileContext(
            { profileName: linkClient.profileName },
            () => {
              TOOLKIT_REGISTRY.removeLinkTools(linkClient.deviceId)
              LINK_REGISTRY.unregister(
                linkClient.profileName,
                linkClient.deviceId
              )
            }
          )
          this.linkClients.delete(socket.id)
        }
        // TODO
        // deleteProvider(this.socket.id)
      })
    })
  }
}
