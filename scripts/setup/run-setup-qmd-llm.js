import fs from 'node:fs'
import path from 'node:path'

import setupQMDLLM from './setup-qmd-llm'

const STATUS_WRITE_INTERVAL_MS = 500
const statusDirectory = process.env.LEON_SETUP_STATUS_DIR
let lastStatusWriteAt = 0
let latestStatus = {
  component: 'qmd',
  state: 'starting',
  message: 'Preparing QMD memory models'
}

function writeStatus(status, force = false) {
  if (!statusDirectory) {
    return
  }

  latestStatus = { ...latestStatus, ...status }
  const now = Date.now()
  if (!force && now - lastStatusWriteAt < STATUS_WRITE_INTERVAL_MS) {
    return
  }

  fs.mkdirSync(statusDirectory, { recursive: true })
  const destinationPath = path.join(statusDirectory, 'qmd.json')
  const temporaryPath = `${destinationPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(latestStatus))
  fs.renameSync(temporaryPath, destinationPath)
  lastStatusWriteAt = now
}

try {
  writeStatus(latestStatus, true)
  await setupQMDLLM({
    onModelStart: ({ filename, modelIndex, modelCount }) => {
      writeStatus(
        {
          state: 'downloading',
          message: `Downloading ${filename}`,
          model: filename,
          modelIndex,
          modelCount,
          downloadedBytes: 0,
          totalBytes: null,
          percentage: null,
          bytesPerSecond: 0,
          etaMs: null
        },
        true
      )
    },
    onModelProgress: ({
      filename,
      modelIndex,
      modelCount,
      downloadedBytes,
      totalBytes,
      percentage,
      bytesPerSecond,
      etaMs
    }) => {
      writeStatus({
        state: 'downloading',
        message: `Downloading ${filename}`,
        model: filename,
        modelIndex,
        modelCount,
        downloadedBytes,
        totalBytes,
        percentage,
        bytesPerSecond,
        etaMs
      })
    },
    onModelReady: ({ filename, modelIndex, modelCount }) => {
      writeStatus(
        {
          state: 'downloading',
          message: `${filename} is ready`,
          model: filename,
          modelIndex,
          modelCount,
          percentage: 100
        },
        true
      )
    }
  })
  writeStatus(
    {
      state: 'ready',
      message: 'QMD memory models are ready',
      percentage: 100
    },
    true
  )
} catch (error) {
  writeStatus(
    {
      state: 'error',
      message: error instanceof Error ? error.message : String(error)
    },
    true
  )
  throw error
}
