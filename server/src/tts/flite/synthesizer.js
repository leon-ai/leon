import { spawn } from 'node:child_process'
import fs from 'node:fs'

import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

LogHelper.title('Flite Synthesizer')

const synthesizer = {}

synthesizer.conf = {
  int_f0_target_mean: 115.0, // Intonation (85-180 Hz men; 165-255 Hz women)
  f0_shift: 1.0, // Low or high
  duration_stretch: 1.0, // Speed (lower = faster)
  int_f0_target_stddev: 15.0 // Pitch variability (lower = more flat)
}

/**
 * There is nothing to initialize for this synthesizer
 */
synthesizer.init = (lang) => {
  const flitePath = 'bin/flite/flite'

  /* istanbul ignore if */
  if (lang !== 'en-US') {
    LogHelper.warning(
      'The Flite synthesizer only accepts the "en-US" language for the moment'
    )
  }

  /* istanbul ignore if */
  if (!fs.existsSync(flitePath)) {
    LogHelper.error(
      `Cannot find ${flitePath} You can setup the offline TTS by running: "npm run setup:offline-tts"`
    )
    return false
  }

  LogHelper.success('Synthesizer initialized')

  return true
}

/**
 * Save string to audio file
 */
synthesizer.save = (speech, em, cb) => {
  const file = `${__dirname}/../../tmp/${Date.now()}-${StringHelper.random(
    4
  )}.wav`
  const process = spawn('bin/flite/flite', [
    speech,
    '--setf',
    `int_f0_target_mean=${synthesizer.conf.int_f0_target_mean}`,
    '--setf',
    `f0_shift=${synthesizer.conf.f0_shift}`,
    '--setf',
    `duration_stretch=${synthesizer.conf.duration_stretch}`,
    '--setf',
    `int_f0_target_stddev=${synthesizer.conf.int_f0_target_stddev}`,
    '-o',
    file
  ])

  /* istanbul ignore next */
  // Handle error
  process.stderr.on('data', (data) => {
    LogHelper.error(data.toString())
  })

  process.stdout.on('end', () => {
    const ffmpeg = new Ffmpeg()
    ffmpeg.setFfmpegPath(ffmpegPath)
    ffmpeg.setFfprobePath(ffprobePath)

    // Get file duration thanks to ffprobe
    ffmpeg.input(file).ffprobe((err, data) => {
      /* istanbul ignore if */
      if (err) LogHelper.error(err)
      else {
        const duration = data.streams[0].duration * 1000
        em.emit('saved', duration)
        cb(file, duration)
      }
    })
  })
}

export default synthesizer
