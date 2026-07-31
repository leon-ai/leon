import { describe, expect, it } from 'vitest'

import { JsonRedactionHelper } from '@/helpers/json-redaction-helper'

describe('JsonRedactionHelper', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      JsonRedactionHelper.redactSensitiveValues({
        OPENROUTER_API_KEY: 'sk-test',
        nested: {
          access_token: 'token-test',
          model: 'google/gemini'
        },
        providers: [
          {
            clientSecret: 'secret-test',
            name: 'openrouter'
          }
        ]
      })
    ).toEqual({
      OPENROUTER_API_KEY: '***',
      nested: {
        access_token: '***',
        model: 'google/gemini'
      },
      providers: [
        {
          clientSecret: '***',
          name: 'openrouter'
        }
      ]
    })
  })
})
