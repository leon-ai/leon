import fs from 'fs'
import archiver from 'archiver'

import log from '@/helpers/log'
import string from '@/helpers/string'

const getDownloads = async (fastify, options) => {
  fastify.get(`/${options.apiVersion}/downloads`, (request, reply) => {
    log.title('GET /downloads')

    const clean = (dir, files) => {
      log.info('Cleaning module download directory...')
      for (let i = 0; i < files.length; i += 1) {
        fs.unlinkSync(`${dir}/${files[i]}`)
      }
      fs.rmdirSync(dir)
      log.success('Downloads directory cleaned')
    }
    let message = ''

    if (request.query.package && request.query.module) {
      const packageDir = `${__dirname}/../../../../packages/${request.query.package}`
      const dlPackageDir = `${__dirname}/../../../../downloads/${request.query.package}`
      const module = `${packageDir}/${request.query.module}.py`

      log.info(
        `Checking existence of the ${string.ucfirst(
          request.query.module
        )} module...`
      )
      if (fs.existsSync(module)) {
        log.success(`${string.ucfirst(request.query.module)} module exists`)
        const downloadsDir = `${dlPackageDir}/${request.query.module}`

        log.info('Reading downloads directory...')
        fs.readdir(downloadsDir, (err, files) => {
          if (err && err.code === 'ENOENT') {
            message = 'There is no content to download for this module.'
            log.error(message)
            reply.code(404).send({
              success: false,
              status: 404,
              code: 'module_dir_not_found',
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
              const zipSlug = `leon-${request.query.package}-${request.query.module}`
              const pkgFiles = fs.readdirSync(dlPackageDir)

              for (let i = 0; i < pkgFiles.length; i += 1) {
                if (
                  pkgFiles[i].indexOf('.zip') !== -1
                  && pkgFiles[i].indexOf(zipSlug) !== -1
                ) {
                  fs.unlinkSync(`${dlPackageDir}/${pkgFiles[i]}`)
                  log.success(`${pkgFiles[i]} archive deleted`)
                }
              }

              log.info('Preparing new archive...')
              const zipName = `${zipSlug}-${Date.now()}.zip`
              const zipFile = `${dlPackageDir}/${zipName}`
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
        message = 'This module does not exist.'
        log.error(message)
        reply.code(404).send({
          success: false,
          status: 404,
          code: 'module_not_found',
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
