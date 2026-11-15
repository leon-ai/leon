import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Rejects other content types before buffered parsers can consume a binary
 * upload route's large body allowance. Stream handlers enforce actual bytes.
 */
export async function requireBinaryUpload(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/octet-stream') {
    return reply.code(415).send({ message: 'I accept binary file uploads only.' })
  }

  return undefined
}
