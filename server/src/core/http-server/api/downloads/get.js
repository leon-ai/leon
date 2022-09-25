import fs from 'fs'
import path from 'path'
import archiver from 'archiver'

import { LOG } from '@/helpers/log'
import { StringHelper } from '@/helpers/string-helper'

const getDownloads = async (fastify, options) => {
  fastify.get(`/api/${options.apiVersion}/downloads`, (request, reply) => {
    LOG.title('GET /downloads')

    const clean = (dir, files) => {
      LOG.info('Cleaning skill download directory...')
      for (let i = 0; i < files.length; i += 1) {
        fs.unlinkSync(`${dir}/${files[i]}`)
      }
      fs.rmdirSync(dir)
      LOG.success('Downloads directory cleaned')
    }
    let message = ''

    if (request.query.domain && request.query.skill) {
      const dlDomainDir = path.join(
        process.cwd(),
        'downloads',
        request.query.domain
      )
      const skill = path.join(dlDomainDir, `${request.query.skill}.py`)

      LOG.info(
        `Checking existence of the ${StringHelper.ucFirst(
          request.query.skill
        )} skill...`
      )
      if (fs.existsSync(skill)) {
        LOG.success(`${StringHelper.ucFirst(request.query.skill)} skill exists`)
        const downloadsDir = `${dlDomainDir}/${request.query.skill}`

        LOG.info('Reading downloads directory...')
        fs.readdir(downloadsDir, (err, files) => {
          if (err && err.code === 'ENOENT') {
            message = 'There is no content to download for this skill.'
            LOG.error(message)
            reply.code(404).send({
              success: false,
              status: 404,
              code: 'skill_dir_not_found',
              message
            })
          } else {
            if (err) LOG.error(err)

            // Download the file if there is only one
            if (files.length === 1) {
              LOG.info(`${files[0]} is downloading...`)
              reply.download(`${downloadsDir}/${files[0]}`)
              LOG.success(`${files[0]} downloaded`)
              clean(downloadsDir, files)
            } else {
              LOG.info('Deleting previous archives...')
              const zipSlug = `leon-${request.query.domain}-${request.query.skill}`
              const domainsFiles = fs.readdirSync(dlDomainDir)

              for (let i = 0; i < domainsFiles.length; i += 1) {
                if (
                  domainsFiles[i].indexOf('.zip') !== -1 &&
                  domainsFiles[i].indexOf(zipSlug) !== -1
                ) {
                  fs.unlinkSync(`${dlDomainDir}/${domainsFiles[i]}`)
                  LOG.success(`${domainsFiles[i]} archive deleted`)
                }
              }

              LOG.info('Preparing new archive...')
              const zipName = `${zipSlug}-${Date.now()}.zip`
              const zipFile = `${dlDomainDir}/${zipName}`
              const output = fs.createWriteStream(zipFile)
              const archive = archiver('zip', { zlib: { level: 9 } })

              // When the archive is ready
              output.on('close', () => {
                LOG.info(`${zipName} is downloading...`)
                reply.download(zipFile, (err) => {
                  if (err) LOG.error(err)

                  LOG.success(`${zipName} downloaded`)

                  clean(downloadsDir, files)
                })
              })
              archive.on('error', (err) => {
                LOG.error(err)
              })

              // Add the content to the archive
              LOG.info('Adding content...')
              archive.directory(downloadsDir, false)

              // Inject stream data to the archive
              LOG.info('Injecting stream data...')
              archive.pipe(output)

              LOG.info('Finalizing...')
              archive.finalize()
            }
          }
        })
      } else {
        message = 'This skill does not exist.'
        LOG.error(message)
        reply.code(404).send({
          success: false,
          status: 404,
          code: 'skill_not_found',
          message
        })
      }
    } else {
      message = 'Bad request.'
      LOG.error(message)
      reply.code(400).send({
        success: false,
        status: 400,
        code: 'bad_request',
        message
      })
    }
  })
}

export default getDownloads
