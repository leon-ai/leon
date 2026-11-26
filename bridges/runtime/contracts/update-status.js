// Node.js tooling, the browser and the Leon server share these states before any build runs.
export const UpdatePhase = /**
 * @type {const}
 */ ({
  Scheduled: 'scheduled',
  Installing: 'installing',
  Restarting: 'restarting',
  Completed: 'completed',
  Failed: 'failed'
})

export const LEON_UPDATE_EXIT_CODE = 78
export const RELEASE_ASSET_NAME = 'leon-release.json'

export const LEON_RESTART_EXIT_CODE = 77
export const CORE_READY_EVENT = 'leon:core-ready'

export const UPDATE_CHECK_INTERVAL_MS = 6 * 3_600 * 1_000
export const UPDATE_CHECK_JITTER_MS = 15 * 60 * 1_000

export const UpdateStage = Object.freeze({
  Downloading: 'downloading',
  Verifying: 'verifying',
  Extracting: 'extracting',
  Preparing: 'preparing',
  Restarting: 'restarting',
  Starting: 'starting'
})

export const UPDATE_STAGE_LABELS = Object.freeze({
  downloading: 'Downloading my update',
  verifying: 'Verifying my update',
  extracting: 'Unpacking my update',
  preparing: 'Preparing my profiles',
  restarting: 'Restarting my server',
  starting: 'Waiting for my server'
})
