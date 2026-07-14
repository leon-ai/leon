import { StringHelper } from '@/helpers/string-helper'

const SATELLITE_PROCESS_TITLE_PREFIX = 'leon-satellite'
const SATELLITE_PROCESS_TITLE_FALLBACK_SEGMENT = 'unknown'
const SATELLITE_PROCESS_TITLE_SEGMENT_MAX_LENGTH = 16
const UNSAFE_PROCESS_TITLE_CHARACTER_PATTERN = /[^a-zA-Z0-9._-]+/g
const EDGE_SEPARATOR_PATTERN = /^-+|-+$/g

function normalizeProcessTitleSegment(value: string): string {
  const normalizedValue = StringHelper.removeAccents(String(value || ''))
    .trim()
    .replace(UNSAFE_PROCESS_TITLE_CHARACTER_PATTERN, '-')
    .replace(EDGE_SEPARATOR_PATTERN, '')
    .toLowerCase()

  const boundedValue = (
    normalizedValue || SATELLITE_PROCESS_TITLE_FALLBACK_SEGMENT
  ).slice(0, SATELLITE_PROCESS_TITLE_SEGMENT_MAX_LENGTH)

  return (
    boundedValue.replace(EDGE_SEPARATOR_PATTERN, '') ||
    SATELLITE_PROCESS_TITLE_FALLBACK_SEGMENT
  )
}

/** Build a short, portable process title for one profile-device connection. */
export function buildSatelliteProcessTitle(
  profileName: string,
  deviceId: string
): string {
  const profileSegment = normalizeProcessTitleSegment(profileName)
  const deviceSegment = normalizeProcessTitleSegment(deviceId)

  return `${SATELLITE_PROCESS_TITLE_PREFIX}-${profileSegment}-${deviceSegment}`
}
