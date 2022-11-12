import { TCP_SERVER_HOST, TCP_SERVER_PORT } from '@/constants'
import TCPClient from '@/core/tcp-client'

/**
 * Register core singletons
 */

export const TCP_CLIENT = new TCPClient(
  String(TCP_SERVER_HOST),
  TCP_SERVER_PORT
)
