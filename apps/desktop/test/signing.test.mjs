import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { checkReleaseSigning } from '../scripts/check-signing.mjs'

test('release signing rejects missing credentials and unsupported macOS releases before packaging', async () => {
  await assert.rejects(checkReleaseSigning({ platform: 'darwin', arch: 'arm64', env: {} }), /Missing release signing settings/)
  await assert.rejects(checkReleaseSigning({ platform: 'win32', env: {} }), /WIN_CSC_LINK/)
  await assert.rejects(checkReleaseSigning({ platform: 'darwin', arch: 'x64', env: {} }), /Apple Silicon only/)
  await checkReleaseSigning({ platform: 'linux', env: {} })
})

test('Apple release signing requires a readable P-256 private key without exposing invalid key contents', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'leon-signing-'))
  const filename = path.join(directory, 'AuthKey.p8')
  const env = {
    CSC_LINK: 'certificate-provided-to-builder',
    CSC_KEY_PASSWORD: 'certificate-password',
    APPLE_API_KEY: filename,
    APPLE_API_KEY_ID: 'key-id',
    APPLE_API_ISSUER: 'issuer-id',
    APPLE_TEAM_ID: 'team-id'
  }
  const check = () => checkReleaseSigning({ platform: 'darwin', arch: 'arm64', env })

  try {
    await assert.rejects(check(), /readable, unencrypted Apple .p8/)
    const invalid = 'private-key-material-must-not-appear-in-errors'
    await writeFile(filename, invalid)
    await assert.rejects(check(), (error) => {
      assert(!error.message.includes(invalid))
      assert.match(error.message, /readable, unencrypted Apple .p8/)
      return true
    })

    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    await writeFile(filename, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    await check()

    const other = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey
    await writeFile(filename, other.export({ type: 'pkcs8', format: 'pem' }))
    await assert.rejects(check(), /P-256 private key/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
