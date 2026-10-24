import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import ffmpeg from 'ffmpeg-static'
import ffprobe from '@ffprobe-installer/ffprobe'

const require = createRequire(import.meta.url)
const packagePath = require.resolve('hyperframes/package.json')
const packageManifest = require(packagePath)

// Leon owns dependency versions and agent guidance. The CLI must not update
// itself, install other agents' skills, or send usage data from owner projects.
process.env.HYPERFRAMES_NO_UPDATE_CHECK = '1'
process.env.HYPERFRAMES_NO_AUTO_INSTALL = '1'
process.env.HYPERFRAMES_SKIP_SKILLS = '1'
process.env.HYPERFRAMES_NO_TELEMETRY = '1'
process.env.HYPERFRAMES_FFMPEG_PATH = ffmpeg
process.env.HYPERFRAMES_FFPROBE_PATH = ffprobe.path

// Resolve the executable from its public manifest because package exports do
// not need to expose binary files as importable subpaths.
await import(
  new URL(packageManifest.bin.hyperframes, pathToFileURL(packagePath)).href
)
