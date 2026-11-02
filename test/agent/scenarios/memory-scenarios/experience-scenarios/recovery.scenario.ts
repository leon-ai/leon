import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

const DISTRACTOR_COUNT = 195
const OWNER_REQUEST = 'The report exporter in this workspace is stuck. Inspect README.md and the supported operations, recover the service, and verify that it is serving jobs. You are authorized to repair this isolated service.'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    const workspace = path.join(profilePath, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(workspace, 'README.md'), [
      '# Report exporter',
      'This isolated local service is operated with node service.mjs.',
      'Start with node service.mjs status. Use node service.mjs help for its supported operations.',
      'Only report recovery after status confirms that jobs are being served.'
    ].join('\n'))
    await fs.writeFile(path.join(workspace, 'service.mjs'), `
import fs from 'node:fs'
const operation = process.argv[2]
const descriptor = '.descriptor-current'
const serving = '.serving'
if (operation === 'help') {
  console.log('Operations: status, refresh-descriptor, resume. A stale descriptor must be refreshed before resume. Verify afterward with status.')
} else if (operation === 'status') {
  console.log(fs.existsSync(serving) ? 'Report exporter is serving jobs.' : 'Report exporter is stopped: its descriptor is stale. Inspect help for supported recovery operations.')
} else if (operation === 'refresh-descriptor') {
  fs.writeFileSync(descriptor, 'current')
  console.log('Descriptor refreshed; resume is now available.')
} else if (operation === 'resume' && fs.existsSync(descriptor)) {
  fs.writeFileSync(serving, 'serving')
  console.log('Report exporter resumed. Verify with status.')
} else {
  console.error('Operation refused; inspect status and help before changing state.')
  process.exitCode = 1
}
`)
  },

  async run({ profilePath, runTurn }) {
    const { EXPERIENCE_MANAGER, POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const { readInferenceUsage } = await import('@/core/llm-manager/llm-usage/usage-ledger')
    const previousWorkspace = process.cwd()
    const workspace = path.join(profilePath, 'workspace')
    process.chdir(workspace)

    try {
      const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
      await runTurnLifecycle({ sessionId, query: OWNER_REQUEST }, async () => {
        const first = await runTurn(OWNER_REQUEST, sessionId)
        assert.equal(first.finalIntent, 'answer', first.output)
        assert.equal(await fs.readFile(path.join(workspace, '.serving'), 'utf8'), 'serving')
        return { output: first.output, data: {
          finalIntent: first.finalIntent, executionHistory: first.executionHistory, workspace,
          agentResponseTrace: first.responseTrace
        } } as unknown as import('@/core/llm-manager/llm-duty').LLMDutyResult
      })
      await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
      const learned = EXPERIENCE_MANAGER.list()
      assert.equal(learned.length, 1, 'A verified recovery must yield a reusable experience without an explicit save request.')
      const experience = learned[0]!
      assert.ok(experience.sourceRef.includes(sessionId))
      assert.equal(experience.loadCount, 0)
      assert.equal(experience.useCount, 0)
      const experiencePath = path.join(profilePath, 'skills', 'agent', 'experiences', experience.id.split(':')[1]!, 'SKILL.md')
      assert.ok((await fs.readFile(experiencePath, 'utf8')).includes('resume'))

      // Archive pressure must not become prompt pressure. Current task matching
      // must surface an older procedure among newer unrelated methods.
      for (let index = 0; index < DISTRACTOR_COUNT; index += 1) {
        EXPERIENCE_MANAGER.save({
          name: `unrelated-catalog-${index}`,
          description: `Organize botanical specimen catalog ${index}.`,
          instructions: 'Check specimen accession numbers, sort labels, and verify the catalog.'
        }, `fixture:${index}`, ['fixture.catalog.sort'], workspace)
      }
      assert.equal(EXPERIENCE_MANAGER.list().length, 196)
      const startedAt = performance.now()
      const cards = EXPERIENCE_MANAGER.getContext(workspace, 'The report exporter is stuck again.')
      const snapshotMs = performance.now() - startedAt
      assert.ok(cards.length <= 3)
      assert.ok(Buffer.byteLength(JSON.stringify(cards), 'utf8') <= 500)
      assert.ok(cards.some((card) => card.id === experience.id))
      assert.ok(EXPERIENCE_MANAGER.search('report exporter descriptor recovery', workspace)
        .some((card) => card.id === experience.id))

      await fs.rm(path.join(workspace, '.serving'))
      await fs.rm(path.join(workspace, '.descriptor-current'))
      const second = await runTurn('The report exporter is stuck again. Get it serving jobs and verify the result.')
      assert.notEqual(second.sessionId, sessionId)
      assert.equal(second.historyBeforeTurn, 0)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal(await fs.readFile(path.join(workspace, '.serving'), 'utf8'), 'serving')
      const state = JSON.parse(await fs.readFile(path.join(profilePath, 'sessions', second.sessionId, '.agent-conversation-state.json'), 'utf8')) as {
        transcript: AgentToolTranscriptMessage[]
      }
      assert.ok(state.transcript.some((message) => message.role === 'user' &&
        JSON.stringify(message.runtimeContext?.['experience_context'] ?? []).includes(experience.id)),
      `The actual model transcript must receive the relevant experience card: ${JSON.stringify(state.transcript
        .filter((message) => message.role === 'user')
        .map((message) => ({
          contextKeys: Object.keys(message.runtimeContext ?? {}),
          workspace: message.runtimeContext?.['local_workspace'],
          experiences: message.runtimeContext?.['experience_context'],
          includesExperience: message.content.includes(experience.id)
        })))}`)
      const used = EXPERIENCE_MANAGER.list().find((record) => record.id === experience.id)!
      assert.ok(used.loadCount > 0, 'The fresh task must explicitly load its learned procedure.')
      assert.equal(used.useCount, 1, 'Executing the activated recovery counts once for the task.')
      const activities = second.progressMessages.filter((message) => message.id.includes(experience.id))
      assert.equal(activities.length, 2, 'Loading and first use must each publish an experience update.')
      assert.equal(activities[0]!.id, activities[1]!.id)
      assert.equal(activities[0]!.createdAt, activities[1]!.createdAt)
      assert.ok(activities.every((activity) => activity.iconName === 'brain-2-line'))
      assert.equal(activities[0]!.content, `Loaded experience: ${used.name}`)
      assert.equal(activities[1]!.content, `Used experience: ${used.name}`)
      assert.equal(second.responseTrace.progressMessages?.filter((message) => message.id === activities[0]!.id).length, 1,
        'The saved timeline must retain one item with the latest experience state.')

      assert.ok(!state.transcript.some((message) => message.content.includes(OWNER_REQUEST)))
      assert.ok(state.transcript.some((message) => message.role === 'tool' && message.content.includes(experience.id)))
      assert.ok(!state.transcript.some((message) => message.content.includes('unrelated-catalog-194') &&
        message.content.includes('unrelated-catalog-0') && message.content.includes('unrelated-catalog-100')))
      const usage = []
      for await (const record of readInferenceUsage({})) {
        usage.push(record)
      }
      assert.ok(usage.some((record) => record.purpose === InferencePurpose.Experience))
      return { experience: used, snapshotMs, discoveryBytes: Buffer.byteLength(JSON.stringify(cards)), second, usage }
    } finally {
      process.chdir(previousWorkspace)
      EXPERIENCE_MANAGER.close()
    }
  }
}

export default scenario
