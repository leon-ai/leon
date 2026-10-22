import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { HomeContextFile } from '@/core/context-manager/context-files/home-context-file'
import { HostSystemContextFile } from '@/core/context-manager/context-files/host-system-context-file'
import { GpuComputeContextFile } from '@/core/context-manager/context-files/gpu-compute-context-file'
import { StorageContextFile } from '@/core/context-manager/context-files/storage-context-file'
import { SystemResourcesContextFile } from '@/core/context-manager/context-files/system-resources-context-file'
import { BrowserHistoryContextFile } from '@/core/context-manager/context-files/browser-history-context-file'
import { LeonRuntimeContextFile, type LeonRuntimeContextResolvers } from '@/core/context-manager/context-files/leon-runtime-context-file'
import { ActivityContextFile } from '@/core/context-manager/context-files/activity-context-file'
import { LocalInventoryContextFile } from '@/core/context-manager/context-files/local-inventory-context-file'
import { NetworkEcosystemContextFile } from '@/core/context-manager/context-files/network-ecosystem-context-file'
import { WorkspaceIntelligenceContextFile } from '@/core/context-manager/context-files/workspace-intelligence-context-file'
import { HabitsContextFile } from '@/core/context-manager/context-files/habits-context-file'
import { MediaProfileContextFile } from '@/core/context-manager/context-files/media-profile-context-file'
import { LeonContextFile } from '@/core/context-manager/context-files/leon-context-file'
import { ArchitectureContextFile } from '@/core/context-manager/context-files/architecture-context-file'
import {
  OwnerContextFile,
  OWNER_CONTEXT_TTL_MS
} from '@/core/context-manager/context-files/owner-context-file'

export const DEFAULT_CONTEXT_REFRESH_TTL_MS = 10 * 60 * 1_000

export function createContextFiles(
  probeHelper: ContextProbeHelper,
  ttlMs: number,
  leonRuntimeResolvers: LeonRuntimeContextResolvers
): ContextFile[] {
  return [
    new OwnerContextFile(OWNER_CONTEXT_TTL_MS),
    new LeonContextFile(),
    new ArchitectureContextFile(),
    new LeonRuntimeContextFile(probeHelper, leonRuntimeResolvers, ttlMs),
    new HomeContextFile(ttlMs),
    new HostSystemContextFile(probeHelper, ttlMs),
    new WorkspaceIntelligenceContextFile(probeHelper, ttlMs),
    new ActivityContextFile(probeHelper, ttlMs),
    new HabitsContextFile(probeHelper, ttlMs),
    new MediaProfileContextFile(probeHelper, ttlMs),
    new BrowserHistoryContextFile(probeHelper, ttlMs),
    new LocalInventoryContextFile(probeHelper, ttlMs),
    new NetworkEcosystemContextFile(probeHelper, ttlMs),
    new StorageContextFile(probeHelper, ttlMs),
    new SystemResourcesContextFile(probeHelper, ttlMs),
    new GpuComputeContextFile(probeHelper, ttlMs)
  ]
}
