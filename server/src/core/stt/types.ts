import type { CoquiSTTParser } from '@/core/stt/parsers/coqui-stt-parser'
import type { GoogleCloudSTTParser } from '@/core/stt/parsers/google-cloud-stt-parser'
import type { WatsonSTTParser } from '@/core/stt/parsers/watson-stt-parser'

export enum STTProviders {
  GoogleCloudSTT = 'google-cloud-stt',
  WatsonSTT = 'watson-stt',
  CoquiSTT = 'coqui-stt'
}

export enum STTParserNames {
  GoogleCloudSTT = 'google-cloud-stt-parser',
  WatsonSTT = 'watson-stt-parser',
  CoquiSTT = 'coqui-stt-parser'
}

export type STTParser =
  | GoogleCloudSTTParser
  | WatsonSTTParser
  | CoquiSTTParser
  | undefined
