import type { onRequestHookHandler } from 'fastify'

import {
  CLIENT_INTERFACE_ALLOWED_ORIGINS,
  HOST,
  IS_PRODUCTION_ENV,
  WEB_APP_DEV_SERVER_PORT
} from '@/constants'
import {
  PROFILE_AUTHORIZATION_HEADER_NAME,
  PROFILE_TOKEN_HEADER_NAME
} from '@/core/profile-auth'

const ALLOWED_REQUEST_HEADERS = [
  'Origin',
  'X-Requested-With',
  'Content-Type',
  'Accept',
  PROFILE_AUTHORIZATION_HEADER_NAME,
  PROFILE_TOKEN_HEADER_NAME
].join(', ')

function getAllowedOrigins(): string[] {
  const origins = new Set(CLIENT_INTERFACE_ALLOWED_ORIGINS)

  if (!IS_PRODUCTION_ENV) {
    origins.add(`${HOST}:${WEB_APP_DEV_SERVER_PORT}`)
  }

  return [...origins]
}

export const corsMidd: onRequestHookHandler = async (request, reply) => {
  const origin = request.headers.origin
  const allowedOrigins = getAllowedOrigins()

  if (origin && allowedOrigins.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin)
  } else if (!IS_PRODUCTION_ENV && !origin) {
    reply.header(
      'Access-Control-Allow-Origin',
      `${HOST}:${WEB_APP_DEV_SERVER_PORT}`
    )
  }

  // Allow several headers for our requests
  reply.header(
    'Access-Control-Allow-Headers',
    ALLOWED_REQUEST_HEADERS
  )

  reply.header('Access-Control-Allow-Credentials', true)
}
