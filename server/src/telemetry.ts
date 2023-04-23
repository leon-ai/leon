import os from 'node:os'

import type { Os } from 'getos'
import axios from 'axios'
import osName from 'os-name'
import getos from 'getos'

import type {
  NEREntity,
  NLPUtterance,
  NLUProcessResult,
  NLUResult
} from '@/core/nlp/types'
import {
  IS_TELEMETRY_ENABLED,
  INSTANCE_ID,
  IS_GITPOD,
  IS_DEVELOPMENT_ENV,
  IS_PRODUCTION_ENV,
  LANG,
  LEON_VERSION,
  PYTHON_BRIDGE_VERSION,
  STT_PROVIDER,
  TCP_SERVER_VERSION,
  TTS_PROVIDER
} from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { LogHelper } from '@/helpers/log-helper'

interface PostIntallResponse {
  instanceID: string
  birthDate: number
}

enum EventNames {
  Heartbeat = 'HEARTBEAT',
  Stopped = 'STOPPED'
}

export class Telemetry {
  private static readonly serviceURL = 'https://telemetry.getleon.ai'
  // private static readonly serviceURL = 'http://localhost:3000'
  private static readonly instanceID = INSTANCE_ID
  private static readonly axios = axios.create({
    baseURL: this.serviceURL,
    timeout: 7_000
  })

  public static async postInstall(): Promise<PostIntallResponse> {
    const { data } = await this.axios.post('/on-post-install', {
      instanceID: this.instanceID,
      isGitpod: IS_GITPOD
    })

    return data
  }

  public static async start(): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        const platform = os.platform()
        const data = {
          isProduction: IS_PRODUCTION_ENV,
          isGitpod: IS_GITPOD,
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
              distro: null as Os | null
            },
            totalRAMInGB: SystemHelper.getTotalRAM(),
            nodeVersion: SystemHelper.getNodeJSVersion(),
            npmVersion: SystemHelper.getNPMVersion()
          }
        }

        if (platform === 'linux') {
          getos(async (e, os) => {
            if (e) {
              /* */
            }
            data.environment.osDetails.distro = os

            await this.axios.post('/on-start', {
              instanceID: this.instanceID,
              data
            })
          })
        } else {
          await this.axios.post('/on-start', {
            instanceID: this.instanceID,
            data
          })
        }
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

  public static async utterance(
    processedData: NLUProcessResult | null
  ): Promise<void> {
    if (IS_TELEMETRY_ENABLED) {
      try {
        if (processedData?.classification) {
          const {
            classification: {
              domain: triggeredDomain,
              skill: triggeredSkill,
              action: triggeredAction,
              confidence: probability
            },
            utterance,
            entities
          } = processedData as NLUResult
          const skill = await SkillDomainHelper.getSkillInfo(
            triggeredDomain,
            triggeredSkill
          )

          await this.axios.post('/on-utterance', {
            instanceID: this.instanceID,
            data: {
              triggeredDomain: triggeredDomain || null,
              triggeredSkill: triggeredSkill || null,
              triggeredAction: triggeredAction || null,
              probability,
              language: processedData?.lang || null,
              processingTime: processedData?.processingTime || 0,
              executionTime: processedData?.executionTime || 0,
              nluProcessingTime: processedData?.nluProcessingTime || 0,
              value: this.anonymizeEntities(utterance, entities) || utterance,
              triggeredSkillVersion: skill.version || null,
              triggeredSkillBridge: skill.bridge || null
            }
          })
        } else if (JSON.stringify(processedData) !== JSON.stringify({})) {
          // Not in a skill loop
          await this.axios.post('/on-utterance', {
            instanceID: this.instanceID,
            data: {
              language: processedData?.lang || null,
              value: processedData?.utterance
            }
          })
        }
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
          error: SystemHelper.sanitizeUsername(error)
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

  private static anonymizeEntities(
    utterance: NLPUtterance,
    entities: NEREntity[]
  ): NLPUtterance {
    entities.forEach((entity) => {
      utterance = utterance.replace(entity.sourceText, `{${entity.entity}}`)
    })

    return utterance
  }
}
