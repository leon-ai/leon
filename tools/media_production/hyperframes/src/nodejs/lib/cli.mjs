import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import ffmpeg from 'ffmpeg-static'
import ffprobe from '@ffprobe-installer/ffprobe'

const require = createRequire(import.meta.url)

// Leon owns dependency versions and agent guidance. The CLI must not update
// itself, install other agents' skills, or send usage data from owner projects.
process.env.HYPERFRAMES_NO_UPDATE_CHECK = '1'
process.env.HYPERFRAMES_NO_AUTO_INSTALL = '1'
process.env.HYPERFRAMES_SKIP_SKILLS = '1'
process.env.HYPERFRAMES_NO_TELEMETRY = '1'
process.env.HYPERFRAMES_FFMPEG_PATH = ffmpeg
process.env.HYPERFRAMES_FFPROBE_PATH = ffprobe.path

await import(pathToFileURL(require.resolve('hyperframes/bin/hyperframes.mjs')).href)
