import type { FastifyPluginAsync } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { authenticateProfileCredential, readProfileCredentialFromHeaders } from '@/core/profile-runtime/profile-auth'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { TOOLKIT_REGISTRY } from '@/core'
import { listPairedDevices, pairDevice, revokeDevice } from '@/core/satellite/device-pairing'
import { SATELLITE_REGISTRY } from '@/core/satellite/satellite-registry'

const pairingBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  tools: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    minItems: 1, maxItems: 32, uniqueItems: true
  })
}, { additionalProperties: false })
const deviceParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) })

/**
 * Lets an authenticated owner grant and revoke device-only tool authority.
 */
export const devicesPlugin: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const route = '/api/' + options.apiVersion + '/devices'

  fastify.addHook('preHandler', async (request, reply) => {
    const credential = authenticateProfileCredential(readProfileCredentialFromHeaders({
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      'x-leon-profile-token': String(request.headers['x-leon-profile-token'] || '')
    }))
    if (credential?.profileName !== getActiveProfileName()) {
      return reply.code(401).send({ message: 'Sign in to pair or revoke a device.' })
    }
  })

  fastify.get(route, async (_request, reply) => {
    const profile = getActiveProfileName()
    const devices = await listPairedDevices(profile)

    return reply.header('Cache-Control', 'private, no-store').send({
      devices: devices.map((device) => ({
        ...device, online: Boolean(SATELLITE_REGISTRY.getConnection(profile, device.id))
      }))
    })
  })

  fastify.post<{ Body: Static<typeof pairingBody> }>(route, {
    schema: { body: pairingBody }
  }, async (request, reply) => {
    await TOOLKIT_REGISTRY.load()
    const allowed = new Set(TOOLKIT_REGISTRY.getPairedDeviceManifest().flatMap((toolkit) =>
      Object.keys(toolkit.tools).map((id) => toolkit.id + '.' + id)
    ))
    if (request.body.tools.some((id) => !allowed.has(id))) {
      return reply.code(400).send({ message: 'Some requested tools are unavailable for this device.' })
    }

    reply.header('Cache-Control', 'no-store')
    return reply.code(201).send(await pairDevice(request.body.name, request.body.tools))
  })

  fastify.delete<{ Params: Static<typeof deviceParams> }>(route + '/:id', {
    schema: { params: deviceParams }
  }, async (request, reply) => {
    const { id } = request.params

    await revokeDevice(id)
    SATELLITE_REGISTRY.unregister(getActiveProfileName(), id)
    TOOLKIT_REGISTRY.removeSatelliteTools(id)

    return reply.code(204).send()
  })
}
