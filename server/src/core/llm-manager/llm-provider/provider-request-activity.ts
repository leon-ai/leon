import type { CompletionStreamEvent, ProviderActivitySnapshot } from '@/core/llm-manager/types'

const CONNECTION_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_NETWORK'
])

const MAX_METADATA_CHARS = 256
const CONTROL_EVENTS = new Set([
  'request-dispatched', 'request-upload-start', 'request-uploaded',
  'response-headers', 'transport-activity', 'transport-heartbeat', 'stream-open', 'stream-start',
  'prompt-cache'
])

/**
 * Tracks request-local progress across provider adapters without retaining
 * prompts, generated content, credentials or heartbeat payloads.
 */
export class ProviderRequestActivity {
  private readonly state: Omit<ProviderActivitySnapshot, 'elapsedMs'> = {
    providerEventCount: 0,
    providerCompleted: false
  }

  private heartbeat: CompletionStreamEvent['heartbeat']

  public constructor(private readonly startedAt = Date.now()) {}

  /**
   * Transport writes and heartbeats never establish provider acceptance.
   */
  public observe(event: CompletionStreamEvent): void {
    const now = Date.now() - this.startedAt
    if (event.heartbeat) {
      this.heartbeat = { ...event.heartbeat }
    }
    this.state.transport = event.transport ?? this.state.transport
    this.state.requestId = event.requestId?.slice(0, MAX_METADATA_CHARS) ?? this.state.requestId
    this.state.responseId = event.responseId?.slice(0, MAX_METADATA_CHARS) ?? this.state.responseId
    this.state.requestBytes = event.requestBytes ?? this.state.requestBytes
    this.state.uploadDurationMs = event.uploadDurationMs ?? this.state.uploadDurationMs
    if (event.requestAccepted) {
      this.state.requestAcceptedMs ??= now
    }
    if (event.providerCompleted || event.type === 'finish') {
      this.state.providerCompleted = true
    }
    if (event.type === 'text-start') {
      this.state.outputPreliminary = event.preliminary === true
    }
    if (CONTROL_EVENTS.has(event.type) ||
      (event.type === 'response-metadata' && !event.responseId)) {
      return
    }

    this.state.firstProviderEventMs ??= now
    this.state.lastProviderEventMs = now
    this.state.lastProviderEvent = (event.providerEventType ?? event.type).slice(0, MAX_METADATA_CHARS)
    this.state.providerEventCount += 1
  }

  /**
   * Actual model output proves acceptance even without protocol metadata.
   */
  public generationStarted(): void {
    this.state.requestAcceptedMs ??= Date.now() - this.startedAt
  }

  /**
   * Partial output must not be silently replayed after a stalled stream.
   */
  public outputStarted(): void {
    this.state.firstOutputMs ??= Date.now() - this.startedAt
  }

  /**
   * Produces bounded metadata for logs, errors and agent continuation evidence.
   */
  public snapshot(): ProviderActivitySnapshot {
    const elapsedMs = Date.now() - this.startedAt

    return {
      ...this.state,
      ...(this.heartbeat ? {
        pingCount: this.heartbeat.pingCount,
        pongCount: this.heartbeat.pongCount,
        lastPingAgeMs: this.heartbeat.lastPingAt === undefined
          ? undefined
          : Date.now() - this.heartbeat.lastPingAt,
        lastPongAgeMs: this.heartbeat.lastPongAt === undefined
          ? undefined
          : Date.now() - this.heartbeat.lastPongAt,
        lastPongRttMs: this.heartbeat.lastPongRttMs
      } : {}),
      elapsedMs,
      providerIdleMs: this.state.lastProviderEventMs === undefined
        ? undefined
        : elapsedMs - this.state.lastProviderEventMs
    }
  }
}

/**
 * Read transport error codes through SDK wrappers and aggregate dial errors.
 */
export function getConnectionErrorCode(error: unknown): string | undefined {
  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const current = pending.pop()

    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }

    visited.add(current)

    const details = current as Record<string, unknown>
    const code = details['code']

    // ETIMEDOUT also describes read timeouts; only classify an explicit dial.
    if (typeof code === 'string' && (
      CONNECTION_ERROR_CODES.has(code) ||
      (code === 'ETIMEDOUT' && details['syscall'] === 'connect')
    )) {
      return code
    }
    if (details['closeCode'] === 1_006) {
      return 'WEBSOCKET_ABNORMAL_CLOSURE'
    }
    // A connection that delivered neither events nor pong replies needs
    // transport recovery even when the eventual error is a watchdog timeout.
    if (details['providerEventCount'] === 0 && details['requestAcceptedMs'] === undefined &&
      typeof details['pingCount'] === 'number' && details['pingCount'] > 0 && details['pongCount'] === 0) {
      return 'PROVIDER_CONNECTION_UNRESPONSIVE'
    }

    pending.push(details['cause'])

    if (current instanceof AggregateError) {
      pending.push(...current.errors)
    }
  }

  return undefined
}

/**
 * Keeps observed request progress with the failure. Acceptance and completion
 * are evidence; a transport error alone cannot locate a network fault.
 */
export function attachProviderFailureDiagnostics(
  error: unknown,
  activity: ProviderActivitySnapshot,
  cancelled = false
): void {
  if (!(error instanceof Error) || cancelled) {
    return
  }

  const failureSummary = activity.providerCompleted
    ? 'The provider reported completion, but response delivery or local processing failed.'
    : activity.requestAcceptedMs !== undefined
      ? 'The provider accepted the request, but no completed response was confirmed.'
      : 'The request failed before provider acceptance was confirmed.'

  Object.assign(error, Object.fromEntries(
    Object.entries(activity).filter(([, value]) => value !== undefined)
  ), {
    failureSummary
  })
}

