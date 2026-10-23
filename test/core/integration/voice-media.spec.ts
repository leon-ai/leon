import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { execa } from 'execa'
import ffmpegStatic from 'ffmpeg-static'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ASR from '@/core/asr/asr'
import { ASR_ENGINE } from '@/core'

vi.mock('@/constants', () => ({ TMP_PATH: '' }))
vi.mock('@/core', () => ({
  ASR_ENGINE: { isParserReady: true, transcribe: vi.fn() }
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn()
  }
}))

let root: string
let webm: Buffer
let source: string
let asr: ASR

beforeAll(async () => {
  if (!ffmpegStatic) {
    throw new Error('FFmpeg binary is unavailable')
  }

  root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon voice media '))
  source = path.join(root, 'source audio.wav')
  const recording = path.join(root, 'recorded audio.webm')

  await execa(ffmpegStatic, [
    '-nostdin', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', '0.25', source
  ])
  await execa(ffmpegStatic, ['-nostdin', '-i', source, '-c:a', 'libopus', recording])
  webm = await fs.readFile(recording)
})

beforeEach(() => {
  ASR_ENGINE.isParserReady = true
  asr = new ASR()
  asr.audioPaths = {
    webm: path.join(root, 'speech input.webm'),
    wav: path.join(root, 'speech output.wav')
  }
})

afterAll(async () => {
  if (root) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

describe('Voice media processing', () => {
  it('converts WebM to mono 16 kHz PCM WAV before transcription and replaces previous output', async () => {
    await fs.writeFile(asr.audioPaths.wav, 'previous output')
    await asr.encode(webm)

    expect(ASR_ENGINE.transcribe).toHaveBeenCalledExactlyOnceWith(asr.audioPaths.wav)
    const { stdout } = await execa(ffprobePath, [
      '-v', 'error', '-show_streams', '-of', 'json', asr.audioPaths.wav
    ])
    const metadata = JSON.parse(stdout)

    expect(metadata.streams).toHaveLength(1)
    expect(metadata.streams[0]).toMatchObject({
      codec_name: 'pcm_s16le',
      sample_rate: '16000',
      channels: 1
    })
  })

  it('rejects invalid recordings without transcribing stale output', async () => {
    await expect(asr.encode(Buffer.from('not audio'))).rejects.toThrow('Encoding error')
    expect(ASR_ENGINE.transcribe).not.toHaveBeenCalled()
  })

  it('rejects conversion when the speech parser is not ready', async () => {
    ASR_ENGINE.isParserReady = false

    await expect(asr.encode(webm)).rejects.toThrow('The speech recognition is not ready yet')
    expect(ASR_ENGINE.transcribe).not.toHaveBeenCalled()
  })
})
