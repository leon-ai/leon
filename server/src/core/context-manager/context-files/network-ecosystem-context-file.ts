import os from 'node:os'
import dns from 'node:dns'

import { DateHelper } from '@/helpers/date-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { ContextStateStore, normalizeSampleTime } from '@/core/context-manager/context-state-store'

interface DiscoveredNeighbor {
  ip: string
  mac: string
  networkInterface: string
  state: string
  resolvedNames: string[]
}

interface EcosystemDeviceState {
  firstSeenAt: string
  lastSeenAt: string
  seenCount: number
  mac: string
  networkInterface: string
  resolvedNames: string[]
  identifier: string
  hint: string
}

interface LocalEcosystemState {
  trackingStartedAt: string
  lastSampleAt: string
  devices: Record<string, EcosystemDeviceState>
}

const FALLBACK_STATE: LocalEcosystemState = {
  trackingStartedAt: '',
  lastSampleAt: '',
  devices: {}
}

const MAX_NEIGHBORS = 40
const MAX_DEVICE_STATE = 1000
const MAX_SERVICE_LINES = 18
const MAX_ACTIVE_SCAN_TARGETS = 320
const PREFERRED_SUBNET_PREFIX = '192.168.0'
const PREFERRED_SUBNET_MAX_HOST = 254

export class NetworkEcosystemContextFile extends ContextFile {
  public readonly filename = 'NETWORK_ECOSYSTEM.md'
  public readonly ttlMs: number

  private readonly stateStore = new ContextStateStore<LocalEcosystemState>(
    '.local-ecosystem-state.json',
    FALLBACK_STATE
  )

  public constructor(
    private readonly probeHelper: ContextProbeHelper,
    ttlMs: number
  ) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const now = new Date()
    const nowIso = now.toISOString()
    const interfaces = os.networkInterfaces()
    const hasPreferredSubnet = this.hasPreferredSubnetInterface(interfaces)
    const networkInterfaceLines = this.buildNetworkInterfaceLines(interfaces)
    const activeProbeTargets = this.buildActiveProbeTargets(
      interfaces,
      hasPreferredSubnet
    )
    const activeProbe = this.probeHelper.warmNeighborCache(activeProbeTargets)
    const defaultRoute = this.probeHelper.probeDefaultRoute()
    const dnsResolvers = dns.getServers()
    const proxyEnv = {
      http: this.probeHelper.redactProxyValue(
        process.env['HTTP_PROXY'] || process.env['http_proxy'] || 'unset'
      ),
      https: this.probeHelper.redactProxyValue(
        process.env['HTTPS_PROXY'] || process.env['https_proxy'] || 'unset'
      ),
      noProxy: this.probeHelper.redactProxyValue(
        process.env['NO_PROXY'] || process.env['no_proxy'] || 'unset'
      )
    }
    const vpnProxyStatus = this.probeHelper.probeVpnOrProxyStatus()
    const neighbors = this.probeNeighbors().filter((neighbor) =>
      this.shouldKeepNeighbor(neighbor.ip, hasPreferredSubnet)
    )
    const reverseDnsProbe = this.probeHelper.probeReverseDnsHostnames(
      neighbors.map((neighbor) => neighbor.ip)
    )
    const enrichedNeighbors = neighbors.map((neighbor) => ({
      ...neighbor,
      resolvedNames: reverseDnsProbe.hostnamesByIp[neighbor.ip] || []
    }))

    const currentState = this.normalizeState(this.stateStore.load(), nowIso)
    const updatedState = this.updateState(currentState, enrichedNeighbors, nowIso)
    this.stateStore.save(updatedState)

    const rankedDevices = this.getRankedDevices(updatedState.devices)
    const inferredServices = this.buildServiceSignals(enrichedNeighbors)

    const summary = `Local ecosystem sees ${neighbors.length} local network device(s), ${reverseDnsProbe.resolvedCount} reverse-DNS identified device(s), ${inferredServices.length} inferred service signal(s), and ${networkInterfaceLines.length} active network address entry(ies), with ${activeProbe.reachable}/${activeProbe.attempted} active-probe responses.`

    const neighborLines =
      rankedDevices.length > 0
        ? rankedDevices.slice(0, MAX_NEIGHBORS).map((device, index) => {
            return `- ${index + 1}. ${device.ip} | identifier ${device.identifier} | names ${device.resolvedNames.join(', ') || 'none'} | MAC ${device.mac} | interface ${device.networkInterface} | hint ${device.hint} | first seen ${DateHelper.getDateTime(device.firstSeenAt) || device.firstSeenAt} | last seen ${DateHelper.getDateTime(device.lastSeenAt) || device.lastSeenAt} | seen ${device.seenCount} time(s)`
          })
        : ['- No local neighbors detected']

    const serviceLines =
      inferredServices.length > 0
        ? inferredServices.slice(0, MAX_SERVICE_LINES).map((service, index) => {
            return `- ${index + 1}. ${service}`
          })
        : ['- No strong home-service signal detected yet']

    return [
      `> Environment, interfaces, discovered devices, inferred services. ${summary}`,
      '# NETWORK_ECOSYSTEM',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Tracking started at: ${DateHelper.getDateTime(updatedState.trackingStartedAt)}`,
      `- Local neighbors: ${neighbors.length}`,
      `- Inferred service signals: ${inferredServices.length}`,
      '## Network Environment',
      `- Default route: ${defaultRoute.route}`,
      `- Default route source: ${defaultRoute.source}`,
      `- DNS resolvers: ${dnsResolvers.length > 0 ? dnsResolvers.join(', ') : 'none detected'}`,
      `- HTTP proxy: ${proxyEnv.http}`,
      `- HTTPS proxy: ${proxyEnv.https}`,
      `- NO_PROXY: ${proxyEnv.noProxy}`,
      `- VPN/proxy detected: ${vpnProxyStatus.behindVpnOrProxy ? 'yes' : 'no'}`,
      `- VPN/proxy reasons: ${vpnProxyStatus.reasons.join(', ') || 'none'}`,
      `- VPN tunnel interfaces: ${vpnProxyStatus.tunnelInterfaces.join(', ') || 'none'}`,
      `- VPN-related processes: ${vpnProxyStatus.vpnProcesses.join(', ') || 'none'}`,
      `- Active probe: ${activeProbe.source} | targets ${activeProbe.attempted} | reachable ${activeProbe.reachable}`,
      `- Preferred subnet focus: ${hasPreferredSubnet ? `${PREFERRED_SUBNET_PREFIX}.1-${PREFERRED_SUBNET_MAX_HOST}` : 'disabled'}`,
      `- Reverse DNS: ${reverseDnsProbe.source} | resolved ${reverseDnsProbe.resolvedCount}/${neighbors.length}`,
      '## Network Interfaces',
      ...(
        networkInterfaceLines.length > 0
          ? networkInterfaceLines
          : ['- No non-internal network interfaces detected']
      ),
      '## Discovered Local Devices',
      ...neighborLines,
      '## Inferred Home Services',
      ...serviceLines
    ].join('\n')
  }

  private buildNetworkInterfaceLines(
    interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>
  ): string[] {
    const lines: string[] = []

    for (const [name, addresses] of Object.entries(interfaces)) {
      if (!addresses || addresses.length === 0) {
        continue
      }

      for (const address of addresses) {
        if (address.internal) {
          continue
        }

        const cidr = address.cidr ? ` | CIDR ${address.cidr}` : ''
        lines.push(`- ${name} | ${address.family} | ${address.address}${cidr}`)
      }
    }

    return lines
  }

  private buildActiveProbeTargets(
    interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
    hasPreferredSubnet: boolean
  ): string[] {
    if (hasPreferredSubnet) {
      const localIpv4s = new Set<string>()
      for (const addresses of Object.values(interfaces)) {
        if (!addresses || addresses.length === 0) {
          continue
        }

        for (const address of addresses) {
          if (address.internal || address.family !== 'IPv4') {
            continue
          }

          localIpv4s.add(address.address)
        }
      }

      const preferredTargets: string[] = []
      for (let host = 1; host <= PREFERRED_SUBNET_MAX_HOST; host += 1) {
        const ip = `${PREFERRED_SUBNET_PREFIX}.${host}`
        if (localIpv4s.has(ip)) {
          continue
        }

        preferredTargets.push(ip)
      }

      return preferredTargets
    }

    const targets: string[] = []

    for (const addresses of Object.values(interfaces)) {
      if (!addresses || addresses.length === 0) {
        continue
      }

      for (const address of addresses) {
        if (address.internal || address.family !== 'IPv4') {
          continue
        }

        if (!this.isPrivateIpv4(address.address)) {
          continue
        }

        const octets = address.address.split('.').map((segment) => Number(segment))
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
          continue
        }

        const [a, b, c] = octets
        for (let host = 1; host <= 254; host += 1) {
          const candidateIp = `${a}.${b}.${c}.${host}`
          if (candidateIp === address.address) {
            continue
          }

          targets.push(candidateIp)
          if (targets.length >= MAX_ACTIVE_SCAN_TARGETS) {
            return [...new Set(targets)]
          }
        }
      }
    }

    return [...new Set(targets)].slice(0, MAX_ACTIVE_SCAN_TARGETS)
  }

  private hasPreferredSubnetInterface(
    interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>
  ): boolean {
    for (const addresses of Object.values(interfaces)) {
      if (!addresses || addresses.length === 0) {
        continue
      }

      for (const address of addresses) {
        if (address.internal || address.family !== 'IPv4') {
          continue
        }

        if (address.address.startsWith(`${PREFERRED_SUBNET_PREFIX}.`)) {
          return true
        }
      }
    }

    return false
  }

  private shouldKeepNeighbor(ip: string, hasPreferredSubnet: boolean): boolean {
    if (!ip || ip === 'unknown') {
      return false
    }

    if (hasPreferredSubnet) {
      return ip.startsWith(`${PREFERRED_SUBNET_PREFIX}.`)
    }

    return this.isPrivateIpv4(ip)
  }

  private probeNeighbors(): DiscoveredNeighbor[] {
    if (SystemHelper.isWindows()) {
      return this.probeNeighborsWindows()
    }

    if (SystemHelper.isMacOS()) {
      return this.probeNeighborsMacOS()
    }

    return this.probeNeighborsLinux()
  }

  private probeNeighborsLinux(): DiscoveredNeighbor[] {
    const output = this.probeHelper.runCommand('ip', ['neigh', 'show']) || ''
    const neighbors: DiscoveredNeighbor[] = []

    for (const line of output.split('\n').map((entry) => entry.trim())) {
      if (!line) {
        continue
      }

      const matched = line.match(
        /^([0-9a-fA-F:.]+)\s+dev\s+([^\s]+)(?:\s+lladdr\s+([0-9a-fA-F:.-]+))?(?:\s+([A-Z_]+))?/i
      )
      if (!matched) {
        continue
      }

      neighbors.push({
        ip: matched[1] || 'unknown',
        networkInterface: matched[2] || 'unknown',
        mac: (matched[3] || 'unknown').toLowerCase(),
        state: matched[4] || 'unknown',
        resolvedNames: []
      })
    }

    return this.deduplicateNeighbors(neighbors)
  }

  private probeNeighborsMacOS(): DiscoveredNeighbor[] {
    const output = this.probeHelper.runCommand('arp', ['-an']) || ''
    const neighbors: DiscoveredNeighbor[] = []

    for (const line of output.split('\n').map((entry) => entry.trim())) {
      if (!line) {
        continue
      }

      const matched = line.match(
        /\(([^)]+)\)\s+at\s+([0-9a-fA-F:.-]+|incomplete)\s+on\s+([^\s]+)/
      )
      if (!matched) {
        continue
      }

      neighbors.push({
        ip: matched[1] || 'unknown',
        mac: (matched[2] || 'unknown').toLowerCase(),
        networkInterface: matched[3] || 'unknown',
        state: matched[2] === 'incomplete' ? 'incomplete' : 'reachable',
        resolvedNames: []
      })
    }

    return this.deduplicateNeighbors(neighbors)
  }

  private probeNeighborsWindows(): DiscoveredNeighbor[] {
    const output = this.probeHelper.runCommand('arp', ['-a']) || ''
    const neighbors: DiscoveredNeighbor[] = []
    let currentInterface = 'unknown'

    for (const rawLine of output.split('\n')) {
      const line = rawLine.trim()
      if (!line) {
        continue
      }

      const interfaceMatch = line.match(/^Interface:\s+([0-9.]+)\s+---/)
      if (interfaceMatch?.[1]) {
        currentInterface = interfaceMatch[1]
        continue
      }

      const rowMatch = line.match(
        /^([0-9.]+)\s+([0-9a-fA-F-]+)\s+([a-zA-Z]+)$/
      )
      if (!rowMatch) {
        continue
      }

      neighbors.push({
        ip: rowMatch[1] || 'unknown',
        mac: (rowMatch[2] || 'unknown').replaceAll('-', ':').toLowerCase(),
        networkInterface: currentInterface,
        state: rowMatch[3] || 'unknown',
        resolvedNames: []
      })
    }

    return this.deduplicateNeighbors(neighbors)
  }

  private deduplicateNeighbors(neighbors: DiscoveredNeighbor[]): DiscoveredNeighbor[] {
    const byIp = new Map<string, DiscoveredNeighbor>()

    for (const neighbor of neighbors) {
      if (!neighbor.ip || neighbor.ip === 'unknown') {
        continue
      }

      if (!byIp.has(neighbor.ip)) {
        byIp.set(neighbor.ip, neighbor)
      }
    }

    return [...byIp.values()]
  }

  private normalizeState(
    state: LocalEcosystemState,
    nowIso: string
  ): LocalEcosystemState {
    return {
      trackingStartedAt: normalizeSampleTime(state.trackingStartedAt, nowIso),
      lastSampleAt: normalizeSampleTime(state.lastSampleAt, nowIso),
      devices:
        state.devices && typeof state.devices === 'object'
          ? this.normalizeDeviceStateEntries(state.devices)
          : {}
    }
  }

  private updateState(
    state: LocalEcosystemState,
    neighbors: DiscoveredNeighbor[],
    nowIso: string
  ): LocalEcosystemState {
    const devices = { ...state.devices }

    for (const neighbor of neighbors) {
      const hint = this.inferDeviceHint(neighbor)
      const existing = devices[neighbor.ip]
      if (!existing) {
        devices[neighbor.ip] = {
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          seenCount: 1,
          mac: neighbor.mac,
          networkInterface: neighbor.networkInterface,
          resolvedNames: neighbor.resolvedNames,
          identifier: this.buildDeviceIdentifier(neighbor, hint),
          hint
        }
        continue
      }

      devices[neighbor.ip] = {
        ...existing,
        lastSeenAt: nowIso,
        seenCount: existing.seenCount + 1,
        mac: neighbor.mac || existing.mac,
        networkInterface: neighbor.networkInterface || existing.networkInterface,
        resolvedNames:
          neighbor.resolvedNames.length > 0 ? neighbor.resolvedNames : existing.resolvedNames,
        identifier: this.buildDeviceIdentifier(
          {
            ...neighbor,
            resolvedNames:
              neighbor.resolvedNames.length > 0
                ? neighbor.resolvedNames
                : existing.resolvedNames
          },
          hint === 'unknown-device' ? existing.hint : hint
        ),
        hint: hint === 'unknown-device' ? existing.hint : hint
      }
    }

    const compactedEntries = Object.entries(devices)
      .sort((entryA, entryB) => {
        const seenDiff = (entryB[1]?.seenCount || 0) - (entryA[1]?.seenCount || 0)
        if (seenDiff !== 0) {
          return seenDiff
        }

        return Date.parse(entryB[1]?.lastSeenAt || '') - Date.parse(entryA[1]?.lastSeenAt || '')
      })
      .slice(0, MAX_DEVICE_STATE)
    const compactedDevices: Record<string, EcosystemDeviceState> = {}

    for (const [ip, entry] of compactedEntries) {
      compactedDevices[ip] = entry
    }

    return {
      trackingStartedAt: state.trackingStartedAt,
      lastSampleAt: nowIso,
      devices: compactedDevices
    }
  }

  private getRankedDevices(devices: Record<string, EcosystemDeviceState>): Array<
    EcosystemDeviceState & { ip: string }
  > {
    return Object.entries(devices)
      .map(([ip, entry]) => ({
        ip,
        ...entry
      }))
      .sort((entryA, entryB) => {
        if (entryA.seenCount !== entryB.seenCount) {
          return entryB.seenCount - entryA.seenCount
        }

        return Date.parse(entryB.lastSeenAt) - Date.parse(entryA.lastSeenAt)
      })
  }

  private normalizeDeviceStateEntries(
    devices: Record<string, EcosystemDeviceState>
  ): Record<string, EcosystemDeviceState> {
    const normalizedEntries: Record<string, EcosystemDeviceState> = {}

    for (const [ip, entry] of Object.entries(devices)) {
      const resolvedNames = Array.isArray(entry?.resolvedNames)
        ? entry.resolvedNames
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .slice(0, 4)
        : []

      normalizedEntries[ip] = {
        firstSeenAt: entry?.firstSeenAt || new Date(0).toISOString(),
        lastSeenAt: entry?.lastSeenAt || new Date(0).toISOString(),
        seenCount: Number(entry?.seenCount || 0),
        mac: entry?.mac || 'unknown',
        networkInterface: entry?.networkInterface || 'unknown',
        resolvedNames,
        identifier: entry?.identifier || resolvedNames[0] || ip,
        hint: entry?.hint || 'unknown-device'
      }
    }

    return normalizedEntries
  }

  private inferDeviceHint(neighbor: DiscoveredNeighbor): string {
    const fingerprint =
      `${neighbor.ip} ${neighbor.mac} ${neighbor.networkInterface} ${neighbor.resolvedNames.join(' ')}`.toLowerCase()
    const macVendor = this.detectVendorFromMac(neighbor.mac)

    if (
      /synology|qnap|nas|truenas|readynas/.test(fingerprint) ||
      macVendor === 'synology' ||
      macVendor === 'qnap' ||
      macVendor === 'western-digital'
    ) {
      return 'nas'
    }
    if (
      /router|gateway|openwrt|fritz|tplink|asus|ubiquiti/.test(fingerprint) ||
      macVendor === 'router-vendor'
    ) {
      return 'router'
    }
    if (
      /xiaomi|mi-|yeelight|philips|hue|iot|smart/.test(fingerprint) ||
      macVendor === 'smart-home-vendor'
    ) {
      return 'smart-home'
    }
    if (/printer|hp|epson|brother/.test(fingerprint) || macVendor === 'printer-vendor') {
      return 'printer'
    }
    if (/phone|android|iphone|ios/.test(fingerprint) || macVendor === 'mobile-vendor') {
      return 'mobile-device'
    }

    return 'unknown-device'
  }

  private buildDeviceIdentifier(neighbor: DiscoveredNeighbor, hint: string): string {
    if (neighbor.resolvedNames[0]) {
      return neighbor.resolvedNames[0]
    }

    const vendor = this.detectVendorFromMac(neighbor.mac)
    if (vendor !== 'unknown') {
      return `${vendor}-${neighbor.ip}`
    }

    if (hint !== 'unknown-device') {
      return `${hint}-${neighbor.ip}`
    }

    return neighbor.mac !== 'unknown' ? neighbor.mac : neighbor.ip
  }

  private detectVendorFromMac(
    mac: string
  ): 'synology' | 'qnap' | 'western-digital' | 'smart-home-vendor' | 'router-vendor' | 'printer-vendor' | 'mobile-vendor' | 'unknown' {
    const normalized = mac.toLowerCase().replaceAll('-', ':')
    const prefix = normalized.slice(0, 8)
    const prefixSet = new Set([prefix])

    if (prefixSet.has('00:11:32') || prefixSet.has('90:09:d0')) {
      return 'synology'
    }
    if (prefixSet.has('24:5e:be') || prefixSet.has('00:08:9b')) {
      return 'qnap'
    }
    if (prefixSet.has('00:14:22') || prefixSet.has('00:90:a9')) {
      return 'western-digital'
    }
    if (
      prefixSet.has('50:ec:50') ||
      prefixSet.has('64:09:80') ||
      prefixSet.has('ec:fa:bc') ||
      prefixSet.has('34:ce:00')
    ) {
      return 'smart-home-vendor'
    }
    if (
      prefixSet.has('f4:f2:6d') ||
      prefixSet.has('3c:84:6a') ||
      prefixSet.has('d8:07:b6') ||
      prefixSet.has('74:83:c2')
    ) {
      return 'router-vendor'
    }
    if (
      prefixSet.has('00:1b:a9') ||
      prefixSet.has('3c:2a:f4') ||
      prefixSet.has('28:16:a8')
    ) {
      return 'printer-vendor'
    }
    if (
      prefixSet.has('ac:bc:32') ||
      prefixSet.has('dc:a6:32') ||
      prefixSet.has('f0:99:b6') ||
      prefixSet.has('2c:54:cf')
    ) {
      return 'mobile-vendor'
    }

    return 'unknown'
  }

  private isPrivateIpv4(ip: string): boolean {
    const octets = ip.split('.').map((segment) => Number(segment))
    if (octets.length < 2) {
      return false
    }

    const firstOctet = octets[0] ?? Number.NaN
    const secondOctet = octets[1] ?? Number.NaN

    if (!Number.isInteger(firstOctet) || !Number.isInteger(secondOctet)) {
      return false
    }

    if (firstOctet === 10) {
      return true
    }

    if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) {
      return true
    }

    if (firstOctet === 192 && secondOctet === 168) {
      return true
    }

    return false
  }

  private buildServiceSignals(neighbors: DiscoveredNeighbor[]): string[] {
    const signals = new Set<string>()

    for (const neighbor of neighbors) {
      const hint = this.inferDeviceHint(neighbor)
      if (hint === 'nas') {
        signals.add(`NAS-like device on ${neighbor.ip}`)
      } else if (hint === 'smart-home') {
        signals.add(`Smart-home device signal on ${neighbor.ip}`)
      } else if (hint === 'router') {
        signals.add(`Router/gateway signal on ${neighbor.ip}`)
      } else if (hint === 'printer') {
        signals.add(`Printer signal on ${neighbor.ip}`)
      }
    }

    const processSnapshot = this.probeHelper.probeRunningProcesses(80)
    const processNames = new Set(
      processSnapshot.entries.map((entry) => entry.name.toLowerCase())
    )

    const addWhenSeen = (needle: string, label: string): void => {
      if ([...processNames].some((name) => name.includes(needle))) {
        signals.add(label)
      }
    }

    addWhenSeen('home-assistant', 'Home Assistant process detected locally')
    addWhenSeen('mosquitto', 'MQTT broker process (mosquitto) detected')
    addWhenSeen('smbd', 'SMB server process detected')
    addWhenSeen('nfsd', 'NFS server process detected')
    addWhenSeen('plex', 'Plex/media server process detected')
    addWhenSeen('syncthing', 'Sync service (syncthing) detected')
    addWhenSeen('docker', 'Container runtime (docker) detected')

    return [...signals].sort((valueA, valueB) => valueA.localeCompare(valueB))
  }
}
