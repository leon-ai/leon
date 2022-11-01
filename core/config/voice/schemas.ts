import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

const amazonVoiceConfiguration = Type.Object({
  credentials: Type.Object({
    accessKeyId: Type.String(),
    secretAccessKey: Type.String()
  }),
  region: Type.String()
})
const googleCloudVoiceConfiguration = Type.Object({
  type: Type.Literal('service_account'),
  project_id: Type.String(),
  private_key_id: Type.String(),
  private_key: Type.String(),
  client_email: Type.String({ format: 'email' }),
  client_id: Type.String(),
  auth_uri: Type.String({ format: 'uri' }),
  token_uri: Type.String({ format: 'uri' }),
  auth_provider_x509_cert_url: Type.String({ format: 'uri' }),
  client_x509_cert_url: Type.String({ format: 'uri' })
})
const watsonVoiceConfiguration = Type.Object({
  apikey: Type.String(),
  url: Type.String({ format: 'uri' })
})

export type AmazonVoiceConfiguration = Static<typeof amazonVoiceConfiguration>
export type GoogleCloudVoiceConfiguration = Static<
  typeof googleCloudVoiceConfiguration
>
export type WatsonVoiceConfiguration = Static<typeof watsonVoiceConfiguration>
