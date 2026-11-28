import { createHash } from 'node:crypto'

import {
  CHINA_BINARY_BASE,
  getDownloadRegion,
  readDownloadCache,
  writeDownloadCache
} from './download-region.js'

const METADATA_TIMEOUT_MS = 2_000
const RELEASE_CACHE_MS = 24 * 60 * 60 * 1_000
const METADATA_RECHECK_MS = 5 * 60 * 1_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const GITHUB_ASSET_PATTERN = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/
const PUBLIC_HF_PATH_PATTERN = /^\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)/
const GITHUB_PROXY_BASE = 'https://gh-proxy.com/'
const RELEASE_REPOSITORIES = new Set([
  'pnpm/pnpm',
  'astral-sh/uv',
  'astral-sh/python-build-standalone',
  'leon-ai/leon-binaries',
  'leon-ai/leon',
  'AlexsJones/llmfit',
  'jqlang/jq',
  'ggml-org/llama.cpp'
])
const releaseRequests = new Map()

async function getReleaseAssets(repository, tag) {
  const key = createHash('sha256').update(`${repository}/${tag}`).digest('hex')
  const cached = await readDownloadCache(key)

  if (cached?.expiresAt > Date.now() && Array.isArray(cached.assets)) {
    return cached.assets
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        redirect: 'error',
        headers: { accept: 'application/vnd.github+json' }
      }
    )

    if (!response.ok) {
      return []
    }

    const release = await response.json()
    const assets = Array.isArray(release.assets) ? release.assets.map((asset) => ({
      url: asset.browser_download_url,
      digest: asset.digest
    })) : []
    await writeDownloadCache(key, { assets, expiresAt: Date.now() + RELEASE_CACHE_MS })

    return assets
  } catch {
    return []
  }
}

async function getReleaseDigest(url, match) {
  const [, repository, tag] = match
  const key = `${repository}/${tag}`

  const existing = releaseRequests.get(key)

  if (!existing || existing.expiresAt <= Date.now()) {
    releaseRequests.set(key, {
      promise: getReleaseAssets(repository, tag),
      expiresAt: Date.now() + METADATA_RECHECK_MS
    })
  }

  const assets = await releaseRequests.get(key).promise
  const digest = assets.find((asset) => {
    try {
      return typeof asset.url === 'string' &&
        decodeURIComponent(asset.url) === decodeURIComponent(url)
    } catch {
      return false
    }
  })?.digest
  const checksum = typeof digest === 'string' && digest.startsWith('sha256:')
    ? digest.slice('sha256:'.length) : ''

  return SHA256_PATTERN.test(checksum) ? checksum : undefined
}

/**
 * Resolve public status and LFS integrity from Hugging Face itself, rather than
 * trusting a mirror to certify its own bytes or learn a private model path.
 */
async function getModelDigest(url, match) {
  const [, repository, revision, filename] = match
  const key = createHash('sha256').update(url).digest('hex')
  const cached = await readDownloadCache(key)

  if (cached?.expiresAt > Date.now() && SHA256_PATTERN.test(cached.sha256)) {
    return cached.sha256
  }

  try {
    const response = await fetch(
      `https://huggingface.co/api/models/${repository}/revision/${revision}?blobs=true`, {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS), redirect: 'error'
      }
    )

    if (!response.ok) {
      return undefined
    }

    const metadata = await response.json()
    const checksum = metadata.private === false && metadata.siblings?.find((file) =>
      file.rfilename === decodeURIComponent(filename))?.lfs?.sha256

    if (typeof checksum !== 'string' || !SHA256_PATTERN.test(checksum)) {
      return undefined
    }

    await writeDownloadCache(key, { sha256: checksum, expiresAt: Date.now() + RELEASE_CACHE_MS })

    return checksum
  } catch {
    return undefined
  }
}

/**
 * Select exact public artifacts only. Release proxies require an independently
 * obtained upstream digest; private, signed and arbitrary URLs stay untouched.
 */
export async function getDownloadSources(fileURL, checksum) {
  const original = { url: fileURL, ...(checksum ? { sha256: checksum } : {}) }
  let url

  try {
    url = new URL(fileURL)
  } catch {
    return [original]
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search ||
      url.hash || await getDownloadRegion() !== 'cn') {
    return [original]
  }

  if (url.origin === 'https://nodejs.org' && url.pathname.startsWith('/dist/')) {
    return [{ ...original, url: `${CHINA_BINARY_BASE}/node/${url.pathname.slice('/dist/'.length)}` }, original]
  }

  const model = url.pathname.match(PUBLIC_HF_PATH_PATTERN)

  if (url.origin === 'https://huggingface.co' && model &&
      !process.env.HF_ENDPOINT && !process.env.HF_TOKEN && !process.env.HUGGING_FACE_HUB_TOKEN) {
    const sha256 = await getModelDigest(fileURL, model)

    if (sha256 && (!checksum || checksum.toLowerCase() === sha256.toLowerCase())) {
      return [{ url: `https://hf-mirror.com${url.pathname}`, sha256 }, { ...original, sha256 }]
    }

    return [original]
  }

  // Astral's canonical delivery host addresses the same public GitHub asset.
  const githubURL = url.origin === 'https://releases.astral.sh' && url.pathname.startsWith('/github/')
    ? `https://github.com/${url.pathname.slice('/github/'.length)}` : fileURL
  const github = new URL(githubURL)
  const match = github.origin === 'https://github.com'
    ? github.pathname.match(GITHUB_ASSET_PATTERN) : null

  if (!match || !RELEASE_REPOSITORIES.has(match[1])) {
    return [original]
  }

  const sha256 = checksum || await getReleaseDigest(githubURL, match)

  if (!sha256 || !SHA256_PATTERN.test(sha256)) {
    return [original]
  }

  const mirror = match[1] === 'astral-sh/python-build-standalone'
    ? `${CHINA_BINARY_BASE}/python-build-standalone/${match[2]}/${match[3]}`
    : `${GITHUB_PROXY_BASE}${githubURL}`

  return [{ url: mirror, sha256 }, { url: fileURL, sha256 }]
}
