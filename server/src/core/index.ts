import { HOST, PORT, TCP_SERVER_HOST, TCP_SERVER_PORT } from '@/constants'
import TCPClient from '@/core/tcp-client'
import HTTPServer from '@/core/http-server/http-server'

/**
 * Register core singletons
 */

export const TCP_CLIENT = new TCPClient(
  String(TCP_SERVER_HOST),
  TCP_SERVER_PORT
)

export const HTTP_SERVER = new HTTPServer(String(HOST), PORT)
