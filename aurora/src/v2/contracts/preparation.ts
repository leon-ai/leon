export enum PreparationStatus {
  Preparing = 'preparing',
  Downloading = 'downloading',
  Ready = 'ready',
  Failed = 'failed',
  Cancelled = 'cancelled'
}

/**
 * Host-observed preparation state, never a model-authored progress estimate.
 */
export interface ToolPreparationSnapshot {
  downloads?: import('../../../../bridges/runtime/contracts/download-progress').FileDownloadProgress[]
  purpose?: 'download'
  status: PreparationStatus
  detail: string
  executionId?: string
  completed?: number
  total?: number
}
