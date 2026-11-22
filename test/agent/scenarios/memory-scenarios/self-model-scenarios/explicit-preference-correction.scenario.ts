import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const OLD_THEORY = 'The owner generally prefers concise one-sentence responses.'
const OLD_FOCUS = 'Keep every owner answer to one sentence.'
const PRINCIPLE = 'I verify arithmetic before reporting totals.'

const scenario: RealAgentScenario = {
  async run() {
    const { CONFIG_MANAGER } = await import('@/config')
    await CONFIG_MANAGER.setValue(['runtime', 'private_diary_enabled'], true)
    const { default: SelfModelManager } = await import('@/core/self-model-manager/self-model-manager')
    const { readInferenceUsage } = await import('@/core/llm-manager/llm-usage/usage-ledger')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const { getProfilePaths } = await import('@/core/profile-runtime/profile-paths')
    const { buildOwnerDocument, getOwnerContextPath, normalizeOwnerProfile } = await import('@/core/context-manager/owner-profile')
    const root = path.join(getProfilePaths().context, 'private')
    const statePath = path.join(root, '.leon-private-self-model.json')
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(getOwnerContextPath(), buildOwnerDocument(normalizeOwnerProfile({
      interactionPreferences: ['Generally prefers detailed, well-developed explanations unless explicitly asking for brevity.']
    })))
    await fs.writeFile(statePath, JSON.stringify({
      version: 1, currentFocus: [OLD_FOCUS], workingTheories: [OLD_THEORY],
      behavioralPrinciples: [{ text: PRINCIPLE, confidence: 0.9, seenCount: 2 }]
    }))
    const manager = new SelfModelManager()
    await manager.observeTurn({
      route: 'react',
      userMessage: 'My earlier request for one sentence applied only to that particular question. In general, I prefer detailed, well-developed explanations unless I explicitly request brevity.',
      assistantMessage: 'I will use detailed explanations by default and keep brief answers for explicit requests.'
    })
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    const usage = []
    for await (const record of readInferenceUsage({})) {
      if (record.purpose === InferencePurpose.SelfModel) {
        usage.push(record.usage)
      }
    }
    assert.ok(!state.workingTheories.includes(OLD_THEORY), JSON.stringify({ state, usage }))
    assert.ok(!state.currentFocus.includes(OLD_FOCUS))
    assert.ok(manager.getSnapshot().includes(PRINCIPLE))
    const diary = await fs.readFile(manager.getDiaryPath(), 'utf8')
    assert.ok(!diary.includes(OLD_THEORY))

    return { state, snapshot: manager.getSnapshot(), usage }
  }
}

export default scenario
