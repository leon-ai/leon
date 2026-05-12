import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

import { SystemHelper } from '@/helpers/system-helper'

export interface CommandProbe {
  available: boolean
  version: string
}

export interface DefaultRouteProbe {
  source: string
  route: string
}

export interface NvidiaSmiProbe {
  status: string
  gpus: Array<{
    name: string
    memoryMb: string
    driverVersion: string
  }>
}

export interface StorageSnapshotEntry {
  filesystem: string
  size: string
  used: string
  available: string
  usedPct: string
  mountPoint: string
}

export interface StorageSnapshot {
  source: string
  summary: string
  entries: StorageSnapshotEntry[]
}

type OwnerLocationProbeSource =
  | 'ip_geolocation'
  | 'ip_geolocation_consensus'
  | 'ip_geolocation_timezone_match'
  | 'vpn_timezone_inference'
  | 'timezone_locale_inference'
  | 'timezone_inference'
  | 'unavailable'
type OwnerLocationProbeConfidence = 'high' | 'medium' | 'low'

export interface OwnerLocationProbe {
  value: string
  source: OwnerLocationProbeSource
  confidence: OwnerLocationProbeConfidence
}

export interface VpnProxyProbe {
  behindVpnOrProxy: boolean
  hasProxyEnv: boolean
  tunnelInterfaces: string[]
  defaultRouteInterface: string
  vpnProcesses: string[]
  reasons: string[]
}

export interface NeighborWarmupProbe {
  source: string
  attempted: number
  reachable: number
}

export interface ReverseDnsProbe {
  source: string
  resolvedCount: number
  hostnamesByIp: Record<string, string[]>
}

interface IpGeolocationRecord {
  provider: string
  city: string
  region: string
  country: string
  countryCode: string
  timezone: string
  latitude: number | null
  longitude: number | null
}

export type ProcessCpuMetric = 'percent' | 'seconds'

export interface RunningProcessEntry {
  pid: number
  name: string
  cpu: number
  cpuMetric: ProcessCpuMetric
  memoryMb: number
  runtimeSeconds: number
  startedAt: string
}

export interface RunningProcessSnapshot {
  source: string
  sampledAt: string
  entries: RunningProcessEntry[]
}

export class ContextProbeHelper {
  public getSafeUsername(): string {
    try {
      return os.userInfo().username
    } catch {
      return process.env['USER'] || process.env['USERNAME'] || 'unknown'
    }
  }

  public runCommand(
    command: string,
    args: string[],
    options?: { timeoutMs?: number }
  ): string | null {
    for (const candidate of this.getCommandCandidates(command)) {
      try {
        const output = execFileSync(candidate, args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: options?.timeoutMs ?? 5_000,
          windowsHide: true
        }).trim()

        if (output.length > 0) {
          return output
        }
      } catch {
        continue
      }
    }

    return null
  }

  public probeCommandVersion(command: string, args: string[]): CommandProbe {
    const output = this.runCommand(command, args)
    if (!output) {
      return {
        available: false,
        version: 'unavailable'
      }
    }

    const version =
      output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0) || 'unknown'

    return {
      available: true,
      version
    }
  }

  public formatCommandProbe(commandProbe: CommandProbe): string {
    if (!commandProbe.available) {
      return 'unavailable'
    }

    return `available (${commandProbe.version})`
  }

  public getOperatingSystemNameVersion(): string {
    if (SystemHelper.isLinux()) {
      const linuxReleaseInfo = this.parseLinuxOsRelease()
      if (linuxReleaseInfo.prettyName) {
        return linuxReleaseInfo.prettyName
      }

      if (linuxReleaseInfo.name && linuxReleaseInfo.version) {
        return `${linuxReleaseInfo.name} ${linuxReleaseInfo.version}`
      }

      if (linuxReleaseInfo.name) {
        return linuxReleaseInfo.name
      }

      return `Linux ${os.release()}`
    }

    if (SystemHelper.isMacOS()) {
      const productName = this.runCommand('sw_vers', ['-productName'])
      const productVersion = this.runCommand('sw_vers', ['-productVersion'])

      if (productName && productVersion) {
        return `${productName} ${productVersion}`
      }

      if (productName) {
        return productName
      }

      return `macOS ${os.release()}`
    }

    if (SystemHelper.isWindows()) {
      const rawWindowsInfo = this.runCommand('powershell', [
        '-NoProfile',
        '-Command',
        '(Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption,Version | ConvertTo-Json -Compress)'
      ])

      if (rawWindowsInfo) {
        try {
          const windowsInfo = JSON.parse(rawWindowsInfo) as {
            Caption?: string
            Version?: string
          }
          const caption = windowsInfo.Caption?.trim() || ''
          const version = windowsInfo.Version?.trim() || ''

          if (caption && version && !caption.includes(version)) {
            return `${caption} ${version}`
          }

          if (caption) {
            return caption
          }
        } catch {
          // Ignore parsing failures and fallback below.
        }
      }

      return `Windows ${os.release()}`
    }

    return `${os.type()} ${os.release()}`
  }

  public parseKeyValueFile(content: string): Record<string, string> {
    const output: Record<string, string> = {}

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }

      const separatorIndex = line.indexOf('=')
      if (separatorIndex < 1) {
        continue
      }

      const key = line.slice(0, separatorIndex).trim()
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1')

      if (key) {
        output[key] = value
      }
    }

    return output
  }

  public formatGiB(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return 'unknown'
    }

    return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(2)} GiB`
  }

  public formatUptime(totalSeconds: number): string {
    const safeTotalSeconds = Math.max(0, Math.floor(totalSeconds))
    const days = Math.floor(safeTotalSeconds / 86_400)
    const hours = Math.floor((safeTotalSeconds % 86_400) / 3_600)
    const minutes = Math.floor((safeTotalSeconds % 3_600) / 60)
    const seconds = safeTotalSeconds % 60
    const chunks: string[] = []

    if (days > 0) {
      chunks.push(`${days}d`)
    }

    if (hours > 0 || chunks.length > 0) {
      chunks.push(`${hours}h`)
    }

    chunks.push(`${minutes}m`)
    chunks.push(`${seconds}s`)

    return chunks.join(' ')
  }

  public redactProxyValue(proxyValue: string): string {
    if (!proxyValue || proxyValue === 'unset') {
      return 'unset'
    }

    try {
      const parsedUrl = new URL(proxyValue)
      if (parsedUrl.username || parsedUrl.password) {
        parsedUrl.username = '***'
        parsedUrl.password = '***'
      }
      return parsedUrl.toString()
    } catch {
      const atSymbolIndex = proxyValue.lastIndexOf('@')
      if (atSymbolIndex > 0) {
        return `***@${proxyValue.slice(atSymbolIndex + 1)}`
      }

      return proxyValue
    }
  }

  public isLikelyTunnelInterface(interfaceName: string): boolean {
    const lowerInterfaceName = interfaceName.toLowerCase()

    return (
      lowerInterfaceName.startsWith('tun') ||
      lowerInterfaceName.startsWith('tap') ||
      lowerInterfaceName.startsWith('wg') ||
      lowerInterfaceName.startsWith('ppp') ||
      lowerInterfaceName.startsWith('utun') ||
      lowerInterfaceName.includes('wireguard') ||
      lowerInterfaceName.includes('tailscale') ||
      lowerInterfaceName.includes('vpn')
    )
  }

  public probeDefaultRoute(): DefaultRouteProbe {
    if (SystemHelper.isMacOS()) {
      return this.probeDefaultRouteMacOS()
    }

    if (SystemHelper.isWindows()) {
      return this.probeDefaultRouteWindows()
    }

    return this.probeDefaultRouteLinux()
  }

  public probeNvidiaSmi(): NvidiaSmiProbe {
    try {
      const rawOutput =
        this.runCommand('nvidia-smi', [
          '--query-gpu=name,memory.total,driver_version',
          '--format=csv,noheader,nounits'
        ]) || ''

      if (!rawOutput) {
        return {
          status: 'no_output',
          gpus: []
        }
      }

      const gpus = rawOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name = 'unknown', memoryMb = 'unknown', driverVersion = 'unknown'] =
            line.split(',').map((part) => part.trim())

          return {
            name,
            memoryMb,
            driverVersion
          }
        })

      return {
        status: 'ok',
        gpus
      }
    } catch {
      return {
        status: 'unavailable',
        gpus: []
      }
    }
  }

  public probeStorage(): StorageSnapshot {
    if (SystemHelper.isWindows()) {
      return this.probeStorageWindows()
    }

    return this.probeStorageUnix()
  }

  public probeOwnerLocation(options: {
    timeZone?: string
    locale?: string
  }): OwnerLocationProbe {
    const timeZone = (options.timeZone || '').trim()
    const locale = (options.locale || '').trim()
    const vpnProxyStatus = this.probeVpnOrProxyStatus()

    if (vpnProxyStatus.behindVpnOrProxy) {
      const cityFromTimeZone = this.extractCityFromTimeZone(timeZone)

      if (cityFromTimeZone) {
        return {
          value: `${cityFromTimeZone} (inferred from ${timeZone}; VPN/proxy detected)`,
          source: 'vpn_timezone_inference',
          confidence: 'medium'
        }
      }

      return {
        value: 'unknown (VPN/proxy detected)',
        source: 'vpn_timezone_inference',
        confidence: 'low'
      }
    }

    const ipGeolocationProbe = this.probeOwnerLocationFromIpGeolocation(
      timeZone,
      locale
    )
    if (ipGeolocationProbe) {
      return ipGeolocationProbe
    }

    const cityFromTimeZone = this.extractCityFromTimeZone(timeZone)
    const regionFromLocale = this.extractRegionFromLocale(locale)

    if (cityFromTimeZone && regionFromLocale) {
      return {
        value: `${cityFromTimeZone}, ${regionFromLocale} (inferred from ${timeZone})`,
        source: 'timezone_locale_inference',
        confidence: 'medium'
      }
    }

    if (cityFromTimeZone) {
      return {
        value: `${cityFromTimeZone} (inferred from ${timeZone})`,
        source: 'timezone_inference',
        confidence: 'low'
      }
    }

    return {
      value: 'unknown',
      source: 'unavailable',
      confidence: 'low'
    }
  }

  public probeVpnOrProxyStatus(): VpnProxyProbe {
    const interfaces = os.networkInterfaces()
    const tunnelInterfaces = Object.keys(interfaces).filter((interfaceName) =>
      this.isLikelyTunnelInterface(interfaceName)
    )
    const proxyValues = [
      process.env['HTTP_PROXY'] || process.env['http_proxy'] || '',
      process.env['HTTPS_PROXY'] || process.env['https_proxy'] || ''
    ].filter((value) => value.trim().length > 0)
    const hasProxyEnv = proxyValues.length > 0

    const defaultRouteProbe = this.probeDefaultRoute()
    const defaultRouteInterfaceMatch = defaultRouteProbe.route.match(
      /\binterface\s+([^\s|]+)/
    )
    const defaultRouteInterface = defaultRouteInterfaceMatch?.[1] || 'unknown'
    const hasTunnelDefaultRoute =
      defaultRouteInterface !== 'unknown' &&
      this.isLikelyTunnelInterface(defaultRouteInterface)

    const runningProcesses = this.probeRunningProcesses(120)
    const vpnKeywords = [
      'openvpn',
      'wireguard',
      'wg-quick',
      'tailscale',
      'tailscaled',
      'nordvpn',
      'expressvpn',
      'protonvpn',
      'surfshark',
      'clash',
      'v2ray',
      'sing-box',
      'tunnelblick',
      'zerotier'
    ]
    const vpnProcesses = [...new Set(
      runningProcesses.entries
        .map((entry) => entry.name.toLowerCase())
        .filter((name) => vpnKeywords.some((keyword) => name.includes(keyword)))
    )]

    const reasons: string[] = []
    if (hasProxyEnv) {
      reasons.push('proxy_env')
    }
    if (tunnelInterfaces.length > 0) {
      reasons.push('tunnel_interface')
    }
    if (hasTunnelDefaultRoute) {
      reasons.push('tunnel_default_route')
    }
    if (vpnProcesses.length > 0) {
      reasons.push('vpn_process')
    }

    return {
      behindVpnOrProxy: reasons.length > 0,
      hasProxyEnv,
      tunnelInterfaces,
      defaultRouteInterface,
      vpnProcesses,
      reasons
    }
  }

  public warmNeighborCache(ipAddresses: string[]): NeighborWarmupProbe {
    if (ipAddresses.length === 0) {
      return {
        source: 'ping_warmup',
        attempted: 0,
        reachable: 0
      }
    }

    const uniqueIps = [...new Set(ipAddresses)].slice(0, 320)
    const nodeScript = `
import { execFile } from 'node:child_process'

const [rawIps = '[]'] = process.argv.slice(1)

const ips = (() => {
  try {
    const parsed = JSON.parse(rawIps)
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === 'string' && entry.length > 0)
      : []
  } catch {
    return []
  }
})()

const platform = process.platform
const concurrency = 24

const pingArgs = (ip) => {
  if (platform === 'win32') {
    return ['-n', '1', '-w', '300', ip]
  }

  if (platform === 'darwin') {
    return ['-c', '1', '-W', '1000', ip]
  }

  return ['-c', '1', '-W', '1', ip]
}

const pingIp = (ip) =>
  new Promise((resolve) => {
    execFile('ping', pingArgs(ip), { timeout: 1400, windowsHide: true }, (error) => {
      resolve(!error)
    })
  })

let reachable = 0
let index = 0

const worker = async () => {
  while (index < ips.length) {
    const currentIndex = index
    index += 1
    const ip = ips[currentIndex]
    const ok = await pingIp(ip)
    if (ok) {
      reachable += 1
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, () => worker()))
console.log(JSON.stringify({ attempted: ips.length, reachable }))
    `.trim()

    const rawOutput = this.runCommand(
      process.execPath,
      ['--no-warnings', '--input-type=module', '-e', nodeScript, JSON.stringify(uniqueIps)],
      { timeoutMs: 15_000 }
    )

    if (!rawOutput) {
      return {
        source: 'ping_warmup_unavailable',
        attempted: uniqueIps.length,
        reachable: 0
      }
    }

    try {
      const parsed = JSON.parse(rawOutput) as {
        attempted?: number
        reachable?: number
      }

      return {
        source: 'ping_warmup',
        attempted: Number(parsed.attempted || uniqueIps.length),
        reachable: Number(parsed.reachable || 0)
      }
    } catch {
      return {
        source: 'ping_warmup_unavailable',
        attempted: uniqueIps.length,
        reachable: 0
      }
    }
  }

  public probeReverseDnsHostnames(ipAddresses: string[]): ReverseDnsProbe {
    const uniqueIps = [...new Set(ipAddresses)].filter((ip) => ip.length > 0).slice(0, 96)
    if (uniqueIps.length === 0) {
      return {
        source: 'reverse_dns',
        resolvedCount: 0,
        hostnamesByIp: {}
      }
    }

    const nodeScript = `
import dns from 'node:dns/promises'

const [rawIps = '[]'] = process.argv.slice(1)
const ips = (() => {
  try {
    const parsed = JSON.parse(rawIps)
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === 'string' && entry.length > 0)
      : []
  } catch {
    return []
  }
})()

const timeoutMs = 850
const concurrency = 16

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve([]), ms))])

let cursor = 0
const results = {}

const worker = async () => {
  while (cursor < ips.length) {
    const index = cursor
    cursor += 1
    const ip = ips[index]
    try {
      const rows = await withTimeout(dns.reverse(ip), timeoutMs)
      const names = Array.isArray(rows)
        ? [...new Set(
            rows
              .filter((row) => typeof row === 'string' && row.length > 0)
              .map((row) => {
                const normalized = row.trim().toLowerCase()
                return normalized.endsWith('.') ? normalized.slice(0, -1) : normalized
              })
          )].slice(0, 4)
        : []

      if (names.length > 0) {
        results[ip] = names
      }
    } catch {
      continue
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, () => worker()))
console.log(JSON.stringify(results))
    `.trim()

    const rawOutput = this.runCommand(
      process.execPath,
      ['--no-warnings', '--input-type=module', '-e', nodeScript, JSON.stringify(uniqueIps)],
      { timeoutMs: 14_000 }
    )

    if (!rawOutput) {
      return {
        source: 'reverse_dns_unavailable',
        resolvedCount: 0,
        hostnamesByIp: {}
      }
    }

    try {
      const parsed = JSON.parse(rawOutput) as Record<string, unknown>
      const hostnamesByIp: Record<string, string[]> = {}
      let resolvedCount = 0

      for (const [ip, rawNames] of Object.entries(parsed || {})) {
        if (!uniqueIps.includes(ip)) {
          continue
        }

        if (!Array.isArray(rawNames)) {
          continue
        }

        const names = rawNames
          .filter((name) => typeof name === 'string')
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
          .slice(0, 4)

        if (names.length === 0) {
          continue
        }

        hostnamesByIp[ip] = names
        resolvedCount += 1
      }

      return {
        source: 'reverse_dns',
        resolvedCount,
        hostnamesByIp
      }
    } catch {
      return {
        source: 'reverse_dns_unavailable',
        resolvedCount: 0,
        hostnamesByIp: {}
      }
    }
  }
  public probeRunningProcesses(limit = 80): RunningProcessSnapshot {
    if (SystemHelper.isWindows()) {
      return this.probeRunningProcessesWindows(limit)
    }

    return this.probeRunningProcessesUnix(limit)
  }

  private getCommandCandidates(command: string): string[] {
    if (!SystemHelper.isWindows() || /[\\/]/.test(command)) {
      return [command]
    }

    return [...new Set([`${command}.cmd`, `${command}.exe`, command])]
  }

  private parseLinuxOsRelease(): {
    prettyName: string
    name: string
    version: string
  } {
    const osReleasePath = '/etc/os-release'
    if (!fs.existsSync(osReleasePath)) {
      return {
        prettyName: '',
        name: '',
        version: ''
      }
    }

    try {
      const osReleaseRaw = fs.readFileSync(osReleasePath, 'utf8')
      const parsedValues = this.parseKeyValueFile(osReleaseRaw)

      return {
        prettyName: parsedValues['PRETTY_NAME'] || '',
        name: parsedValues['NAME'] || '',
        version: parsedValues['VERSION'] || parsedValues['VERSION_ID'] || ''
      }
    } catch {
      return {
        prettyName: '',
        name: '',
        version: ''
      }
    }
  }

  private extractCityFromTimeZone(timeZone: string): string {
    if (!timeZone || !timeZone.includes('/')) {
      return ''
    }

    const segments = timeZone.split('/').filter((segment) => segment.length > 0)
    if (segments.length === 0) {
      return ''
    }

    const city = segments[segments.length - 1] || ''
    return city.replace(/_/g, ' ').trim()
  }

  private extractRegionFromLocale(locale: string): string {
    if (!locale) {
      return ''
    }

    const matched = locale.match(/[-_]([A-Z]{2}|\d{3})\b/)
    if (!matched || !matched[1]) {
      return ''
    }

    return matched[1]
  }

  private probeOwnerLocationFromIpGeolocation(
    currentTimeZone: string,
    locale: string
  ): OwnerLocationProbe | null {
    const geolocationRecords = this.fetchIpGeolocationRecords()
    if (geolocationRecords.length === 0) {
      return null
    }

    const localeCountryCode = this.extractRegionFromLocale(locale).toUpperCase()
    const groupedByLocation = new Map<
      string,
      {
        records: IpGeolocationRecord[]
        timezoneMatches: number
        localeMatches: number
      }
    >()

    for (const record of geolocationRecords) {
      const key = `${record.city}|${record.region}|${record.countryCode}`.toLowerCase()
      const existing = groupedByLocation.get(key)
      const hasTimezoneMatch =
        currentTimeZone.length > 0 &&
        record.timezone.length > 0 &&
        record.timezone === currentTimeZone
      const hasLocaleCountryMatch =
        localeCountryCode.length > 0 &&
        record.countryCode.length > 0 &&
        localeCountryCode === record.countryCode.toUpperCase()

      if (!existing) {
        groupedByLocation.set(key, {
          records: [record],
          timezoneMatches: hasTimezoneMatch ? 1 : 0,
          localeMatches: hasLocaleCountryMatch ? 1 : 0
        })
        continue
      }

      existing.records.push(record)
      existing.timezoneMatches += hasTimezoneMatch ? 1 : 0
      existing.localeMatches += hasLocaleCountryMatch ? 1 : 0
    }

    const bestGroup = [...groupedByLocation.values()].sort((entryA, entryB) => {
      if (entryA.records.length !== entryB.records.length) {
        return entryB.records.length - entryA.records.length
      }

      if (entryA.timezoneMatches !== entryB.timezoneMatches) {
        return entryB.timezoneMatches - entryA.timezoneMatches
      }

      return entryB.localeMatches - entryA.localeMatches
    })[0]

    if (!bestGroup || bestGroup.records.length === 0) {
      return null
    }

    const representativeRecord =
      bestGroup.records.find(
        (record) =>
          record.timezone.length > 0 && record.timezone === currentTimeZone
      ) ||
      bestGroup.records.find(
        (record) => record.latitude !== null && record.longitude !== null
      ) ||
      bestGroup.records[0]

    if (!representativeRecord) {
      return null
    }

    const hasTimezoneMatch = bestGroup.timezoneMatches > 0
    const hasLocaleMatch = bestGroup.localeMatches > 0
    const hasConsensus = bestGroup.records.length >= 2
    const coordinates =
      representativeRecord.latitude !== null && representativeRecord.longitude !== null
        ? ` (~${representativeRecord.latitude.toFixed(2)}, ${representativeRecord.longitude.toFixed(2)})`
        : ''
    const locationValue = representativeRecord.region
      ? `${representativeRecord.city}, ${representativeRecord.region}, ${representativeRecord.country}`
      : `${representativeRecord.city}, ${representativeRecord.country}`
    const matchSegments = [
      hasConsensus
        ? `provider consensus ${bestGroup.records.length}/${geolocationRecords.length}`
        : '',
      hasTimezoneMatch ? 'timezone match' : '',
      hasLocaleMatch ? 'locale match' : ''
    ].filter((segment) => segment.length > 0)
    const matchSuffix =
      matchSegments.length > 0 ? ` (${matchSegments.join(', ')})` : ''

    let confidence: OwnerLocationProbeConfidence = 'low'
    if (hasTimezoneMatch && hasConsensus) {
      confidence = 'high'
    } else if (hasTimezoneMatch || hasConsensus || hasLocaleMatch) {
      confidence = 'medium'
    }

    let source: OwnerLocationProbeSource = 'ip_geolocation'
    if (hasTimezoneMatch) {
      source = 'ip_geolocation_timezone_match'
    } else if (hasConsensus) {
      source = 'ip_geolocation_consensus'
    }

    return {
      value: `${locationValue}${coordinates} (inferred from IP geolocation${matchSuffix})`,
      source,
      confidence
    }
  }

  private fetchIpGeolocationRecords(): IpGeolocationRecord[] {
    const nodeScript = `
const timeoutMs = 2000
const endpoints = [
  { provider: 'ipapi', url: 'https://ipapi.co/json/' },
  { provider: 'ipwhois', url: 'https://ipwho.is/' },
  { provider: 'ipinfo', url: 'https://ipinfo.io/json' }
]

const withTimeout = async (url) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Leon/1.0 (+https://getleon.ai)'
      }
    })
    if (!response.ok) {
      return null
    }
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

const normalizeRecord = (provider, payload) => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const toNumberOrNull = (value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  if (provider === 'ipapi') {
    const city = String(payload.city || '').trim()
    const country = String(payload.country_name || payload.country || '').trim()
    if (!city || !country) {
      return null
    }

    return {
      provider,
      city,
      region: String(payload.region || '').trim(),
      country,
      countryCode: String(payload.country_code || payload.country || '').trim(),
      timezone: String(payload.timezone || '').trim(),
      latitude: toNumberOrNull(payload.latitude),
      longitude: toNumberOrNull(payload.longitude)
    }
  }

  if (provider === 'ipwhois') {
    if (payload.success === false) {
      return null
    }

    const city = String(payload.city || '').trim()
    const country = String(payload.country || '').trim()
    if (!city || !country) {
      return null
    }

    const timezone =
      typeof payload.timezone === 'object' && payload.timezone
        ? String(payload.timezone.id || '').trim()
        : ''

    return {
      provider,
      city,
      region: String(payload.region || '').trim(),
      country,
      countryCode: String(payload.country_code || '').trim(),
      timezone,
      latitude: toNumberOrNull(payload.latitude),
      longitude: toNumberOrNull(payload.longitude)
    }
  }

  if (provider === 'ipinfo') {
    const city = String(payload.city || '').trim()
    const countryCode = String(payload.country || '').trim()
    if (!city || !countryCode) {
      return null
    }

    const locParts = String(payload.loc || '')
      .split(',')
      .map((entry) => entry.trim())

    return {
      provider,
      city,
      region: String(payload.region || '').trim(),
      country: countryCode,
      countryCode,
      timezone: String(payload.timezone || '').trim(),
      latitude: toNumberOrNull(locParts[0]),
      longitude: toNumberOrNull(locParts[1])
    }
  }

  return null
}

const results = []
for (const endpoint of endpoints) {
  const payload = await withTimeout(endpoint.url)
  const record = normalizeRecord(endpoint.provider, payload)
  if (record) {
    results.push(record)
  }
}

console.log(JSON.stringify(results))
    `.trim()

    const rawOutput = this.runCommand(process.execPath, [
      '--no-warnings',
      '--input-type=module',
      '-e',
      nodeScript
    ])

    if (!rawOutput) {
      return []
    }

    try {
      const parsed = JSON.parse(rawOutput) as IpGeolocationRecord[]
      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed.filter((record) => {
        return (
          !!record &&
          typeof record.provider === 'string' &&
          record.provider.length > 0 &&
          typeof record.city === 'string' &&
          record.city.length > 0 &&
          typeof record.country === 'string' &&
          record.country.length > 0 &&
          typeof record.countryCode === 'string'
        )
      })
    } catch {
      return []
    }
  }

  private probeDefaultRouteLinux(): DefaultRouteProbe {
    const ipRouteOutput = this.runCommand('ip', ['route', 'show', 'default'])
    if (ipRouteOutput) {
      const firstLine = ipRouteOutput
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0)

      if (firstLine) {
        const gateway = firstLine.match(/\bvia\s+([^\s]+)/)?.[1] || 'unknown'
        const networkInterface =
          firstLine.match(/\bdev\s+([^\s]+)/)?.[1] || 'unknown'
        const metric = firstLine.match(/\bmetric\s+([^\s]+)/)?.[1]

        return {
          source: 'ip route show default',
          route: `gateway ${gateway} | interface ${networkInterface}${metric ? ` | metric ${metric}` : ''}`
        }
      }
    }

    const routeOutput = this.runCommand('route', ['-n'])
    if (routeOutput) {
      const routeLine = routeOutput
        .split('\n')
        .map((line) => line.trim())
        .find(
          (line) => line.startsWith('0.0.0.0') || line.startsWith('default')
        )

      if (routeLine) {
        const normalizedParts = routeLine.replace(/\s+/g, ' ').split(' ')

        return {
          source: 'route -n',
          route: `gateway ${normalizedParts[1] || 'unknown'} | interface ${
            normalizedParts.at(-1) || 'unknown'
          }`
        }
      }
    }

    return {
      source: 'unavailable',
      route: 'unknown'
    }
  }

  private probeDefaultRouteMacOS(): DefaultRouteProbe {
    const routeOutput = this.runCommand('route', ['-n', 'get', 'default'])
    if (!routeOutput) {
      return {
        source: 'unavailable',
        route: 'unknown'
      }
    }

    const gateway = this.extractPrefixedLineValue(routeOutput, 'gateway:')
    const networkInterface = this.extractPrefixedLineValue(
      routeOutput,
      'interface:'
    )

    return {
      source: 'route -n get default',
      route: `gateway ${gateway || 'unknown'} | interface ${
        networkInterface || 'unknown'
      }`
    }
  }

  private probeDefaultRouteWindows(): DefaultRouteProbe {
    const powershellOutput = this.runCommand('powershell', [
      '-NoProfile',
      '-Command',
      'Get-NetRoute -DestinationPrefix \'0.0.0.0/0\' | Sort-Object RouteMetric | Select-Object -First 1 -Property NextHop,InterfaceAlias,RouteMetric | ConvertTo-Json -Compress'
    ])

    if (powershellOutput) {
      try {
        const routeData = JSON.parse(powershellOutput) as {
          NextHop?: string
          InterfaceAlias?: string
          RouteMetric?: number | string
        }

        return {
          source: 'powershell Get-NetRoute',
          route: `gateway ${routeData.NextHop || 'unknown'} | interface ${
            routeData.InterfaceAlias || 'unknown'
          }${
            routeData.RouteMetric !== undefined
              ? ` | metric ${routeData.RouteMetric}`
              : ''
          }`
        }
      } catch {
        // Ignore parsing failures and fallback below.
      }
    }

    return {
      source: 'unavailable',
      route: 'unknown'
    }
  }

  private extractPrefixedLineValue(
    content: string,
    linePrefix: string
  ): string | null {
    const normalizedPrefix = linePrefix.toLowerCase()
    const line = content
      .split('\n')
      .map((lineContent) => lineContent.trim())
      .find((lineContent) =>
        lineContent.toLowerCase().startsWith(normalizedPrefix)
      )

    if (!line) {
      return null
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      return null
    }

    const value = line.slice(separatorIndex + 1).trim()
    return value || null
  }

  private probeStorageUnix(): StorageSnapshot {
    try {
      const rawOutput = this.runCommand('df', ['-hP']) || ''

      const rows = rawOutput
        .split('\n')
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/\s+/g, ' ').split(' '))
        .filter((parts) => parts.length >= 6)
        .map((parts) => ({
          filesystem: parts[0] || 'unknown',
          size: parts[1] || 'unknown',
          used: parts[2] || 'unknown',
          available: parts[3] || 'unknown',
          usedPct: parts[4] || 'unknown',
          mountPoint: parts.slice(5).join(' ') || 'unknown'
        }))

      const targetRow =
        rows.find((row) => row.mountPoint === os.homedir()) ||
        rows.find((row) => row.mountPoint === '/home') ||
        rows.find((row) => row.mountPoint === '/') ||
        rows[0]

      const summary = targetRow
        ? `Storage snapshot shows ${targetRow.available} free on ${targetRow.mountPoint}.`
        : 'Storage snapshot unavailable.'

      return {
        source: 'df -hP',
        summary,
        entries: rows.slice(0, 12)
      }
    } catch {
      return {
        source: 'df -hP (failed)',
        summary: 'Storage snapshot unavailable.',
        entries: []
      }
    }
  }

  private probeStorageWindows(): StorageSnapshot {
    try {
      const rawOutput =
        this.runCommand('powershell', [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress'
        ]) || ''

      if (!rawOutput) {
        return {
          source: 'powershell Get-CimInstance Win32_LogicalDisk',
          summary: 'Storage snapshot unavailable.',
          entries: []
        }
      }

      const parsedData = JSON.parse(rawOutput) as
        | {
            DeviceID?: string
            FileSystem?: string
            Size?: number | string
            FreeSpace?: number | string
          }
        | Array<{
            DeviceID?: string
            FileSystem?: string
            Size?: number | string
            FreeSpace?: number | string
          }>
      const storageRows = Array.isArray(parsedData) ? parsedData : [parsedData]

      const entries: StorageSnapshotEntry[] = storageRows.map((row) => {
        const sizeBytes = Number(row.Size || 0)
        const freeBytes = Number(row.FreeSpace || 0)
        const usedBytes = Math.max(sizeBytes - freeBytes, 0)
        const usedPct =
          sizeBytes > 0 ? `${((usedBytes / sizeBytes) * 100).toFixed(0)}%` : '0%'

        return {
          filesystem: row.FileSystem || 'local-disk',
          size: this.formatGiB(sizeBytes),
          used: this.formatGiB(usedBytes),
          available: this.formatGiB(freeBytes),
          usedPct,
          mountPoint: row.DeviceID || 'unknown'
        }
      })

      const normalizedHomeDirectory = os
        .homedir()
        .slice(0, 2)
        .toUpperCase()
      const targetRow =
        entries.find((row) =>
          row.mountPoint.toUpperCase().startsWith(normalizedHomeDirectory)
        ) || entries[0]

      return {
        source: 'powershell Get-CimInstance Win32_LogicalDisk',
        summary: targetRow
          ? `Storage snapshot shows ${targetRow.available} free on ${targetRow.mountPoint}.`
          : 'Storage snapshot unavailable.',
        entries: entries.slice(0, 12)
      }
    } catch {
      return {
        source: 'powershell Get-CimInstance Win32_LogicalDisk (failed)',
        summary: 'Storage snapshot unavailable.',
        entries: []
      }
    }
  }

  private probeRunningProcessesUnix(limit: number): RunningProcessSnapshot {
    const commandPlans: Array<{
      args: string[]
      source: string
      elapsedMode: 'seconds' | 'duration'
    }> = [
      {
        args: ['-eo', 'pid=,comm=,%cpu=,rss=,etimes='],
        source: 'ps -eo pid=,comm=,%cpu=,rss=,etimes=',
        elapsedMode: 'seconds'
      },
      {
        args: ['-A', '-o', 'pid=,comm=,%cpu=,rss=,etime='],
        source: 'ps -A -o pid=,comm=,%cpu=,rss=,etime=',
        elapsedMode: 'duration'
      }
    ]

    for (const commandPlan of commandPlans) {
      const rawOutput = this.runCommand('ps', commandPlan.args)
      if (!rawOutput) {
        continue
      }

      const entries = rawOutput
        .split('\n')
        .map((line) =>
          this.parseUnixProcessLine(line, commandPlan.elapsedMode)
        )
        .filter((entry): entry is RunningProcessEntry => Boolean(entry))
        .sort((entryA, entryB) => {
          if (entryA.cpu !== entryB.cpu) {
            return entryB.cpu - entryA.cpu
          }

          if (entryA.memoryMb !== entryB.memoryMb) {
            return entryB.memoryMb - entryA.memoryMb
          }

          return entryB.runtimeSeconds - entryA.runtimeSeconds
        })
        .slice(0, Math.max(1, limit))

      if (entries.length > 0) {
        return {
          source: commandPlan.source,
          sampledAt: new Date().toISOString(),
          entries
        }
      }
    }

    return {
      source: 'ps unavailable',
      sampledAt: new Date().toISOString(),
      entries: []
    }
  }

  private probeRunningProcessesWindows(limit: number): RunningProcessSnapshot {
    const powershellScript = `
$now = Get-Date
Get-Process | ForEach-Object {
  $startTimeIso = ''
  $runtimeSeconds = 0

  try {
    $startTime = $_.StartTime
    $startTimeIso = $startTime.ToUniversalTime().ToString('o')
    $runtimeSeconds = [int]($now - $startTime).TotalSeconds
  } catch {
    $startTimeIso = ''
    $runtimeSeconds = 0
  }

  [PSCustomObject]@{
    pid = $_.Id
    name = $_.ProcessName
    cpuSeconds = [double]($_.CPU -as [double])
    memoryBytes = [double]($_.WorkingSet64)
    startedAt = $startTimeIso
    runtimeSeconds = $runtimeSeconds
  }
} | Sort-Object cpuSeconds -Descending | Select-Object -First ${Math.max(1, limit)} | ConvertTo-Json -Compress
    `.trim()

    const rawOutput = this.runCommand('powershell', [
      '-NoProfile',
      '-Command',
      powershellScript
    ])

    if (!rawOutput) {
      return {
        source: 'powershell Get-Process unavailable',
        sampledAt: new Date().toISOString(),
        entries: []
      }
    }

    try {
      const parsedValue = JSON.parse(rawOutput) as
        | {
            pid?: number
            name?: string
            cpuSeconds?: number
            memoryBytes?: number
            startedAt?: string
            runtimeSeconds?: number
          }
        | Array<{
            pid?: number
            name?: string
            cpuSeconds?: number
            memoryBytes?: number
            startedAt?: string
            runtimeSeconds?: number
          }>

      const rows = Array.isArray(parsedValue) ? parsedValue : [parsedValue]
      const entries = rows
        .map((row) => {
          const pid = Number(row.pid)
          const name = (row.name || '').trim()
          const cpuSeconds = Number(row.cpuSeconds || 0)
          const memoryBytes = Number(row.memoryBytes || 0)
          const runtimeSeconds = Math.max(0, Number(row.runtimeSeconds || 0))

          if (!Number.isFinite(pid) || !name) {
            return null
          }

          const entry: RunningProcessEntry = {
            pid,
            name,
            cpu: Number.isFinite(cpuSeconds) ? cpuSeconds : 0,
            cpuMetric: 'seconds',
            memoryMb: Number.isFinite(memoryBytes)
              ? Number((memoryBytes / (1_024 * 1_024)).toFixed(1))
              : 0,
            runtimeSeconds,
            startedAt: row.startedAt || this.formatStartedAt(runtimeSeconds)
          }

          return entry
        })
        .filter(this.isRunningProcessEntry)
        .sort((entryA, entryB) => {
          if (entryA.cpu !== entryB.cpu) {
            return entryB.cpu - entryA.cpu
          }

          if (entryA.memoryMb !== entryB.memoryMb) {
            return entryB.memoryMb - entryA.memoryMb
          }

          return entryB.runtimeSeconds - entryA.runtimeSeconds
        })
        .slice(0, Math.max(1, limit))

      return {
        source: 'powershell Get-Process',
        sampledAt: new Date().toISOString(),
        entries
      }
    } catch {
      return {
        source: 'powershell Get-Process (parse failed)',
        sampledAt: new Date().toISOString(),
        entries: []
      }
    }
  }

  private parseUnixProcessLine(
    line: string,
    elapsedMode: 'seconds' | 'duration'
  ): RunningProcessEntry | null {
    const normalizedLine = line.trim().replace(/\s+/g, ' ')
    if (!normalizedLine) {
      return null
    }

    const matchedLine = normalizedLine.match(
      /^(\d+)\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(\d+)\s+(\S+)$/
    )
    if (!matchedLine) {
      return null
    }

    const pid = Number(matchedLine[1] || 0)
    const name = matchedLine[2] || ''
    const cpuPercent = Number(matchedLine[3] || 0)
    const rssKb = Number(matchedLine[4] || 0)
    const elapsedValue = matchedLine[5] || '0'
    const runtimeSeconds =
      elapsedMode === 'seconds'
        ? Number(elapsedValue || 0)
        : this.parseElapsedDuration(elapsedValue)

    if (!Number.isFinite(pid) || !name) {
      return null
    }

    return {
      pid,
      name,
      cpu: Number.isFinite(cpuPercent) ? Number(cpuPercent.toFixed(1)) : 0,
      cpuMetric: 'percent',
      memoryMb: Number.isFinite(rssKb) ? Number((rssKb / 1_024).toFixed(1)) : 0,
      runtimeSeconds: Number.isFinite(runtimeSeconds)
        ? Math.max(0, Math.floor(runtimeSeconds))
        : 0,
      startedAt: this.formatStartedAt(runtimeSeconds)
    }
  }

  private parseElapsedDuration(duration: string): number {
    const trimmedDuration = duration.trim()
    if (!trimmedDuration) {
      return 0
    }

    let days = 0
    let timePart = trimmedDuration

    if (trimmedDuration.includes('-')) {
      const [dayPart = '0', rawTimePart = '0:00:00'] = trimmedDuration.split('-')
      days = Number(dayPart || 0)
      timePart = rawTimePart
    }

    const chunks = timePart
      .split(':')
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))

    if (chunks.length === 0) {
      return 0
    }

    if (chunks.length === 1) {
      const [seconds = 0] = chunks
      return days * 86_400 + seconds
    }

    if (chunks.length === 2) {
      const [minutes = 0, seconds = 0] = chunks
      return days * 86_400 + minutes * 60 + seconds
    }

    const [hours = 0, minutes = 0, seconds = 0] = chunks.slice(-3)
    return days * 86_400 + hours * 3_600 + minutes * 60 + seconds
  }

  private formatStartedAt(runtimeSeconds: number): string {
    if (!Number.isFinite(runtimeSeconds) || runtimeSeconds <= 0) {
      return 'unknown'
    }

    return new Date(Date.now() - runtimeSeconds * 1_000).toISOString()
  }

  private isRunningProcessEntry(
    entry: RunningProcessEntry | null
  ): entry is RunningProcessEntry {
    return Boolean(entry)
  }
}
