import type { Route } from '@playwright/test'
import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'
import { AURORA_FORM_SPEC, AURORA_GENERATED_SPEC, AURORA_CALCULATOR_SPEC, AURORA_PRESENTATION_SPEC, AURORA_RETIRED_RESULTS_SPEC, auroraParts } from '../../fixtures/aurora'
import type { ConversationRecord } from '../../../apps/web/src/data/conversation'
import { PreparationStatus } from '../../../aurora/src/v2/contracts/preparation'

test('updates measured preparation on its original tool call and cancels only after server acknowledgement', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = ''
  answer.isAddedToHistory = false
  const preparation = { status: PreparationStatus.Downloading, detail: 'Downloading the speech model',
    executionId: 'speech-preparation', completed: 40, total: 100 }
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [{
    id: 'speech-call', name: 'speech.asr.transcribe', status: 'running', startedAt: Date.now(),
    toolCallTitle: 'Transcribe the recording', toolkitName: 'Speech', toolName: 'Speech recognition', preparation
  }] }
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  const pending = Promise.withResolvers<Route>()
  let cancellations = 0
  await page.route('**/api/v1/tool-executions/cancel', async (route) => {
    cancellations += 1
    expect(route.request().postDataJSON()).toEqual({ sessionId: SESSION_ID, executionId: preparation.executionId })
    pending.resolve(route)
  })
  await page.goto(SESSION_URL)
  const widget = page.getByRole('region', { name: 'Getting files ready', exact: true })
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '40')
  const event = { session_id: SESSION_ID, turn_id: null, response_id: answer.messageId, created_at: Date.now() }
  const tool = { id: 'speech-call', name: 'speech.asr.transcribe', status: 'running', preparation }
  await ui.emit([{ ...event, sequence: 1, type: 'tool_call', data: { tool_call: {
    ...tool, preparation: { ...preparation, completed: 65 }
  } } }])
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '65')
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click()
  const route = await pending.promise
  await expect(widget.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect(widget.getByRole('progressbar')).toBeVisible()
  await route.fulfill({ json: { execution: { state: 'canceled' } } })
  await expect(page.getByText('I cancelled the preparation', { exact: true })).toBeVisible()
  const cancelled = { ...preparation, status: PreparationStatus.Cancelled, detail: 'The preparation was cancelled.' }
  await ui.emit([{ ...event, sequence: 2, type: 'tool_call', data: { tool_call: { ...tool, status: 'error', preparation: cancelled } } }])
  await page.getByRole('button', { name: 'Used 1 tool', exact: false }).click()
  await expect(widget).toContainText('The preparation was cancelled.')
  await expect(widget.getByRole('progressbar')).toHaveCount(0)
  expect(cancellations).toBe(1)
})

test('keeps retained preparation updates separate from accepted answer text and turn timing', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = 'The model is downloading. We can keep talking while it finishes.'
  const preparation = { status: PreparationStatus.Downloading, detail: 'Downloading the speech model',
    executionId: 'retained-preparation', completed: 25, total: 100 }
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [{
    id: 'retained-call', name: 'speech.asr.transcribe', status: 'running', startedAt: Date.now(),
    toolCallTitle: 'Prepare the speech model', preparation
  }], metrics: { durationMs: 7_000 } }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 7s', exact: true }).click()
  const widget = page.getByRole('region', { name: 'Getting files ready', exact: true })
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '25')
  await ui.emit([{ type: 'tool_call', sequence: 1, session_id: SESSION_ID, turn_id: null,
    response_id: answer.messageId, created_at: Date.now(), data: { tool_call: {
      id: 'retained-call', name: 'speech.asr.transcribe', status: 'running', preparation: { ...preparation, completed: 75 }
    } } }])
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '75')
  await expect(page.getByRole('button', { name: 'Worked for 7s', exact: true })).toBeVisible()
  await expect(page.getByText(answer.message, { exact: true })).toBeVisible()
  await ui.emit([{ type: 'tool_call', sequence: 2, session_id: SESSION_ID, turn_id: null,
    response_id: 'unloaded-answer', created_at: Date.now(), data: { background: true, tool_call: {
      id: 'other-call', name: 'speech.asr.transcribe', status: 'running', preparation
    } } }])
  await expect(page.getByRole('button', { name: 'Worked for', exact: false })).toHaveCount(1)
})
