import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const DETECTION_TIMEOUT_MS = 1_000
const REGION_CACHE_MS = 6 * 60 * 60 * 1_000
const UNKNOWN_CACHE_MS = 5 * 60 * 1_000
const COUNTRY_ENDPOINT = 'https://ipapi.co/country/'
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const CHINA_NPM_REGISTRY = 'https://registry.npmmirror.com/'
export const CHINA_BINARY_BASE = 'https://cdn.npmmirror.com/binaries'
export const CHINA_PYPI_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
export const PUBLIC_PYPI_INDEX = 'https://pypi.org/simple/'
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
const checks = new Map()
const mirrorChecks = new Map()

/**
 * Avoid handing an unavailable endpoint to an external installer that only
 * accepts one host. Transfer failures remain governed by the installer's retry
 * policy; this bounded check is not a replacement for artifact verification.
 */
export async function isDownloadMirrorAvailable(url) {
  const existing = mirrorChecks.get(url)

  if (existing && existing.expiresAt > Date.now()) {
    return existing.promise
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        method: 'HEAD', signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS)
      })
      await response.body?.cancel()

      return response.ok
    } catch {
      return false
    }
  })()
  mirrorChecks.set(url, { promise, expiresAt: Date.now() + UNKNOWN_CACHE_MS })

  return promise
}

/**
 * Share bootstrap decisions across pnpm, setup workers and the server without loading
 * dependencies or storing the owner's IP address or profile location.
 */
export function getDownloadCachePath(environment = process.env) {
  return path.join(
    environment.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'leon', 'downloads'
  )
}

/**
 * Read disposable download metadata; unavailable caches must not block setup.
 */
export async function readDownloadCache(key, environment = process.env) {
  try {
    return JSON.parse(await fs.readFile(
      path.join(getDownloadCachePath(environment), `${key}.json`), 'utf8'
    ))
  } catch {
    return null
  }
}

/**
 * Replace cached metadata atomically so concurrent installers cannot truncate it.
 */
export async function writeDownloadCache(key, value, environment = process.env) {
  const directory = getDownloadCachePath(environment)
  const filename = path.join(directory, `${key}.json`)
  const temporary = `${filename}.${randomUUID()}`

  try {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await fs.rename(temporary, filename)
  } catch {
    // Read-only homes and concurrent processes may prevent cache persistence.
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

async function detectRegion(environment) {
  const cached = await readDownloadCache('region', environment)

  if (cached?.expiresAt > Date.now() && ['cn', 'global'].includes(cached.region)) {
    return cached.region
  }

  let region = 'global'
  let lifetime = UNKNOWN_CACHE_MS

  try {
    const response = await fetch(COUNTRY_ENDPOINT, {
      signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
      redirect: 'error'
    })
    const country = (await response.text()).trim().toUpperCase()

    if (response.ok && COUNTRY_CODE_PATTERN.test(country)) {
      region = country === 'CN' ? 'cn' : 'global'
      lifetime = REGION_CACHE_MS
    }
  } catch {
    // An offline or unidentifiable network retains the original download source.
  }

  await writeDownloadCache('region', {
    region, expiresAt: Date.now() + lifetime
  }, environment)

  return region
}

/**
 * Resolve the downloading host's network region, with a deterministic CI/owner
 * override. A VPN's exit country is intentional; locale is not network evidence.
 */
export async function getDownloadRegion(environment = process.env) {
  const override = environment.LEON_DOWNLOAD_REGION?.trim().toLowerCase() || 'auto'

  if (override === 'cn' || override === 'global') {
    return override
  }
  if (override !== 'auto') {
    throw new Error('LEON_DOWNLOAD_REGION must be auto, cn or global')
  }

  const cachePath = getDownloadCachePath(environment)
  const existing = checks.get(cachePath)

  if (existing && existing.expiresAt > Date.now()) {
    return existing.promise
  }

  const promise = detectRegion(environment)
  checks.set(cachePath, { promise, expiresAt: Date.now() + UNKNOWN_CACHE_MS })

  return promise
}

/**
 * Supply native installer defaults without replacing owner-defined sources,
 * proxies, credentials, per-browser hosts or dependency release-age policies.
 */
export async function getRegionalInstallerEnvironment(environment = process.env, { python = true } = {}) {
  const result = { ...environment }

  if (await getDownloadRegion(environment) !== 'cn') {
    return result
  }

  const [pythonAvailable, binariesAvailable] = await Promise.all([
    python ? isDownloadMirrorAvailable(`${CHINA_PYPI_INDEX}pip/`) : false,
    isDownloadMirrorAvailable(`${CHINA_BINARY_BASE}/node/index.json`)
  ])

  if (!['UV_DEFAULT_INDEX', 'UV_INDEX_URL', 'UV_INDEX', 'UV_EXTRA_INDEX_URL', 'UV_INDEX_STRATEGY',
    'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL'].some((key) => environment[key]) && pythonAvailable) {
    // These endpoints serve the same public namespace. Never extend this
    // strategy to owner indexes: private names must not leak to public PyPI.
    result.UV_INDEX = CHINA_PYPI_INDEX
    result.UV_DEFAULT_INDEX = PUBLIC_PYPI_INDEX
    result.UV_INDEX_STRATEGY = 'unsafe-first-match'
  }

  if (binariesAvailable) {
    result.PLAYWRIGHT_DOWNLOAD_HOST ??= `${CHINA_BINARY_BASE}/playwright`
    if (!environment.npm_config_electron_mirror && !environment.NPM_CONFIG_ELECTRON_MIRROR) {
      result.ELECTRON_MIRROR ??= `${CHINA_BINARY_BASE}/electron/`
    }
    result.NODEJS_ORG_MIRROR ??= `${CHINA_BINARY_BASE}/node`
    if (!environment.NPM_CONFIG_DISTURL && !environment.npm_config_dist_url && !environment.NPM_CONFIG_DIST_URL) {
      result.npm_config_disturl ??= `${CHINA_BINARY_BASE}/node`
    }
    if (python) {
      result.UV_PYTHON_INSTALL_MIRROR ??= `${CHINA_BINARY_BASE}/python-build-standalone`
    }
  }

  return result
}

/**
 * Set pnpm's default public route before dependency resolution while retaining
 * all private scopes and URI-bound credentials. CLI routes still win in pnpm.
 */
export async function configureRegionalPnpm(config) {
  if (await getDownloadRegion() !== 'cn') {
    return config
  }

  const registries = config.registriesByScope || {}
  const registry = registries.default || config.registry || PUBLIC_NPM_REGISTRY
  const explicit = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY

  // Python installers resolve their own project indexes. Exporting a generated
  // UV_DEFAULT_INDEX here would make it look like an explicit owner override.
  const environment = await getRegionalInstallerEnvironment({ ...process.env, ...config.extraEnv }, { python: false })
  const defaults = Object.fromEntries(Object.entries(environment)
    .filter(([key, value]) => value !== process.env[key]))

  return {
    ...config,
    ...(!explicit && new URL(registry).href === PUBLIC_NPM_REGISTRY &&
        await isDownloadMirrorAvailable(CHINA_NPM_REGISTRY) ? {
      registriesByScope: { ...registries, default: CHINA_NPM_REGISTRY }
    } : {}),
    extraEnv: { ...defaults, ...config.extraEnv }
  }
}
