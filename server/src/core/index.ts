import { HOST, PORT, TCP_SERVER_HOST, TCP_SERVER_PORT } from '@/constants'
import TCPClient from '@/core/tcp-client'
import HTTPServer from '@/core/http-server/http-server'
import SocketServer from '@/core/socket-server'
import SpeechToText from '@/core/stt/stt'
import TextToSpeech from '@/core/tts/tts'
import AutomaticSpeechRecognition from '@/core/asr/asr'
import NamedEntityRecognition from '@/core/nlp/nlu/ner'
import ModelLoader from '@/core/nlp/nlu/model-loader'
import NaturalLanguageUnderstanding from '@/core/nlp/nlu/nlu'
import Brain from '@/core/brain/brain'

/**
 * Register core singletons
 */

export const TCP_CLIENT = new TCPClient(
  String(TCP_SERVER_HOST),
  TCP_SERVER_PORT
)

export const HTTP_SERVER = new HTTPServer(String(HOST), PORT)

export const SOCKET_SERVER = new SocketServer()

export const STT = new SpeechToText()

export const TTS = new TextToSpeech()

export const ASR = new AutomaticSpeechRecognition()

export const NER = new NamedEntityRecognition()

export const MODEL_LOADER = new ModelLoader()

export const NLU = new NaturalLanguageUnderstanding()

export const BRAIN = new Brain()
