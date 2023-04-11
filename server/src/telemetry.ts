import axios from 'axios'

import { INSTANCE_ID } from '@/constants'

const IS_TELEMETRY_ENABLED = process.env['LEON_TELEMETRY'] === 'true'

interface PostintallResponse {
  instanceID: string
  birthDate: number
}

export class Telemetry {
  // private static readonly serviceURL = 'https://telemetry.getleon.ai'
  private static readonly serviceURL = 'http://localhost:3000'
  private static readonly instanceID = INSTANCE_ID

  public static async postinstall(): Promise<PostintallResponse> {
    const { data } = await axios.post(`${this.serviceURL}/on-postinstall`, {
      instanceID: this.instanceID
    })

    return data
  }

  public static send(): void {
    if (IS_TELEMETRY_ENABLED) {
      // TODO
    }
  }
}
