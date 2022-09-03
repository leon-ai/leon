import superagent from 'superagent'

import server from '@/core/http-server/server'

const urlPrefix = `${process.env.LEON_HOST}:${process.env.LEON_PORT}/api`
const queryUrl = `${urlPrefix}/query`
const actionSkillUrl = `${urlPrefix}/p/leon/randomnumber/run`

/**
 * Test the query endpoint over HTTP
 * and a simple skill action over HTTP
 */

;(async () => {
  await server.init()
})()

describe('Over HTTP', () => {
  test(`Request query endpoint POST ${queryUrl}`, async () => {
    const { body } = await superagent
      .post(queryUrl)
      .send({ utterance: 'Hello' })
      .set('X-API-Key', process.env.LEON_HTTP_API_KEY)

    expect(body).toHaveProperty('success', true)
  })

  test(`Request an action skill: GET ${actionSkillUrl}`, async () => {
    const { body } = await superagent
      .get(actionSkillUrl)
      .set('X-API-Key', process.env.LEON_HTTP_API_KEY)

    expect(body).toHaveProperty('success', true)
  })
})
