import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import Ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'

import log from '@/helpers/log'

const audios = {
  webm: `${__dirname}/../tmp/speech.webm`,
  wav: `${__dirname}/../tmp/speech.wav`
}

class Asr {
  constructor () {
    this.blob = { }

    log.title('ASR')
    log.success('New instance')
  }

  static get audios () {
    return audios
  }

  /**
   * Encode audio blob to WAVE file
   * and forward the WAVE file to the STT parser
   */
  run (blob, stt) {
    return new Promise((resolve, reject) => {
      log.title('ASR')
      
      this.blob = blob

      fs.writeFile(audios.webm, Buffer.from(this.blob), 'binary', (err) => {
        if (err) {
          reject({ type: 'error', obj: err })
          return
        }

        const ffmpeg = new Ffmpeg()
        ffmpeg.setFfmpegPath(ffmpegPath)

        /**
         * Encode WebM file to WAVE file
         * ffmpeg -i speech.webm -acodec pcm_s16le -ar 16000 -ac 1 speech.wav
         */
        ffmpeg.addInput(audios.webm)
          .on('start', () => {
            log.info('Encoding WebM file to WAVE file...')
          })
          .on('end', () => {
            log.success('Encoding done')

            if (Object.keys(stt).length === 0) {
              reject({ type: 'warning', obj: new Error('The speech recognition is not ready yet') })
            } else {
              stt.parse(audios.wav)
              resolve()
            }
          })
          .on('error', (err) => {
            reject({ type: 'error', obj: new Error(`Encoding error ${err}`) })
          })
          .outputOptions(['-acodec pcm_s16le', '-ar 16000', '-ac 1'])
          .output(audios.wav)
          .run()
      })
    })
  }
}

export default Asr
