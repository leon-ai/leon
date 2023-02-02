import type { AmazonPollyTTSSynthesizer } from '@/core/tts/synthesizers/amazon-polly-synthesizer'

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

// TODO
// export type TTSSynthesizer = AmazonPollyTTSSynthesizer | FliteTTSSynthesizer | GoogleCloudTTSSynthesizer | WatsonTTSSynthesizer | undefined
export type TTSSynthesizer = AmazonPollyTTSSynthesizer | undefined

export interface TTSSynthesizerFacade {
  synthesize(speech: string): Promise<SynthesizeResult | null>
}
