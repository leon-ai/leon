import fs from 'node:fs'
import path from 'node:path'

import archiver from 'archiver'

import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

const getDownloads = async (fastify, options) => {
  fastify.get(
    `/api/${options.apiVersion}/downloads`,
    async (request, reply) => {
      LogHelper.title('GET /downloads')

      const clean = async (dir, files) => {
        LogHelper.info('Cleaning skill download directory...')
        for (let i = 0; i < files.length; i += 1) {
          await fs.promises.unlink(`${dir}/${files[i]}`)
        }
        await fs.promises.rmdir(dir)
        LogHelper.success('Downloads directory cleaned')
      }
      let message = ''

      if (request.query.domain && request.query.skill) {
        const dlDomainDir = path.join(
          process.cwd(),
          'downloads',
          request.query.domain
        )
        const skill = path.join(dlDomainDir, `${request.query.skill}.py`)

        LogHelper.info(
          `Checking existence of the ${StringHelper.ucFirst(
            request.query.skill
          )} skill...`
        )
        if (fs.existsSync(skill)) {
          LogHelper.success(
            `${StringHelper.ucFirst(request.query.skill)} skill exists`
          )
          const downloadsDir = `${dlDomainDir}/${request.query.skill}`

          LogHelper.info('Reading downloads directory...')
          try {
            const files = await fs.promises.readdir(downloadsDir)
            // Download the file if there is only one
            if (files.length === 1) {
              LogHelper.info(`${files[0]} is downloading...`)
              reply.download(`${downloadsDir}/${files[0]}`)
              LogHelper.success(`${files[0]} downloaded`)
              await clean(downloadsDir, files)
            } else {
              LogHelper.info('Deleting previous archives...')
              const zipSlug = `leon-${request.query.domain}-${request.query.skill}`
              const domainsFiles = await fs.promises.readdir(dlDomainDir)

              for (let i = 0; i < domainsFiles.length; i += 1) {
                if (
                  domainsFiles[i].indexOf('.zip') !== -1 &&
                  domainsFiles[i].indexOf(zipSlug) !== -1
                ) {
                  await fs.promises.unlink(`${dlDomainDir}/${domainsFiles[i]}`)
                  LogHelper.success(`${domainsFiles[i]} archive deleted`)
                }
              }

              LogHelper.info('Preparing new archive...')
              const zipName = `${zipSlug}-${Date.now()}.zip`
              const zipFile = `${dlDomainDir}/${zipName}`
              const output = fs.createWriteStream(zipFile)
              const archive = archiver('zip', { zlib: { level: 9 } })

              // When the archive is ready
              output.on('close', () => {
                LogHelper.info(`${zipName} is downloading...`)
                reply.download(zipFile, async (err) => {
                  if (err) LogHelper.error(err)

                  LogHelper.success(`${zipName} downloaded`)

                  await clean(downloadsDir, files)
                })
              })
              archive.on('error', (err) => {
                LogHelper.error(err)
              })

              // Add the content to the archive
              LogHelper.info('Adding content...')
              archive.directory(downloadsDir, false)

              // Inject stream data to the archive
              LogHelper.info('Injecting stream data...')
              archive.pipe(output)

              LogHelper.info('Finalizing...')
              archive.finalize()
            }
          } catch (error) {
            if (error.code === 'ENOENT') {
              message = 'There is no content to download for this skill.'
              LogHelper.error(message)
              reply.code(404).send({
                success: false,
                status: 404,
                code: 'skill_dir_not_found',
                message
              })
            }
            LogHelper.error(message)
          }
        } else {
          message = 'This skill does not exist.'
          LogHelper.error(message)
          reply.code(404).send({
            success: false,
            status: 404,
            code: 'skill_not_found',
            message
          })
        }
      } else {
        message = 'Bad request.'
        LogHelper.error(message)
        reply.code(400).send({
          success: false,
          status: 400,
          code: 'bad_request',
          message
        })
      }
    }
  )
}

export default getDownloads
