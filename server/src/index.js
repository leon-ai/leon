'use strict'

import dotenv from 'dotenv'

import Server from '@/core/server'

(async () => {
  dotenv.config()

  await Server.init()
})()
