import fs from 'node:fs/promises'
import path from 'node:path'

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'

import { readProfileAuthentication } from './profile-auth-routes'
import { renderWebAppDocument } from './web-app-document'

/**
 * Serves cacheable static assets separately from private, request-specific HTML.
 * Identity validation does not start models or other profile runtime services.
 */
export const webAppPlugin: FastifyPluginAsync<{ root: string }> = async (app, { root }) => {
  async function sendDocument(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = readProfileAuthentication(request)
    const html = await fs.readFile(path.join(root, 'index.html'), 'utf8')
    await reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie, Authorization, X-Leon-Profile-Token')
      .type('text/html')
      .send(renderWebAppDocument(html, auth))
  }

  await app.register(fastifyStatic, {
    root, prefix: '/', decorateReply: false, index: false
  })
  // The parent owns /web-app -> /web-app/; do not register its no-slash alias.
  app.get('/', { prefixTrailingSlash: 'slash' }, sendDocument)
  app.get('/index.html', sendDocument)
  app.setNotFoundHandler((request, reply) => {
    const requestPath = request.url.split('?')[0] || ''
    if (request.method === 'GET' && path.extname(requestPath) === '') {
      return sendDocument(request, reply)
    }

    return reply.code(404).send()
  })
}
