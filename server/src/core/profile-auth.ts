import crypto from 'node:crypto'
import fs from 'node:fs'

import dotenv from 'dotenv'

import {
  getProfilePaths,
  isValidProfileName,
  PROFILE_TOKEN_SEPARATOR
} from '@/core/profile-runtime/profile-paths'

export const PROFILE_TOKEN_ENV_NAME = 'LEON_PROFILE_TOKEN'
export const LEGACY_PROFILE_TOKEN_ENV_NAME = 'LEON_CLIENT_INTERFACE_TOKEN'
export const PROFILE_AUTH_COOKIE_NAME = 'leon_profile_token'
export const PROFILE_AUTHORIZATION_HEADER_NAME = 'authorization'
export const PROFILE_TOKEN_HEADER_NAME = 'x-leon-profile-token'
export const LEGACY_PROFILE_TOKEN_HEADER_NAME = 'x-leon-client-token'

export interface ProfileCredential {
  profileName: string
  secret: string
  value: string
}

function areSecretsEqual(firstSecret: string, secondSecret: string): boolean {
  const firstBuffer = Buffer.from(firstSecret)
  const secondBuffer = Buffer.from(secondSecret)

  return (
    firstBuffer.length === secondBuffer.length &&
    crypto.timingSafeEqual(firstBuffer, secondBuffer)
  )
}

function readBearerToken(value: string | undefined): string {
  const normalizedValue = String(value || '').trim()
  const separatorIndex = normalizedValue.indexOf(' ')

  if (separatorIndex < 0) {
    return ''
  }

  const scheme = normalizedValue.slice(0, separatorIndex).toLowerCase()

  return scheme === 'bearer'
    ? normalizedValue.slice(separatorIndex + 1).trim()
    : ''
}

function readCookie(cookieHeader: string | undefined, name: string): string {
  for (const cookie of String(cookieHeader || '').split(';')) {
    const separatorIndex = cookie.indexOf('=')

    if (separatorIndex < 0 || cookie.slice(0, separatorIndex).trim() !== name) {
      continue
    }

    try {
      return decodeURIComponent(cookie.slice(separatorIndex + 1).trim())
    } catch {
      return ''
    }
  }

  return ''
}

/** Parse the public `profile:secret` credential without touching the filesystem. */
export function parseProfileCredential(
  value: string | null | undefined
): ProfileCredential | null {
  const normalizedValue = String(value || '').trim()
  const separatorIndex = normalizedValue.indexOf(PROFILE_TOKEN_SEPARATOR)

  if (separatorIndex <= 0) {
    return null
  }

  const profileName = normalizedValue.slice(0, separatorIndex).trim()
  const secret = normalizedValue.slice(separatorIndex + 1).trim()

  if (!isValidProfileName(profileName) || !secret) {
    return null
  }

  return {
    profileName,
    secret,
    value: `${profileName}${PROFILE_TOKEN_SEPARATOR}${secret}`
  }
}

/** Read a profile token without loading its other secrets into process.env. */
export function readStoredProfileToken(profileName: string): string {
  const dotEnvPath = getProfilePaths(profileName).dotEnv

  if (!fs.existsSync(dotEnvPath)) {
    return ''
  }

  const values = dotenv.parse(fs.readFileSync(dotEnvPath, 'utf8'))

  return String(
    values[PROFILE_TOKEN_ENV_NAME] ||
      values[LEGACY_PROFILE_TOKEN_ENV_NAME] ||
      ''
  ).trim()
}

/** Validate a profile credential and return its profile only when it matches. */
export function authenticateProfileCredential(
  value: string | null | undefined
): ProfileCredential | null {
  const credential = parseProfileCredential(value)

  if (!credential) {
    return null
  }

  const storedToken = readStoredProfileToken(credential.profileName)

  return storedToken && areSecretsEqual(credential.secret, storedToken)
    ? credential
    : null
}

/** Read the profile credential accepted by HTTP and Socket.IO transports. */
export function readProfileCredentialFromHeaders(headers: {
  authorization?: string | undefined
  cookie?: string | undefined
  [PROFILE_TOKEN_HEADER_NAME]?: string | undefined
  [LEGACY_PROFILE_TOKEN_HEADER_NAME]?: string | undefined
}): string {
  return (
    readBearerToken(headers[PROFILE_AUTHORIZATION_HEADER_NAME]) ||
    String(headers[PROFILE_TOKEN_HEADER_NAME] || '').trim() ||
    String(headers[LEGACY_PROFILE_TOKEN_HEADER_NAME] || '').trim() ||
    readCookie(headers.cookie, PROFILE_AUTH_COOKIE_NAME)
  )
}

/** Build the browser cookie shared by same-origin HTTP and Socket.IO requests. */
export function buildProfileAuthCookie(
  credential: string,
  options?: { clear?: boolean, secure?: boolean }
): string {
  const value = options?.clear ? '' : encodeURIComponent(credential)
  const attributes = [
    `${PROFILE_AUTH_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(options?.secure ? ['Secure'] : []),
    ...(options?.clear ? ['Max-Age=0'] : [])
  ]

  return attributes.join('; ')
}
