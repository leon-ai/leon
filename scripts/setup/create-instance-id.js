import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'

import { LEON_FILE_PATH } from '@/constants'
import { FileHelper } from '@/helpers/file-helper'

import { createSetupStatus } from './setup-status'

export default async () => {
  const status = createSetupStatus('Checking instance ID...').start()

  try {
    const identity = { instanceID: randomUUID(), birthDate: Date.now() }

    // Profile setup can run in parallel, but there is one identity per installation.
    try {
      await FileHelper.writeAtomicJSON(LEON_FILE_PATH, identity, { exclusive: true })
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }

      // An installation may have metadata without an assigned ID. All repairers
      // must use the same candidate, even when a setup attempt was interrupted.
      const metadata = JSON.parse(await fs.readFile(LEON_FILE_PATH, 'utf8'))
      if (typeof metadata.instanceID !== 'string' || !metadata.instanceID) {
        const repairPath = `${LEON_FILE_PATH}.identity-repair`
        try {
          await FileHelper.writeAtomicJSON(repairPath, identity, { exclusive: true })
        } catch (error) {
          if (error.code !== 'EEXIST') {
            throw error
          }
        }

        const repair = JSON.parse(await fs.readFile(repairPath, 'utf8'))
        await FileHelper.writeAtomicJSON(LEON_FILE_PATH, {
          ...metadata, instanceID: repair.instanceID, birthDate: metadata.birthDate ?? repair.birthDate
        })
      }
    }

    status.succeed('Instance ID: ready')
  } catch (error) {
    status.warn(`Failed to create the instance ID: ${error}`)
  }
}
