import { describe, expect, it } from 'vitest'

import { StringHelper } from '@/helpers/string-helper'

const SECRET = 'fake-credential_0123456789+/='
const REDACTED_SECRET = '[REDACTED_SECRET]'

describe('StringHelper.redactSecrets', () => {
  it.each([
    'OPENAI_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD', 'access_token',
    'refresh_token', 'client_secret', 'secret_key', 'SECRET-KEY',
    'apiKey', 'api key', 'token', 'password', 'secret'
  ])('redacts %s assignments without changing their surrounding text', (key) => {
    for (const separator of ['=', ': ']) {
      for (const quote of ['', '"', '\'']) {
        const prefix = `before\n${key}${separator}${quote}`
        const suffix = `${quote}\nafter`

        expect(StringHelper.redactSecrets(`${prefix}${SECRET}${suffix}`))
          .toBe(`${prefix}${REDACTED_SECRET}${suffix}`)
      }
    }
  })

  it('preserves JSON and its string contents across nested serialization', () => {
    let input = JSON.stringify({
      access_token: SECRET,
      nested: { secret_key: SECRET },
      message: `OPENAI_API_KEY="${SECRET}"`,
      authorization: `Bearer ${SECRET}`,
      command: `run --api-token ${SECRET}`,
      quotedCommand: `run --api-token ${SECRET}"`,
      windowsCommand: 'run --api-token abc\\def\\ghi'
    })
    let expected = JSON.stringify({
      access_token: REDACTED_SECRET,
      nested: { secret_key: REDACTED_SECRET },
      message: `OPENAI_API_KEY="${REDACTED_SECRET}"`,
      authorization: `Bearer ${REDACTED_SECRET}`,
      command: `run --api-token ${REDACTED_SECRET}`,
      quotedCommand: `run --api-token ${REDACTED_SECRET}"`,
      windowsCommand: `run --api-token ${REDACTED_SECRET}`
    })

    for (let depth = 0; depth < 4; depth += 1) {
      const output = StringHelper.redactSecrets(input)

      expect(output).toBe(expected)
      expect(JSON.parse(output)).toEqual(JSON.parse(expected))

      input = JSON.stringify({ stdout: input })
      expected = JSON.stringify({ stdout: expected })
    }
  })

  it('redacts bearer and command-line credentials alongside assignments', () => {
    const input = `token=${SECRET}\nAuthorization: Bearer ${SECRET}\nrun --api-token short!value`

    expect(StringHelper.redactSecrets(input)).toBe(
      `token=${REDACTED_SECRET}\nAuthorization: Bearer ${REDACTED_SECRET}\nrun --api-token ${REDACTED_SECRET}`
    )
  })

  it('leaves ordinary names, prose and short values intact', () => {
    const input = [
      'max_tokens=1234567890123456',
      'tokenizer=abcdefghijklmnop',
      'passwordless=abcdefghijklmnop',
      'secretary=abcdefghijklmnop',
      'mysecret=abcdefghijklmnop',
      'token2=abcdefghijklmnop',
      'api_key_id=abcdefghijklmnop',
      'api_key=short',
      'Bearer short',
      'The token belongs to the owner.',
      '',
      REDACTED_SECRET
    ].join('\n')

    expect(StringHelper.redactSecrets(input)).toBe(input)
  })

  it('handles large mixed output and repeated redaction without changing safe content', () => {
    const safe = 'A completed operation with ordinary output.\n'.repeat(10_000)
    const input = `${safe}GITHUB_TOKEN=${SECRET}\n${safe}`
    const expected = `${safe}GITHUB_TOKEN=${REDACTED_SECRET}\n${safe}`

    expect(StringHelper.redactSecrets(input)).toBe(expected)
    expect(StringHelper.redactSecrets(expected)).toBe(expected)
    expect(StringHelper.redactSecrets('')).toBe('')
  })
})
