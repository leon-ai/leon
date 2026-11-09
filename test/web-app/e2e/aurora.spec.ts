import type { Route } from '@playwright/test'
import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'
import { AURORA_FORM_SPEC, AURORA_GENERATED_SPEC, AURORA_CALCULATOR_SPEC, AURORA_PRESENTATION_SPEC, AURORA_RETIRED_RESULTS_SPEC, auroraParts } from '../../fixtures/aurora'
import type { ConversationRecord } from '../../../apps/web/src/data/conversation'
import { PreparationStatus } from '../../../aurora/src/v2/contracts/preparation'

test('replays active data widgets and retired results without sending owner commands', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const spec = structuredClone(AURORA_PRESENTATION_SPEC)
  const root = spec.elements[spec.root]!
  if (root.type !== 'Stack') {
    throw new Error('The data fixture requires a stack.')
  }
  root.children.unshift('results')
  spec.elements['results'] = AURORA_RETIRED_RESULTS_SPEC.elements['results']!
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
  const commands: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      commands.push(new URL(request.url()).pathname)
    }
  })
  await page.goto(SESSION_URL)
  const table = page.getByRole('region', { name: 'Reading notes', exact: true })
  await expect(table.getByRole('row')).toHaveCount(13)
  await table.getByRole('searchbox').fill('Day 16')
  await expect(table.getByRole('cell', { name: '80', exact: true })).toBeVisible()
  await page.getByRole('switch', { name: 'Only differences' }).check()
  await expect(page.getByRole('cell', { name: 'Kitchen', exact: true })).toHaveCount(0)
  const chart = page.getByRole('region', { name: 'A little time to read', exact: true })
  await expect(chart.locator('canvas')).toBeVisible()
  await chart.getByText('View data', { exact: true }).click()
  await expect(chart.getByRole('cell', { name: '45', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'A few places to begin', exact: true })).toContainText('https://github.com/leon-ai/leon')
  await expect(chart.locator('canvas')).toBeVisible()
  expect(commands).toEqual([])
})

test('runs a bespoke chart, retains local state and confirms declared submissions outside the sandbox', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.answerParts = auroraParts(history.at(-2)!.messageId, AURORA_GENERATED_SPEC)
  const requests: { id: string, values: Record<string, string> }[] = []
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages/${answer.messageId}/ui`, async (route) => {
    const body = route.request().postDataJSON()
    requests.push(body)
    const part = answer.answerParts![0]!
    if (part.kind === 'ui') {
      part.surface.receipts['reading'] = { commandId: body.id, revision: 1, values: body.values, submittedAt: Date.now() }
    }
    await route.fulfill({ json: { answerParts: answer.answerParts } })
  })
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A little room for reading"]')
  await expect(frame.locator('canvas')).toBeVisible()
  await frame.getByRole('slider', { name: 'Daily reading goal' }).fill('45')
  await expect(frame.locator('#week-total')).toContainText('315 minutes')
  await page.reload()
  await expect(frame.getByRole('slider', { name: 'Daily reading goal' })).toHaveValue('45')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(frame.locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await frame.getByRole('button', { name: 'Plan around this goal', exact: true }).click()
  const send = page.getByRole('button', { name: 'Send selection', exact: true })
  await expect(send).toBeVisible()
  expect(requests).toEqual([])
  await send.click()
  await expect(page.getByText('Sent. Thank you.', { exact: true })).toBeVisible()
  await expect(send).toBeDisabled()
  expect(requests).toHaveLength(1)
  expect(requests[0]!.values).toEqual({ minutes: '45' })
  await page.reload()
  await expect(send).toBeDisabled()
  expect(requests).toHaveLength(1)
})

test('leaves draft and obsolete controls inactive while keeping legacy text answers readable', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const original = history.at(-1)!
  original.answerParts = auroraParts(history.at(-2)!.messageId)
  history.push({ who: 'owner', messageId: 'later-owner', message: 'Let’s do something else.', sentAt: Date.now(), isAddedToHistory: true }, {
    who: 'leon', messageId: 'later-owner:leon', message: 'Of course. There’s no rush.', sentAt: Date.now() + 1, isAddedToHistory: true
  })
  await page.goto(SESSION_URL)
  await expect(page.getByText('Of course. There’s no rush.', { exact: true })).toBeVisible()
  const choice = page.getByRole('region', { name: 'How would you like to start?', exact: true })
  await expect(choice.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await expect(choice.getByRole('radio').first()).toBeDisabled()
  await expect(page.getByText('This question is no longer active.', { exact: true })).toBeVisible()
  const pending: ConversationRecord = { who: 'leon', messageId: 'later-owner:leon', message: '', sentAt: Date.now() + 2,
    isAddedToHistory: false, answerParts: auroraParts('later-owner') }
  const part = pending.answerParts![0]!
  if (part.kind === 'ui') {
    part.surface.status = 'draft'
  }
  history[history.length - 1] = pending
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.reload()
  const drafting = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(drafting.getByRole('radio').first()).toBeDisabled()
  await expect(drafting.getByText('Getting this ready…')).toBeVisible()
})

test('streams Markdown beside native surfaces without waiting for the final response', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.message = ''
  answer.isAddedToHistory = false
  answer.answerParts = auroraParts(history.at(-2)!.messageId)
  const part = answer.answerParts[0]!
  if (part.kind === 'ui') {
    part.surface.status = 'draft'
    part.surface.purpose = 'answer'
  }
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.goto(SESSION_URL)
  await expect(page.getByRole('region', { name: 'How would you like to start?', exact: true })).toBeVisible()
  const event = { sequence: 1, session_id: SESSION_ID, turn_id: null, response_id: answer.messageId, created_at: Date.now() }
  await ui.emit([{ ...event, type: 'text_stream', data: { kind: 'answer', generationId: 'live-answer', token: 'A new idea is taking shape.' } }])
  await expect(page.getByText('A new idea is taking shape.', { exact: true })).toBeVisible()
  await ui.emit([{ ...event, sequence: 2, type: 'answer_parts', data: { answer_parts: structuredClone(answer.answerParts) } }])
  await expect(page.getByText('A new idea is taking shape.', { exact: true })).toBeVisible()
  await ui.emit([{ ...event, sequence: 3, type: 'text_stream', data: { kind: 'answer', generationId: 'live-answer', reset: true } }])
  await expect(page.getByText('A new idea is taking shape.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'How would you like to start?', exact: true })).toBeVisible()
  await ui.emit([{ ...event, sequence: 4, type: 'error', data: { message: 'I could not finish this answer. Please try again.' } }])
  await expect(page.getByRole('region', { name: 'Session messages', exact: true })
    .getByText('I could not finish this answer. Please try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'How would you like to start?', exact: true })
    .getByRole('radio').first()).toBeDisabled()
})

test('places retained files once, between native text inside the final answer', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  const url = `/api/v1/artifacts/${SESSION_ID}/garden-plan`
  answer.artifacts = [{ id: 'garden-plan', session_id: SESSION_ID, filename: 'garden.pdf',
    mime_type: 'application/pdf', size_bytes: 2_048, created_at: Date.now(), source: 'fixture', url }]
  answer.answerParts = auroraParts(history.at(-2)!.messageId, {
    root: 'layout', elements: {
      layout: { type: 'Stack', props: {}, children: ['intro', 'files', 'closing'] },
      intro: { type: 'Text', props: { text: 'Here is a little garden plan.' } },
      files: { type: 'Artifacts', props: { title: 'Your garden plan', artifactIds: ['garden-plan'] } },
      closing: { type: 'Text', props: { text: 'There is room to make it your own.' } }
    }
  })
  history.push({ who: 'leon', messageId: 'artifacts:fixture', message: '', sentAt: Date.now(),
    isAddedToHistory: true, artifacts: answer.artifacts })
  await page.goto(SESSION_URL)
  const response = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  const files = response.getByRole('region', { name: 'Your garden plan', exact: true })
  await expect(files.getByRole('figure')).toContainText('garden.pdf')
  await expect(page.getByRole('figure')).toHaveCount(1)
  await expect(files.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', `${url}?download=true`)
  await expect(files.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute('href', url)
  const introText = response.getByText('Here is a little garden plan.', { exact: true })
  const closingText = response.getByText('There is room to make it your own.', { exact: true })
  await expect(introText).toBeVisible()
  await expect(closingText).toBeVisible()
  const intro = await introText.boundingBox()
  const file = await files.boundingBox()
  const closing = await closingText.boundingBox()
  expect(intro!.y).toBeLessThan(file!.y)
  expect(file!.y).toBeLessThan(closing!.y)
})

for (const form of [false, true]) {
  test(`keeps ${form ? 'form details' : 'choices'} readable when the optional renderer cannot load`, async ({ page, ui }) => {
    const history = ui.history.get(SESSION_ID)!
    const answer = history.at(-1)!
    answer.answerParts = auroraParts(history.at(-2)!.messageId, form ? AURORA_FORM_SPEC : undefined)
    await page.route('**/assets/aurora-surface-*.js', (route) => route.abort())
    await page.goto(SESSION_URL)
    await expect(page.getByText('I couldn’t display the interactive version. You can still read it here and reply below.', { exact: true })).toBeVisible()
    const question = page.getByRole('region', { name: form ? 'A little project' : 'How would you like to start?', exact: true })
    await expect(question).toBeVisible()
    await expect(question.getByRole('button')).toHaveCount(0)
    await expect(question.getByRole('listitem')).toContainText(form
      ? ['Project name', 'Pace', 'Notes'] : ['A quiet morning', 'Something creative'])
    if (form) {
      await expect(question).toContainText('A gentle pace')
      await expect(question).toContainText('A focused afternoon')
    }
    const composer = page.getByRole('textbox', { name: 'Message Leon', exact: true })
    await composer.fill('Here is my answer.')
    await expect(composer).toHaveValue('Here is my answer.')
  })
}

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
