import addFormats from 'ajv-formats'
import Ajv from 'ajv'

export const ajv = addFormats(
  new Ajv({
    allErrors: true,
    verbose: true
  }),
  [
    'date-time',
    'time',
    'date',
    'email',
    'hostname',
    'ipv4',
    'ipv6',
    'uri',
    'uri-reference',
    'uuid',
    'uri-template',
    'json-pointer',
    'relative-json-pointer',
    'regex'
  ]
)
