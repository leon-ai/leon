'use strict'

import EventEmitter from 'events'

export default class Loader {
  constructor () {
    this.load = new EventEmitter()
    this.body = document.querySelector('body')

    this.load.on('settingup', (state) => {
      if (state) {
        this.body.classList.add('settingup')
      } else {
        this.body.classList.remove('settingup')
      }
    })
  }

  start () {
    this.load.emit('settingup', true)
  }

  stop () {
    this.load.emit('settingup', false)
  }
}
