import setupNode from '../setup/setup-node.js'
import setupPNPM from '../setup/setup-pnpm.js'

// Bootstrap package-manager runtimes before enforcing the new package engines.
await setupNode()
await setupPNPM()
