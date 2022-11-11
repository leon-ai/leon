import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const amazonVoiceConfiguration = Type.Object({
  credentials: Type.Object({
    accessKeyId: Type.String(),
    secretAccessKey: Type.String()
  }),
  region: Type.String()
})
export const googleCloudVoiceConfiguration = Type.Object({
  type: Type.Literal('service_account'),
  project_id: Type.String(),
  private_key_id: Type.String(),
  private_key: Type.String(),
  client_email: Type.String(),
  client_id: Type.String(),
  auth_uri: Type.String(),
  token_uri: Type.String(),
  auth_provider_x509_cert_url: Type.String(),
  client_x509_cert_url: Type.String()
})
export const watsonVoiceConfiguration = Type.Object({
  apikey: Type.String(),
  url: Type.String()
})

export type AmazonVoiceConfiguration = Static<typeof amazonVoiceConfiguration>
export type GoogleCloudVoiceConfiguration = Static<
  typeof googleCloudVoiceConfiguration
>
export type WatsonVoiceConfiguration = Static<typeof watsonVoiceConfiguration>
export type VoiceConfiguration =
  | AmazonVoiceConfiguration
  | GoogleCloudVoiceConfiguration
  | WatsonVoiceConfiguration
