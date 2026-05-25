import setupNVIDIALibs from './setup-nvidia-libs.js'
import setupPyTorch from './setup-pytorch.js'
import setupTCPServerModels from './setup-tcp-server-models'

/**
 * Install or update all resources needed by local voice mode.
 */
export default async function setupVoiceResources() {
  await setupNVIDIALibs()
  await setupPyTorch()
  await setupTCPServerModels()
}

const isMainModule = process.argv[1]?.endsWith('setup-voice-resources.js')

if (isMainModule) {
  setupVoiceResources().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
