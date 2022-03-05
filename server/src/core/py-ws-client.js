import { io } from 'socket.io-client'

export default class PyWsClient {
  constructor (serverUrl) {
    this.serverUrl = serverUrl
    this.pySocket = io(this.serverUrl)

    this.pySocket.on('connect', () => {
      console.log('CONNECTED')
    })

    this.pySocket.on('entities_extracted', (data) => {
      console.log('entities_extracted data', data)
    })
  }

  extractEntities (utterance) {
    return new Promise((resolve) => {
      console.log('EMMIIIT')
      this.pySocket.emit(
        'extract_entities',
        utterance,
        (conf) => {
          resolve(conf)
        }
      )
    })
  }
}
