import type { ChunkData } from '@/core/tcp-client'
import { ASRParserBase } from '@/core/asr/asr-parser-base'
import { LogHelper } from '@/helpers/log-helper'
import { BRAIN, SOCKET_SERVER } from '@/core'

interface EventHandler {
  [key: string]: (firstEvent: ChunkData) => void
}

const STARTED_RECORDING_EVENT = 'asr-started-recording'
const INTERRUPT_LEON_SPEECH_EVENT = 'asr-interrupt-leon-speech'
const NEW_SPEECH_EVENT = 'asr-new-speech'
const END_OF_OWNER_SPEECH_DETECTED_EVENT = 'asr-end-of-owner-speech-detected'
const ACTIVE_LISTENING_DURATION_INCREASED_EVENT =
  'asr-active-listening-duration-increased'
const ACTIVE_LISTENING_DISABLED_EVENT = 'asr-active-listening-disabled'

const EVENT_HANDLERS: EventHandler = {
  [STARTED_RECORDING_EVENT]: (): void => {
    //
  },

  [INTERRUPT_LEON_SPEECH_EVENT]: (): void => {
    /**
     * If Leon is talking with voice, then interrupt him
     */
    if (BRAIN.isTalkingWithVoice) {
      BRAIN.setIsTalkingWithVoice(false, { shouldInterrupt: true })
    }
  },

  [NEW_SPEECH_EVENT]: (firstEvent): void => {
    /**
     * If Leon is talking with voice, then interrupt him
     */
    if (BRAIN.isTalkingWithVoice) {
      BRAIN.setIsTalkingWithVoice(false, { shouldInterrupt: true })
    }

    // Send the owner speech to the client
    SOCKET_SERVER.socket?.emit('asr-speech', firstEvent.data['text'])
  },

  [END_OF_OWNER_SPEECH_DETECTED_EVENT]: (firstEvent): void => {
    SOCKET_SERVER.socket?.emit('asr-end-of-owner-speech', {
      completeSpeech: firstEvent.data['utterance']
    })
  },

  [ACTIVE_LISTENING_DURATION_INCREASED_EVENT]: (): void => {
    //
  },

  [ACTIVE_LISTENING_DISABLED_EVENT]: (): void => {
    SOCKET_SERVER.socket?.emit('asr-active-listening-disabled')
  }
}

export default class LocalParser extends ASRParserBase {
  protected readonly name = 'Local ASR Parser'

  constructor() {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    try {
      LogHelper.success('Parser initialized')
    } catch (e) {
      LogHelper.error(`${this.name} - Failed to initialize: ${e}`)
    }
  }

  /**
   * Parse the string chunk and emit the events to the client
   * @param strChunk - The string chunk to parse. E.g. `{"topic": "asr-new-speech", "data": {"text": " the other day I was thinking about the"}}{"topic": "asr-new-speech", "data": {"text": " magic number but"}}`
   */
  public async parse(strChunk: string): Promise<string | null> {
    const rawEvents = strChunk.match(/{"topic": "asr-[^}]+}/g)

    if (!rawEvents) {
      LogHelper.title(this.name)
      LogHelper.error(`No topics found in the chunk: ${strChunk}`)
      return null
    }

    let events: ChunkData[] = rawEvents.map((topic) => {
      return JSON.parse(`${topic}}`)
    })
    const [firstEvent] = events

    if (!firstEvent) {
      LogHelper.title(this.name)
      LogHelper.error(`No first event found in the chunk: ${strChunk}`)
      return null
    }

    // Verify if all topics are similar to be ready to merge them
    const areAllTopicsSimilar = events.every(
      (event) => event.topic === firstEvent?.topic
    )
    if (areAllTopicsSimilar) {
      try {
        /**
         * Merge the topics in one and concat the text
         * if all topics are a new speech event
         */
        if (firstEvent.topic === NEW_SPEECH_EVENT) {
          const mergedText = events
            .map((event) => event.data['text'])
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()

          events = [{ topic: NEW_SPEECH_EVENT, data: { text: mergedText } }]
        }

        /**
         * Can handle additional merge here if needed...
         */
      } catch (e) {
        LogHelper.title(this.name)
        LogHelper.error(`Failed to merge the topics: ${e}`)
        LogHelper.error(`Events: ${events}`)

        return null
      }
    }

    const [updatedEvent]: ChunkData[] = events

    if (!updatedEvent) {
      LogHelper.title(this.name)
      LogHelper.error(`No updated event found in the chunk: ${strChunk}`)
      return null
    }

    const handler = EVENT_HANDLERS[updatedEvent.topic]
    if (handler) {
      handler(updatedEvent)
    } else {
      LogHelper.title(this.name)
      LogHelper.error(`No handler found for the topic: ${updatedEvent?.topic}`)
    }

    return null
  }
}
