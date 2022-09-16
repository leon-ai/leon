import fs from 'fs'
import path from 'path'
import archiver from 'archiver'

import { log } from '@/helpers/log'
import { ucFirst } from '@/helpers/string'

const getDownloads = async (fastify, options) => {
  fastify.get(`/api/${options.apiVersion}/downloads`, (request, reply) => {
    log.title('GET /downloads')

    const clean = (dir, files) => {
      log.info('Cleaning skill download directory...')
      for (let i = 0; i < files.length; i += 1) {
        fs.unlinkSync(`${dir}/${files[i]}`)
      }
      fs.rmdirSync(dir)
      log.success('Downloads directory cleaned')
    }
    let message = ''

    if (request.query.domain && request.query.skill) {
      const dlDomainDir = path.join(
        process.cwd(),
        'downloads',
        request.query.domain
      )
      const skill = path.join(dlDomainDir, `${request.query.skill}.py`)

      log.info(
        `Checking existence of the ${ucFirst(request.query.skill)} skill...`
      )
      if (fs.existsSync(skill)) {
        log.success(`${ucFirst(request.query.skill)} skill exists`)
        const downloadsDir = `${dlDomainDir}/${request.query.skill}`

        log.info('Reading downloads directory...')
        fs.readdir(downloadsDir, (err, files) => {
          if (err && err.code === 'ENOENT') {
            message = 'There is no content to download for this skill.'
            log.error(message)
            reply.code(404).send({
              success: false,
              status: 404,
              code: 'skill_dir_not_found',
              message
            })
          } else {
            if (err) log.error(err)

            // Download the file if there is only one
            if (files.length === 1) {
              log.info(`${files[0]} is downloading...`)
              reply.download(`${downloadsDir}/${files[0]}`)
              log.success(`${files[0]} downloaded`)
              clean(downloadsDir, files)
            } else {
              log.info('Deleting previous archives...')
              const zipSlug = `leon-${request.query.domain}-${request.query.skill}`
              const domainsFiles = fs.readdirSync(dlDomainDir)

              for (let i = 0; i < domainsFiles.length; i += 1) {
                if (
                  domainsFiles[i].indexOf('.zip') !== -1 &&
                  domainsFiles[i].indexOf(zipSlug) !== -1
                ) {
                  fs.unlinkSync(`${dlDomainDir}/${domainsFiles[i]}`)
                  log.success(`${domainsFiles[i]} archive deleted`)
                }
              }

              log.info('Preparing new archive...')
              const zipName = `${zipSlug}-${Date.now()}.zip`
              const zipFile = `${dlDomainDir}/${zipName}`
              const output = fs.createWriteStream(zipFile)
              const archive = archiver('zip', { zlib: { level: 9 } })

              // When the archive is ready
              output.on('close', () => {
                log.info(`${zipName} is downloading...`)
                reply.download(zipFile, (err) => {
                  if (err) log.error(err)

                  log.success(`${zipName} downloaded`)

                  clean(downloadsDir, files)
                })
              })
              archive.on('error', (err) => {
                log.error(err)
              })

              // Add the content to the archive
              log.info('Adding content...')
              archive.directory(downloadsDir, false)

              // Inject stream data to the archive
              log.info('Injecting stream data...')
              archive.pipe(output)

              log.info('Finalizing...')
              archive.finalize()
            }
          }
        })
      } else {
        message = 'This skill does not exist.'
        log.error(message)
        reply.code(404).send({
          success: false,
          status: 404,
          code: 'skill_not_found',
          message
        })
      }
    } else {
      message = 'Bad request.'
      log.error(message)
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
