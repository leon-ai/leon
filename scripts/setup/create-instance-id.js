import fs from 'node:fs'

import { LEON_FILE_PATH } from '@/constants'
import { Telemetry } from '@/telemetry'

// TODO: export default
;(async () => {
  try {
    const { instanceID, birthDate } = await Telemetry.postinstall()

    if (!fs.existsSync(LEON_FILE_PATH)) {
      await fs.promises.writeFile(
        LEON_FILE_PATH,
        JSON.stringify(
          {
            instanceID,
            birthDate
          },
          null,
          2
        )
      )
    }

    // resolve()
  } catch (e) {
    // reject(new Error(`Failed to create instance ID: ${e}`))
  }
})()
