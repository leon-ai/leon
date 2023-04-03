import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const amazonVoiceConfiguration = Type.Strict(
  Type.Object(
    {
      credentials: Type.Object({
        accessKeyId: Type.String(),
        secretAccessKey: Type.String()
      }),
      region: Type.String()
    },
    { additionalProperties: false }
  )
)
export const googleCloudVoiceConfiguration = Type.Strict(
  Type.Object(
    {
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
    },
    { additionalProperties: false }
  )
)
export const watsonVoiceConfiguration = Type.Strict(
  Type.Object(
    {
      apikey: Type.String(),
      url: Type.String({ format: 'uri' })
    },
    { additionalProperties: false }
  )
)

export type AmazonVoiceConfigurationSchema = Static<
  typeof amazonVoiceConfiguration
>
export type GoogleCloudVoiceConfigurationSchema = Static<
  typeof googleCloudVoiceConfiguration
>
export type WatsonVoiceConfigurationSchema = Static<
  typeof watsonVoiceConfiguration
>
export type VoiceConfigurationSchema =
  | AmazonVoiceConfigurationSchema
  | GoogleCloudVoiceConfigurationSchema
  | WatsonVoiceConfigurationSchema
