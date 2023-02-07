import type { AmazonPollyTTSSynthesizer } from '@/core/tts/synthesizers/amazon-polly-synthesizer'
import type { FliteTTSSynthesizer } from '@/core/tts/synthesizers/flite-synthesizer'
import type { GoogleCloudTTSSynthesizer } from '@/core/tts/synthesizers/google-cloud-synthesizer'
import type { WatsonTTSSynthesizer } from '@/core/tts/synthesizers/watson-tts-synthesizer'

export enum TTSProviders {
  AmazonPolly = 'amazon-polly',
  GoogleCloudTTS = 'google-cloud-tts',
  WatsonTTS = 'watson-tts',
  Flite = 'flite'
}

export enum TTSSynthesizers {
  AmazonPolly = 'amazon-polly-synthesizer',
  GoogleCloudTTS = 'google-cloud-tts-synthesizer',
  WatsonTTS = 'watson-tts-synthesizer',
  Flite = 'flite-synthesizer'
}

export type SynthesizeResult = {
  audioFilePath: string
  duration: number
}

export type TTSSynthesizer = AmazonPollyTTSSynthesizer | FliteTTSSynthesizer | GoogleCloudTTSSynthesizer | WatsonTTSSynthesizer | undefined
