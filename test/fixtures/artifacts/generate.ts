import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpeg from 'ffmpeg-static'

import { createZipArchive } from '../../../bridges/nodejs/src/sdk/utils/archive'

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url))
const ARCHIVE_FILES = new Set(['notes.txt', 'moments.csv', 'greeting.py'])
const execute = promisify(execFile)

/**
 * Generates small, original media and valid Office/archive fixtures offline.
 * Preview builds consume the checked-in files; they never launch encoders.
 */
export async function generateArtifactFixtures(): Promise<void> {
  if (!ffmpeg) {
    throw new Error('The local FFmpeg binary is unavailable.')
  }

  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=0x1C75DB:s=256x144:r=12:d=2',
    '-vf', 'drawbox=x=64:y=40:w=128:h=64:color=white@0.6:t=fill,fade=t=in:st=0:d=1,fade=t=out:st=1:d=1',
    '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42',
    path.join(DIRECTORY, 'a-quiet-moment.webm')
  ])
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=2:sample_rate=8000',
    '-af', 'volume=0.03,afade=t=in:st=0:d=0.1,afade=t=out:st=1.8:d=0.2',
    '-c:a', 'pcm_s16le', path.join(DIRECTORY, 'a-soft-note.wav')
  ])
  await createZipArchive(path.join(DIRECTORY, 'document'), path.join(DIRECTORY, 'field-notes.docx'))
  await createZipArchive(DIRECTORY, path.join(DIRECTORY, 'project-notes.zip'), {
    exclude: (relativePath) => !ARCHIVE_FILES.has(relativePath)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateArtifactFixtures()
  for (const filename of ['a-quiet-moment.webm', 'a-soft-note.wav', 'field-notes.docx', 'project-notes.zip']) {
    const { size } = await fs.stat(path.join(DIRECTORY, filename))
    console.info(`${filename}: ${size} bytes`)
  }
}
