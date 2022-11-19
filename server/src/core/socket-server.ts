// import { Server as SocketIOServer } from 'socket.io'

// import { IS_DEVELOPMENT_ENV } from '@/constants'
// import { HTTP_SERVER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'

export default class SocketServer {
  private static instance: SocketServer

  constructor() {
    if (!SocketServer.instance) {
      LogHelper.title('Socket Server')
      LogHelper.success('New instance')

      SocketServer.instance = this
    }
  }

  public init(): void {
    /*const { httpServer, host } = HTTP_SERVER
    const io = IS_DEVELOPMENT_ENV
      ? new SocketIOServer(httpServer, {
          cors: { origin: `${this.host}:3000` }
        })
      : new SocketIOServer(httpServer)

    // TODO: instantiate new socket server
    io.on('connection', (socket) => {

    })*/
  }
}
