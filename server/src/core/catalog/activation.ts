import fs from 'node:fs'
import path from 'node:path'

import { CatalogDistribution } from '@/schemas/catalog-metadata-schemas'
import { FileHelper } from '@/helpers/file-helper'

export const CATALOG_INSTALLATION_FILENAME = '.installation.json'
const MAXIMUM_RECEIPT_BYTES = 1_024

/**
 * Bundled extension source is not an installation. Only an explicit profile
 * receipt activates it; disablement and connection state remain independent.
 */
export function isCatalogInstalled(distribution: CatalogDistribution | undefined, profileDirectory: string): boolean {
  if (distribution !== CatalogDistribution.Extension) {
    return true
  }
  try {
    const filename = path.join(profileDirectory, CATALOG_INSTALLATION_FILENAME)
    if (fs.statSync(filename).size > MAXIMUM_RECEIPT_BYTES) {
      return false
    }

    return JSON.parse(fs.readFileSync(filename, 'utf8')).installed === true
  } catch {
    return false
  }
}

/**
 * Keeps removal durable without deleting owner settings or authorization data.
 */
export async function setCatalogInstalled(profileDirectory: string, installed: boolean): Promise<void> {
  await FileHelper.writeAtomicJSON(path.join(profileDirectory, CATALOG_INSTALLATION_FILENAME), { installed })
}
