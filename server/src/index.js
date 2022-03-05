import dotenv from 'dotenv'
// import { command } from 'execa'

import server from '@/core/http-server/server'

(async () => {
  dotenv.config()

  /* command('pipenv run python bridges/python/ws-server.py', {
    shell: true
  }) */
  await server.init()
})()
