import os from 'node:os'

import axios from 'axios'
import osName from 'os-name'
import getos from 'getos'

import type { ShortLanguageCode } from '@/types'
import type {
  NEREntity,
  NLPAction,
  NLPDomain,
  NLPSkill,
  NLPUtterance
} from '@/core/nlp/types'
import {
  IS_TELEMETRY_ENABLED,
  INSTANCE_ID,
  IS_DEVELOPMENT_ENV,
  IS_PRODUCTION_ENV,
  LANG,
  LEON_VERSION,
  PYTHON_BRIDGE_VERSION,
  STT_PROVIDER,
  TCP_SERVER_VERSION,
  TTS_PROVIDER
} from '@/constants'
import { NER } from '@/core'
import { SystemHelper } from '@/helpers/system-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { LogHelper } from '@/helpers/log-helper'

interface PostIntallResponse {
  instanceID: string
  birthDate: number
}
interface UtteranceData {
  value: NLPUtterance
  entities: NEREntity[]
  triggeredDomain: NLPDomain
  triggeredSkill: NLPSkill
  triggeredAction: NLPAction
  probability: number
  language: ShortLanguageCode
  executionTime: number
}

enum EventNames {
  Heartbeat = 'HEARTBEAT',
  Stopped = 'STOPPED'
}

export class Telemetry {
  // private static readonly serviceURL = 'https://telemetry.getleon.ai'
  private static readonly serviceURL = 'http://localhost:3000'
  private static readonly instanceID = INSTANCE_ID
  private static readonly axios = axios.create({
    baseURL: this.serviceURL,
    timeout: 7_000
  })

  public static async postInstall(): Promise<PostIntallResponse> {
    const { data } = await this.axios.post('/on-post-install', {
      instanceID: this.instanceID
    })

    return data
  }

  public static async start(): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        const platform = os.platform()
        let distro = null

        if (platform === 'linux') {
          getos((e, os) => {
            if (e) {
              /* */
            }
            distro = os
          })
        }

        await this.axios.post('/on-start', {
          instanceID: this.instanceID,
          data: {
            isProduction: IS_PRODUCTION_ENV,
            isOnline: true,
            language: LANG,
            sttProvider: STT_PROVIDER,
            ttsProvider: TTS_PROVIDER,
            coreVersion: LEON_VERSION,
            pythonBridgeVersion: PYTHON_BRIDGE_VERSION,
            tcpServerVersion: TCP_SERVER_VERSION,
            environment: {
              osDetails: {
                type: os.type(),
                platform,
                arch: os.arch(),
                cpus: os.cpus().length,
                release: os.release(),
                osName: osName(),
                distro
              },
              totalRAMInGB: SystemHelper.getTotalRAM(),
              nodeVersion: SystemHelper.getNodeJSVersion(),
              npmVersion: SystemHelper.getNPMVersion()
            }
          }
        })
      } catch (e) {
        if (IS_DEVELOPMENT_ENV) {
          LogHelper.title('Telemetry')
          LogHelper.warning(
            `Failed to send start data to telemetry service: ${e}`
          )
        }
      }
    }
  }

  public static async utterance(data: UtteranceData): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        const {
          triggeredDomain,
          triggeredSkill,
          value,
          entities,
          triggeredAction,
          probability,
          language,
          executionTime
        } = data
        const skill = await SkillDomainHelper.getSkillInfo(
          triggeredDomain,
          triggeredSkill
        )

        await this.axios.post('/on-utterance', {
          instanceID: this.instanceID,
          data: {
            triggeredDomain,
            triggeredSkill,
            triggeredAction,
            probability,
            language,
            executionTime,
            value: NER.anonymizeEntities(value, entities),
            triggeredSkillVersion: skill.version,
            triggeredSkillBridge: skill.bridge
          }
        })
      } catch (e) {
        if (IS_DEVELOPMENT_ENV) {
          LogHelper.title('Telemetry')
          LogHelper.warning(
            `Failed to send utterance data to telemetry service: ${e}`
          )
        }
      }
    }
  }

  public static async error(error: string): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        await this.axios.post('/on-error', {
          instanceID: this.instanceID,
          error
        })
      } catch (e) {
        if (IS_DEVELOPMENT_ENV) {
          LogHelper.title('Telemetry')
          LogHelper.warning(`Failed to send error to telemetry service: ${e}`)
        }
      }
    }
  }

  public static async stop(): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        await this.sendEvent(EventNames.Stopped)
      } catch (e) {
        if (IS_DEVELOPMENT_ENV) {
          LogHelper.title('Telemetry')
          LogHelper.warning(
            `Failed to send stop event to telemetry service: ${e}`
          )
        }
      }
    }
  }

  public static async heartbeat(): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        await this.sendEvent(EventNames.Heartbeat)
      } catch (e) {
        if (IS_DEVELOPMENT_ENV) {
          LogHelper.title('Telemetry')
          LogHelper.warning(
            `Failed to send heartbeat event to telemetry service: ${e}`
          )
        }
      }
    }
  }

  private static async sendEvent(eventName: EventNames): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        await this.axios.post('/on-event', {
          instanceID: this.instanceID,
          eventName
        })
      } catch (e) {
        if (IS_DEVELOPMENT_ENV) {
          LogHelper.title('Telemetry')
          LogHelper.warning(`Failed to send event to telemetry service: ${e}`)
        }
      }
    }
  }
}
