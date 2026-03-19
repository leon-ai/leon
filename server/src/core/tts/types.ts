import type LocalSynthesizer from '@/core/tts/synthesizers/local-synthesizer'
import type AmazonPollySynthesizer from '@/core/tts/synthesizers/amazon-polly-synthesizer'
import type FliteSynthesizer from '@/core/tts/synthesizers/flite-synthesizer'
import type GoogleCloudTTSSynthesizer from '@/core/tts/synthesizers/google-cloud-tts-synthesizer'
import type WatsonTTSSynthesizer from '@/core/tts/synthesizers/watson-tts-synthesizer'
import type CambAISynthesizer from '@/core/tts/synthesizers/camb-ai-synthesizer'

export enum TTSProviders {
  Local = 'local',
  AmazonPolly = 'amazon-polly',
  GoogleCloudTTS = 'google-cloud-tts',
  WatsonTTS = 'watson-tts',
  Flite = 'flite',
  CambAI = 'camb-ai'
}

export enum TTSSynthesizers {
  Local = 'local-synthesizer',
  AmazonPolly = 'amazon-polly-synthesizer',
  GoogleCloudTTS = 'google-cloud-tts-synthesizer',
  WatsonTTS = 'watson-tts-synthesizer',
  Flite = 'flite-synthesizer',
  CambAI = 'camb-ai-synthesizer'
}

export interface SynthesizeResult {
  audioFilePath: string
  duration: number
}

export type TTSSynthesizer =
  | LocalSynthesizer
  | AmazonPollySynthesizer
  | FliteSynthesizer
  | GoogleCloudTTSSynthesizer
  | WatsonTTSSynthesizer
  | CambAISynthesizer
  | undefined
