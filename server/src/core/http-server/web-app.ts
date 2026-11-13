import fs from 'node:fs/promises'
import path from 'node:path'

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'

import { readProfileAuthentication } from './profile-auth-routes'
import { renderWebAppDocument } from './web-app-document'

const FILE_ICON_VERSION_PATTERN = /^[a-f0-9]{64}$/
const IMMUTABLE_CACHE_MAXIMUM_AGE_SECONDS = 31_536_000

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
    root, prefix: '/', decorateReply: false, index: false,
    setHeaders(reply, filePath): void {
      const directory = path.dirname(filePath)
      // Only content-versioned artwork is immutable. Ordinary public files
      // and profile-specific documents must retain their existing cache policy.
      if (path.dirname(directory) === path.join(root, 'img/file-icons') &&
        FILE_ICON_VERSION_PATTERN.test(path.basename(directory)) && path.extname(filePath) === '.svg') {
        reply.header('Cache-Control', `public, max-age=${IMMUTABLE_CACHE_MAXIMUM_AGE_SECONDS}, immutable`)
      }
    }
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
