import assert from 'node:assert/strict'
import { createPrivateKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const MAC_CREDENTIALS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_TEAM_ID'
]
const WINDOWS_CREDENTIALS = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']

/**
 * Rejects incomplete release credentials before compiling or packaging assets.
 * Native signature verification still establishes trust after packaging.
 */
export async function checkReleaseSigning({
  platform = process.platform,
  arch = process.arch,
  env = process.env
} = {}) {
  if (platform === 'linux') {
    return
  }

  assert(['darwin', 'win32'].includes(platform), 'Unsupported desktop release platform')
  if (platform === 'darwin') {
    assert.equal(arch, 'arm64', 'macOS releases support Apple Silicon only')
  }

  const credentials = platform === 'darwin' ? MAC_CREDENTIALS : WINDOWS_CREDENTIALS
  const missing = credentials.filter((name) => !env[name]?.trim())
  assert.equal(missing.length, 0, `Missing release signing settings: ${missing.join(', ')}`)

  if (platform === 'darwin') {
    // APPLE_API_KEY is a file path; passing the secret contents to the builder
    // instead would fail only after the app has already been packaged.
    let key
    try {
      key = createPrivateKey(await readFile(env.APPLE_API_KEY))
    } catch {
      throw new Error('APPLE_API_KEY must point to a readable, unencrypted Apple .p8 private key file')
    }

    assert.equal(key.asymmetricKeyType, 'ec', 'Apple notarization requires an EC private key')
    assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1', 'Apple notarization requires a P-256 private key')
  }
}

if (import.meta.main) {
  try {
    await checkReleaseSigning()
    console.log('Release signing settings checked; native verification follows packaging.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
