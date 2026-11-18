import { configureRegionalPnpm } from './bridges/runtime/nodejs/download-region.js'

export const hooks = {
  updateConfig: configureRegionalPnpm
}
