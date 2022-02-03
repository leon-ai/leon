import superagent from 'superagent'

import server from '@/core/http-server/server'

const urlPrefix = `${process.env.LEON_HOST}:${process.env.LEON_PORT}/api`
const queryUrl = `${urlPrefix}/query`
const actionModuleUrl = `${urlPrefix}/p/leon/randomnumber/run`;

/**
 * Test a simple module action over HTTP
 */

(async () => {
  await server.init()
})()

describe('Over HTTP', () => {
  test(`Request query endpoint POST ${queryUrl}`, async () => {
    const { body } = await superagent.post(queryUrl)
      .send({ query: 'Hello' })
      .set('X-API-Key', process.env.LEON_HTTP_API_KEY)

    expect(body).toHaveProperty('success', true)
  })

  test(`Request an action module: GET ${actionModuleUrl}`, async () => {
    const { body } = await superagent.get(actionModuleUrl)
      .set('X-API-Key', process.env.LEON_HTTP_API_KEY)

    expect(body).toHaveProperty('success', true)
  })
})
