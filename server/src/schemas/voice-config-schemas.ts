import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const amazonVoiceConfiguration = Type.Strict(
  Type.Object({
    credentials: Type.Object({
      accessKeyId: Type.String({ description: 'AWS access key ID used to sign voice service requests.' }),
      secretAccessKey: Type.String({ description: 'AWS secret access key paired with the access key ID.' })
    }, {
      description: 'AWS credentials Leon uses for the Amazon voice provider.'
    }),
    region: Type.String({ description: 'AWS region in which Leon calls the voice service.' })
  })
)
export const googleCloudVoiceConfiguration = Type.Strict(
  Type.Object({
    type: Type.Literal('service_account', {
      description: 'Credential type for the Google Cloud service account used by Leon.'
    }),
    project_id: Type.String({ description: 'Google Cloud project ID associated with the service account.' }),
    private_key_id: Type.String({ description: 'ID of the service account key in this credential.' }),
    private_key: Type.String({ description: 'PEM-encoded private key used to sign service account assertions.' }),
    client_email: Type.String({
      format: 'email',
      description: 'Email address that identifies the service account.'
    }),
    client_id: Type.String({ description: 'OAuth client ID assigned to the service account by Google.' }),
    auth_uri: Type.String({
      format: 'uri',
      description: 'OAuth authorization endpoint listed in the Google credential file.'
    }),
    token_uri: Type.String({
      format: 'uri',
      description: 'OAuth endpoint used to obtain an access token for Google Cloud APIs.'
    }),
    auth_provider_x509_cert_url: Type.String({
      format: 'uri',
      description: 'URL for Google’s OAuth provider X.509 certificates.'
    }),
    client_x509_cert_url: Type.String({
      format: 'uri',
      description: 'URL for the public X.509 certificates of this service account.'
    })
  })
)
export const watsonVoiceConfiguration = Type.Strict(
  Type.Object({
    apikey: Type.String({ description: 'IBM Cloud API key used to authenticate with the Watson service instance.' }),
    url: Type.String({
      format: 'uri',
      description: 'Endpoint URL of the Watson speech service instance.'
    })
  })
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
