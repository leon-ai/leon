import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import ts from 'typescript'
import { PROFILE_AUTH_COOKIE_NAME } from '../../../server/src/core/http-server/profile-auth-contract'
import type { DesktopContract } from '../runtime/desktop-contract.mjs'
import type { BootstrapContract } from '../runtime/bootstrap-contract.mjs'
import { getMinimumServerVersion, RELEASE_SOURCE_NAME } from '../../../scripts/release/release-content'

import {
  OWNER_ATTACHMENT_MAX_COUNT, OWNER_ATTACHMENT_MAX_FILE_BYTES,
  OWNER_ATTACHMENT_FORMATS, getOwnerAttachmentSizeLimit
} from '../../../server/src/core/owner-attachments/owner-attachment-contract.ts'
import {
  DESKTOP_FILES_EVENT, DESKTOP_FILES_PATH, DESKTOP_UPDATES_PATH,
  DESKTOP_UPDATES_META_NAME, WebPreferenceKey
} from '../../../bridges/runtime/contracts/desktop-client.ts'

const OUTPUT = fileURLToPath(new URL('../.generated/runtime/', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const semver = createRequire(import.meta.url)('semver')
const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
const release = JSON.parse(await readFile(path.join(ROOT, RELEASE_SOURCE_NAME), 'utf8')) as { desktop?: unknown } | null
const minimumServerVersion = getMinimumServerVersion(release?.desktop, manifest.version)
const repository = new URL(manifest.repository.url.replace('git+', ''))
if (repository.pathname.endsWith('.git')) {
  repository.pathname = repository.pathname.slice(0, -4)
}

// Read the canonical default without loading profile configuration or the server runtime.
const config = ts.createSourceFile('config.ts',
  await readFile(path.join(ROOT, 'server/src/config.ts'), 'utf8'), ts.ScriptTarget.Latest)
let defaultPort: number | undefined
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(config) === 'DEFAULT_CONFIG' &&
      node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    const server = node.initializer.properties.find((item) => item.name?.getText(config) === 'server')
    if (server && ts.isPropertyAssignment(server) && ts.isObjectLiteralExpression(server.initializer)) {
      const port = server.initializer.properties.find((item) => item.name?.getText(config) === 'port')
      if (port && ts.isPropertyAssignment(port) && ts.isNumericLiteral(port.initializer)) {
        defaultPort = Number(port.initializer.text)
      }
    }
  }
  ts.forEachChild(node, visit)
}
visit(config)
if (!Number.isInteger(defaultPort)) {
  throw new Error('The default server port is unavailable')
}

await mkdir(OUTPUT, { recursive: true })
await writeFile(path.join(OUTPUT, 'desktop-contract.mjs'), 'export default ' + JSON.stringify({
  filesEvent: DESKTOP_FILES_EVENT,
  filesPath: DESKTOP_FILES_PATH,
  updatesPath: DESKTOP_UPDATES_PATH,
  updatesMetaName: DESKTOP_UPDATES_META_NAME,
  profileCookieName: PROFILE_AUTH_COOKIE_NAME,
  preferenceKeys: Object.values(WebPreferenceKey),
  preferencePrefixes: [`${WebPreferenceKey.RecentModels}.`],
  maximumFiles: OWNER_ATTACHMENT_MAX_COUNT,
  maximumBytes: OWNER_ATTACHMENT_MAX_FILE_BYTES,
  formats: OWNER_ATTACHMENT_FORMATS.map((format) => ({
    ...format, maximumBytes: getOwnerAttachmentSizeLimit(format)
  }))
} satisfies DesktopContract, null, 2) + '\n')
await writeFile(path.join(OUTPUT, 'bootstrap-contract.mjs'), 'export default ' + JSON.stringify({
  repository: repository.href,
  author: manifest.author,
  defaultPort: defaultPort!,
  minimumVersion: minimumServerVersion,
  serverVersionRange: `>=${minimumServerVersion} <${semver.major(minimumServerVersion) + 1}.0.0-0`,
  sourceVersion: manifest.version,
  channel: manifest.version.includes('-') ? 'preview' : 'stable'
} satisfies BootstrapContract, null, 2) + '\n')
