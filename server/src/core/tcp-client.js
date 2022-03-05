import Net from 'net'
import { EventEmitter } from 'events'

import log from '@/helpers/log'

export default class TcpClient {
  constructor (host, port) {
    this.tcpSocket = new Net.Socket()
    this._ee = new EventEmitter()
    this._status = this.tcpSocket.readyState

    log.title('TCP Client')
    log.success('New instance')

    this.tcpSocket.connect({ host, port }, () => {
      log.title('TCP Client')
      log.success(`Connected to TCP server tcp://${host}:${port}`)
    })

    this.tcpSocket.on('data', (chunk) => {
      log.title('TCP Client')

      const data = JSON.parse(chunk)

      this._ee.emit(data.topic, data.data)

      console.log('RECEIIIIVED', chunk.toString())
    })

    this.tcpSocket.on('error', (err) => {
      log.title('TCP Client')
      log.error(err)
    })

    this.tcpSocket.on('end', () => {
      log.title('TCP Client')
      log.success('Disconnected from TCP server')
    })
  }

  get status () {
    return this._status
  }

  get ee () {
    return this._ee
  }

  emit (topic, data) {
    const obj = {
      topic,
      data
    }

    this.tcpSocket.write(JSON.stringify(obj))
  }
}
