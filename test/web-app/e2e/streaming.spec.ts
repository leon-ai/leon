import type { ElementHandle, Locator } from '@playwright/test'
import type { ConversationEvent, ConversationRecord } from '../../../apps/web/src/data/conversation'
import { TurnPhase } from '../../../server/src/core/llm-manager/turn-timing-contract'
import type { SessionStatus } from '../../../apps/web/src/data/sessions'
import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'

test('replaces send with a danger stop action without submitting or losing the draft', async ({ page, ui }) => {
  const stopPath = `/api/v1/sessions/${SESSION_ID}/stop`
  await page.route(`**${stopPath}`, (route) => route.fulfill({ json: { success: true } }))
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  const send = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(composer).toBeFocused()
  const sendBounds = await send.boundingBox()
  expect(sendBounds).not.toBeNull()
  let sequence = 0
  const emit = async (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
    type, data, sequence: ++sequence, session_id: SESSION_ID,
    turn_id: 'active-turn', response_id: 'active-response', created_at: Date.now()
  }])

  await emit('turn_status', { status: 'accepted' })
  const stop = page.getByRole('button', { name: 'Stop this turn', exact: true })
  await expect(stop).toBeEnabled()
  await expect(send).toHaveCount(0)
  await expect(stop).toHaveClass(/button-danger/)
  await expect(stop).toHaveAttribute('type', 'button')
  await expect(stop.locator('.ri-stop-mini-fill')).toBeVisible()
  await stop.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Stop this turn')
  await composer.hover()
  const stopBounds = await stop.boundingBox()
  expect(stopBounds?.width).toBe(sendBounds!.width)
  expect(stopBounds?.height).toBe(sendBounds!.height)

  await composer.fill('Draft for later')
  const stopped = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === stopPath
  )
  await stop.click()
  await stopped
  await expect(composer).toHaveValue('Draft for later')
  expect(ui.requests.filter((url) => url.pathname.endsWith('/messages'))).toHaveLength(0)
  await emit('session_changed', { is_running: false })
  await expect(stop).toHaveCount(0)
  await expect(send).toBeEnabled()
  await expect(send.locator('.ri-send-ins-line')).toBeVisible()
  await expect(composer).toHaveValue('Draft for later')
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {

  test(`reveals tool previews only when their action title is available (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const startedAt = Date.now()
    let sequence = 0
    const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'title-owner', response_id: 'title-response', created_at: startedAt + sequence
    }])
    const tool = { id: 'weather-preview', name: 'weather.openmeteo.getWeather' }
    const group = page.getByRole('region', { name: 'Leon’s tool usage', exact: true })
    await emit('turn_status', { status: 'accepted' })
    for (const title of [undefined, '', ' ', tool.name]) {
      await emit('tool_call', { tool_call: {
        ...tool, status: 'preparing', input: '{"location":',
        ...(title === undefined ? {} : { tool_call_title: title })
      } })
      await expect(group).toContainText('Preparing tool calls...')
      await expect(group.locator('.activity-wave-active')).toHaveCount(1)
      await expect(group.locator('.tool-call')).toHaveCount(0)
      await expect(group.getByRole('button')).toHaveCount(0)
      await expect(group.getByText(tool.name, { exact: true })).toHaveCount(0)
    }

    const originalGroup = await group.elementHandle()
    await emit('tool_call', { tool_call: {
      ...tool, status: 'preparing', tool_call_title: 'Check tomorrow’s weather',
      input: '{"location":"Haarlem"}'
    } })
    const row = group.locator('.tool-call')
    await expect(row).toHaveCount(1)
    await expect(row.locator('.tool-call-title')).toHaveText('Check tomorrow’s weather')
    expect(await originalGroup!.evaluate((element) => element.isConnected)).toBe(true)
    const originalRow = await row.elementHandle()
    await emit('tool_call', { tool_call: { ...tool, status: 'running' } })
    await expect(row.locator('.tool-call-title')).toHaveText('Check tomorrow’s weather')
    expect(await originalRow!.evaluate((element) => element.isConnected)).toBe(true)

    // A call that executes without a title still needs a readable, inspectable row.
    await emit('tool_call', { tool_call: {
      id: 'untitled-execution', name: tool.name, status: 'running'
    } })
    await expect(group.locator('.tool-call-title')).toHaveText(['Check tomorrow’s weather', 'Get Weather'])
    await expect(group.getByText(tool.name, { exact: true })).toHaveCount(0)

    await emit('plan_step', { step: { id: 'weather-step', label: 'Compare forecasts', status: 'in_progress' } })
    const nested = { ...tool, id: 'planned-preview', step_label: 'Compare forecasts', status: 'preparing' }
    await emit('tool_call', { tool_call: nested })
    const step = page.locator('.task-list-item')
    await expect(step).toContainText('Compare forecasts')
    await expect(step.locator('.tool-call')).toHaveCount(0)
    await expect(step.getByRole('button', { name: 'Preparing tool calls...', exact: true })).toHaveCount(0)
    await emit('tool_call', { tool_call: { ...nested, tool_call_title: 'Compare tomorrow’s forecasts' } })
    await expect(step.locator('.tool-call-title')).toHaveText('Compare tomorrow’s forecasts')

    await originalRow?.dispose()
    await originalGroup?.dispose()
  })

  test(`shows live reviews with stable copy, snapshot recovery and completed accounting (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    let sequence = 0
    const createdAt = Date.now()
    const responseId = 'review-response'
    const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'review-owner', response_id: responseId, created_at: createdAt + sequence
    }])
    const activity = { id: 'd', goal: TurnPhase.Review, startedAt: createdAt + 10, durationMs: 0, outcome: 'started' }
    await emit('owner_message', { message: {
      who: 'owner', messageId: 'review-owner', message: 'Review the result.', sentAt: createdAt, isAddedToHistory: true
    } })
    await emit('turn_status', { status: 'accepted' })
    await emit('text_stream', { kind: 'reasoning', generationId: 'earlier-thought', token: 'Earlier public thinking.' })
    await emit('inference_activity', { activity })
    const processing = page.getByRole('region', { name: 'Leon’s processing', exact: true }).last()
    const review = page.getByRole('region', { name: 'Leon’s inference', exact: true })
    await expect(processing).toHaveCount(0)
    await expect(review).toHaveCount(1)
    await expect(review.getByRole('button')).toHaveCount(0)
    await expect(review.locator('.process-group-title')).toHaveText('Reviewing...')
    await expect(review.locator('.ri-search-eye-line')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Leon’s work', exact: true })).toHaveCount(0)
    await expect(page.getByText('Thinking...', { exact: true })).toHaveCount(0)
    await emit('metrics', { metrics: { durationMs: 500 } })
    await expect(review.locator('.process-group-title')).toHaveText('Reviewing...')
    await expect(review.locator('.activity-wave')).toHaveClass(/activity-wave-active/)

    ui.sessions[0]!.status = 'wip' as SessionStatus
    ui.history.get(SESSION_ID)!.push({
      who: 'owner', messageId: 'review-owner', message: 'Review the result.', sentAt: createdAt, isAddedToHistory: true
    }, {
      who: 'leon', messageId: responseId, message: '', sentAt: createdAt + 1, isAddedToHistory: false,
      agentResponseTrace: { id: responseId, planSteps: [], toolCalls: [], timings: [{ ...activity, kind: 'inference' }] }
    })
    await page.reload()
    await expect(review.locator('.process-group-title')).toHaveText('Reviewing...')
    const finished = { ...activity, durationMs: 3_000, outcome: 'completed' }
    await emit('inference_activity', { activity: finished })
    await expect(review).toHaveCount(0)
    await expect(processing).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Leon’s work', exact: true })).toBeVisible()
    const saved = ui.history.get(SESSION_ID)!.at(-1)!
    saved.message = 'Reviewed and ready.'
    saved.isAddedToHistory = true
    saved.llmMetrics = { durationMs: 5_000 }
    saved.agentResponseTrace!.timings = [{ ...finished, kind: 'inference' }]
    await emit('final_answer', { content: saved.message, response_trace: saved.agentResponseTrace })
    ui.sessions[0]!.status = 'idle' as SessionStatus
    await emit('session_changed', { is_running: false })
    const work = page.getByRole('region', { name: 'Leon’s completed work', exact: true }).last()
    await expect(work.getByRole('button', { name: 'Worked for 5s', exact: true })).toBeVisible()
    await page.reload()
    await work.getByRole('button', { name: 'Worked for 5s', exact: true }).click()
    await processing.getByRole('button', { name: 'Processed for 3s', exact: true }).click()
    await expect(review.locator('.process-group-title')).toHaveText('Reviewed for 3s')
    await expect(review.locator('.activity-wave-active')).toHaveCount(0)
  })

  test(`hands off one visible status to tools and thinking without delayed tool entrances (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    let sequence = 0
    const startedAt = Date.now()
    const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'handoff-owner', response_id: 'handoff-response', created_at: startedAt + sequence
    }])
    const waiting = page.getByRole('region', { name: 'Leon’s work', exact: true })
    const inference = page.getByRole('region', { name: 'Leon’s inference', exact: true })
    const tool = {
      id: 'handoff-tool', name: 'search_web.hosted.searchWeb', tool_call_title: 'Search the web'
    }
    const request = {
      id: 'd', goal: TurnPhase.Request, startedAt, durationMs: 0, outcome: 'started'
    }

    await emit('turn_status', { status: 'accepted' })
    await emit('inference_activity', { activity: request })
    await expect(inference).toBeVisible()
    await emit('tool_call', { tool_call: { ...tool, status: 'preparing' } })
    const execution = page.locator('.leon-message-execution').last()
    await expect(execution.getByRole('button', { name: 'Preparing tool calls...', exact: true })).toBeVisible()
    await expect(execution).toHaveCSS('animation-delay', '0s')
    await expect(execution).toHaveCSS('animation-name',
      reducedMotion === 'reduce' ? 'none' : 'leon-message-execution-enter')
    await expect(inference).toHaveCount(0)
    await expect(waiting).toHaveCount(0)
    await emit('inference_activity', { activity: { ...request, outcome: 'completed', durationMs: 100 } })
    await emit('tool_call', { tool_call: { ...tool, status: 'running' } })
    await expect(execution.getByRole('button', { name: 'Using tools...', exact: true })).toBeVisible()
    await expect(waiting).toHaveCount(0)
    await emit('tool_call', { tool_call: { ...tool, status: 'success', duration_ms: 100 } })
    await expect(waiting).toBeVisible()

    const next = { ...request, id: 'dd', startedAt: startedAt + sequence + 1 }
    await emit('inference_activity', { activity: next })
    await expect(inference).toBeVisible()
    await expect(waiting).toHaveCount(0)
    await emit('text_stream', {
      kind: 'reasoning', generationId: 'handoff-thinking', phase: 'agent', token: 'Checking the result.'
    })
    await expect(page.getByRole('button', { name: 'Thinking...', exact: true })).toBeVisible()
    await expect(inference).toHaveCount(0)
    await expect(waiting).toHaveCount(0)
    await emit('tool_call', { tool_call: { ...tool, id: 'followup-tool', status: 'preparing' } })
    const thought = page.getByRole('region', { name: 'Leon’s thinking', exact: true }).last()
    await expect(thought.getByRole('button', { name: 'Thought', exact: true })).toBeVisible()
    await expect(thought).not.toContainText('Thought for 0')
    await emit('inference_activity', { activity: { ...next, outcome: 'completed', durationMs: 618 } })
    await expect(thought.getByRole('button', { name: 'Thought for 618ms', exact: true })).toBeVisible()
    await emit('tool_call', { tool_call: { ...tool, id: 'followup-tool', status: 'success', duration_ms: 100 } })
    await expect(waiting).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thinking...', exact: true })).toHaveCount(0)

    const review = { ...request, id: 'ddd', goal: TurnPhase.Review, startedAt: startedAt + sequence + 1 }
    await emit('inference_activity', { activity: review })
    await expect(inference.locator('.process-group-title')).toHaveText('Reviewing...')
    await expect(waiting).toHaveCount(0)
    await emit('inference_activity', { activity: { ...review, outcome: 'completed', durationMs: 100 } })
    await expect(waiting).toBeVisible()
    await emit('final_answer', { content: 'The result is ready.' })
    await expect(waiting).toHaveCount(0)
    await expect(inference).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()).toBeVisible()
  })

  test(`keeps character reveals alive across real SSE chunks and completion (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
    let sequence = 0
    const responseId = 'live-response'
    const createdAt = Date.now()
    const emit = async (type: string, data: Record<string, unknown>): Promise<void> => {
      const event: ConversationEvent = {
        type, data, sequence: ++sequence, session_id: SESSION_ID,
        turn_id: 'live-owner', response_id: responseId, created_at: createdAt + sequence
      }
      await ui.emit([event])
    }
    const checkAppend = async (target: Locator, append: () => Promise<void>): Promise<void> => {
      const first = target.locator('.streaming-text-characters > span').first()
      await expect(first).toHaveClass('streaming-text-character-new')
      if (reducedMotion === 'no-preference') {
        await expect(first).toHaveCSS('animation-duration', '0.42s')
        await expect.poll(() => first.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).not.toBeNull()
        const startedAt = await first.evaluate((element) => element.getAnimations()[0]!.startTime)
        await append()
        await expect(first).toHaveClass('streaming-text-character-new')
        expect(await first.evaluate((element) => element.getAnimations()[0]!.startTime)).toBe(startedAt)
      } else {
        await append()
        await expect(first).toHaveCSS('animation-name', 'none')
        await expect(first).toHaveCSS('opacity', '1')
      }
    }

    await emit('owner_message', { message: { who: 'owner', messageId: 'live-owner', message: 'Stream this reply.', sentAt: createdAt, isAddedToHistory: true } })
    await emit('turn_status', { status: 'accepted' })
    await emit('text_stream', { kind: 'answer', generationId: 'waiting-answer', token: '', reset: true })
    const working = page.getByRole('region', { name: 'Leon’s work', exact: true })
    await expect(working).toHaveText('Putting this together...')
    await expect(working.locator('.process-group-indicator, i, svg')).toHaveCount(0)
    await emit('metrics', { metrics: { durationMs: 100 } })
    await expect(working).toHaveText('Putting this together...')
    await expect(page.getByText('Thinking...', { exact: true })).toHaveCount(0)
    await emit('text_stream', { kind: 'reasoning', generationId: 'live-thinking', token: 'Checking ' })
    const thinking = page.getByRole('region', { name: 'Leon’s thinking' }).last()
    await expect(thinking).toContainText('Thinking...')
    await checkAppend(thinking, async () => {
      await emit('text_stream', { kind: 'reasoning', generationId: 'live-thinking', token: 'the details.' })
      await expect(thinking.locator('.thinking-message-details')).toHaveAttribute('aria-label', 'Checking the details.')
    })
    await emit('text_stream', { kind: 'answer', generationId: 'provisional-answer', token: 'I will look this up.' })
    await expect(page.getByText('Thinking...', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Leon’s final answer' }).last()).toContainText('I will look this up.')
    await emit('progress_message', { message: { id: 'live-progress', content: 'Looking ', created_at: createdAt + sequence } })
    const progress = page.locator('.leon-message-summary').last()
    await checkAppend(progress, async () => {
      await emit('progress_message', { message: { id: 'live-progress', content: 'Looking closer.', created_at: createdAt + sequence } })
      await expect(progress.locator('[aria-label]')).toHaveAttribute('aria-label', 'Looking closer.')
    })
    await emit('text_stream', { kind: 'answer', generationId: 'live-answer', token: 'Hello ' })
    const answer = page.getByRole('region', { name: 'Leon’s final answer' }).last()
    const finalText = `Hello ${'world. '.repeat(32)}`
    await checkAppend(answer, async () => {
      // Bursts larger than the usual character window must retain in-flight fades.
      await emit('text_stream', { kind: 'answer', generationId: 'live-answer', token: finalText.slice('Hello '.length) })
      await expect(answer.locator('[aria-label]')).toHaveAttribute('aria-label', finalText)
    })

    ui.history.get(SESSION_ID)!.push({
      who: 'owner', messageId: 'live-owner', message: 'Stream this reply.', sentAt: createdAt, isAddedToHistory: true
    }, {
      who: 'leon', messageId: responseId, message: finalText, sentAt: createdAt + 100, isAddedToHistory: true
    })
    await emit('final_answer', { content: finalText, artifacts: [] })
    const requests = ui.historyRequests.length
    await emit('session_changed', { is_running: false })
    await expect.poll(() => ui.historyRequests.length).toBeGreaterThan(requests)
    await expect(page.locator('.leon-message-work')).toHaveCount(0)
    await expect(answer.locator('.streaming-text-character-new')).not.toHaveCount(0)
    await page.reload()
    await expect(answer).toContainText(finalText.trim())
    await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
  })
}

for (const recordedTimestamps of [true, false]) {
  test(`preserves tool and thinking chronology while streaming and after reload (recorded timestamps: ${recordedTimestamps})`, async ({ page, ui }) => {
    await page.goto(SESSION_URL)
    const createdAt = Date.now()
    const responseId = 'ordered-response'
    const owner = {
      who: 'owner' as const, messageId: 'ordered-owner', message: 'Search and read two pages.',
      sentAt: createdAt, isAddedToHistory: true
    }
    const tools = [
      { id: 'search', name: 'search_web.hosted.searchWeb', toolCallTitle: 'Search the web',
        preparationStartedAt: createdAt + 100, startedAt: createdAt + 200 },
      { id: 'fetch-first', name: 'search_web.crawlberg.fetchUrl', toolCallTitle: 'Read first page',
        preparationStartedAt: createdAt + 400, startedAt: createdAt + 600 },
      { id: 'fetch-second', name: 'search_web.crawlberg.fetchUrl', toolCallTitle: 'Read second page',
        preparationStartedAt: createdAt + 500, startedAt: createdAt + 1_000 }
    ]
    const reasoning = {
      id: 'between-tools', phase: 'agent', startedAt: createdAt + 300,
      text: 'I will read these two sources.'
    }
    let sequence = 0
    const emit = (type: string, data: Record<string, unknown>, offset: number): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: owner.messageId, response_id: responseId, created_at: createdAt + offset
    }])
    const emitTool = (index: number, status: string, offset: number): Promise<void> => {
      const tool = tools[index]!

      return emit('tool_call', { tool_call: {
        id: tool.id, name: tool.name, tool_call_title: tool.toolCallTitle, status,
        ...(recordedTimestamps && status !== 'success' ? {
          preparation_started_at: tool.preparationStartedAt,
          ...(status === 'running' ? { started_at: tool.startedAt } : {})
        } : {}),
        ...(status === 'success' ? { duration_ms: 50 } : {})
      } }, offset)
    }
    const assertOrder = async (container: Locator): Promise<void> => {
      const rows = container.locator(':scope > .leon-message-execution, :scope > .thinking-message')
      await expect(rows).toHaveCount(3)
      expect(await rows.evaluateAll((elements) => elements.map((element) =>
        element.classList.contains('thinking-message') ? 'thinking' : 'tools'
      ))).toEqual(['tools', 'thinking', 'tools'])
    }

    await emit('owner_message', { message: owner }, 0)
    await emit('turn_status', { status: 'accepted' }, 1)
    await emitTool(0, 'preparing', 100)
    await emitTool(0, 'running', 200)
    await emitTool(0, 'success', 250)
    await emit('text_stream', {
      kind: 'reasoning', generationId: reasoning.id, phase: reasoning.phase, token: reasoning.text
    }, 300)
    const message = page.locator('.leon-message').last()
    await expect(message.getByRole('region', { name: 'Leon’s thinking', exact: true })).toBeVisible()
    // Output or completion updates cannot move an earlier tool past thinking.
    await emitTool(0, 'success', 350)
    await emitTool(1, 'preparing', 400)
    await emitTool(2, 'preparing', 500)
    await assertOrder(message)
    const groups = message.getByRole('region', { name: 'Leon’s tool usage', exact: true })
    await expect(groups).toHaveCount(2)
    await expect(groups.nth(1).getByRole('button', { name: 'Preparing tool calls...', exact: true })).toBeVisible()
    await emitTool(1, 'running', 600)
    await emitTool(2, 'running', 1_000)
    await assertOrder(message)
    await expect(groups.nth(1).locator('.tool-call')).toHaveCount(2)
    await expect(groups.nth(1).getByText('Read first page', { exact: true })).toBeVisible()
    await expect(groups.nth(1).getByText('Read second page', { exact: true })).toBeVisible()
    await emitTool(1, 'success', 1_100)
    await emitTool(2, 'success', 1_200)
    await assertOrder(message)
    await expect(groups.nth(0).getByRole('button', { name: 'Used 1 tool for 50ms', exact: true })).toBeVisible()
    await expect(groups.nth(1).getByRole('button', { name: 'Used 2 tools for 100ms', exact: true })).toBeVisible()

    const saved: ConversationRecord = {
      who: 'leon', messageId: responseId, message: 'Both pages are checked.',
      sentAt: createdAt + 2_000, isAddedToHistory: true,
      agentResponseTrace: {
        id: responseId, planSteps: [], reasoning: [reasoning],
        toolCalls: tools.map((tool) => ({ ...tool, status: 'success', durationMs: 50 })),
        metrics: { durationMs: 2_000 }
      }
    }
    ui.history.get(SESSION_ID)!.push(owner, saved)
    await emit('final_answer', { content: saved.message, response_trace: saved.agentResponseTrace }, 2_000)
    const work = message.getByRole('region', { name: 'Leon’s completed work', exact: true })
    await work.getByRole('button', { name: 'Worked for 2s', exact: true }).click()
    await assertOrder(work.locator('.leon-message-activities').first())
    await emit('session_changed', { is_running: false }, 2_001)
    await page.reload()
    await work.getByRole('button', { name: 'Worked for 2s', exact: true }).click()
    await assertOrder(work.locator('.leon-message-activities').first())
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const followBottom of [true, false]) {
    test(`keeps streamed answers and cached tool panels stable (${reducedMotion}, follow bottom: ${followBottom})`, async ({ page, ui }) => {
      await page.emulateMedia({ reducedMotion })
      const startedAt = Date.now()
      const responseId = 'resize-response'
      const tool = {
        id: 'resize-tool', name: 'system_utilities.shell.executeCommand',
        toolCallTitle: 'Inspect streamed output', status: 'running' as const,
        input: { command: 'Inspect output' }, commandOutput: 'Initial output',
        preparationStartedAt: startedAt, startedAt
      }
      const record: ConversationRecord = {
        who: 'leon', messageId: responseId, sentAt: startedAt + 1, isAddedToHistory: false,
        draftGeneration: 'resize-answer', message: 'A stable line in a long answer.\n'.repeat(48),
        agentResponseTrace: { id: responseId, planSteps: [], toolCalls: [tool] }
      }
      ui.sessions[0]!.status = 'wip' as SessionStatus
      ui.history.set(SESSION_ID, [{
        who: 'owner', messageId: 'resize-owner', message: 'Inspect streaming behavior.',
        sentAt: startedAt, isAddedToHistory: true
      }, record])

      const refresh = Promise.withResolvers<void>()
      let detailsRequests = 0
      const detailsPath = `/api/v1/sessions/${SESSION_ID}/messages/${responseId}`
      await page.route(`**${detailsPath}`, async (route) => {
        detailsRequests++
        if (detailsRequests > 1) {
          await refresh.promise
        }
        if (!route.request().failure()) {
          await route.fulfill({ json: { message: record } })
        }
      })

      try {
        await page.goto(SESSION_URL)
        await page.getByRole('button', { name: tool.toolCallTitle, exact: true }).click()
        const panel = page.locator('.tool-call-details')
        await expect(panel.getByRole('status')).toHaveCount(0)
        await expect(panel.getByLabel('Output JSON')).toContainText('Initial output')
        await page.evaluate(() => document.fonts.ready)
        await panel.evaluate(async (element) => {
          await Promise.all((element.closest('.collapse')?.getAnimations() ?? [])
            .map((animation) => animation.finished.catch(() => undefined)))
        })
        const panelHeight = (await panel.boundingBox())!.height
        const main = page.locator('.app-main')
        await main.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
        await expect.poll(() => main.evaluate((element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop
        )).toBeLessThan(2)
        if (!followBottom) {
          await main.evaluate((element) => element.scrollTo({ top: element.scrollTop - 250 }))
          await expect(page.getByRole('button', { name: 'Scroll to bottom', exact: true })).toBeVisible()
        }

        let sequence = 0
        const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
          type, data, sequence: ++sequence, session_id: SESSION_ID,
          turn_id: 'resize-owner', response_id: responseId, created_at: startedAt + sequence
        }])
        await emit('tool_call', { tool_call: { id: tool.id, name: tool.name, status: 'running' } })
        await expect.poll(() => detailsRequests).toBeGreaterThan(1)
        await expect(panel.getByRole('status')).toHaveCount(0)

        const originalScrollTop = await main.evaluate((element) => element.scrollTop)
        const frames: { gap: number, scrollTop: number, panelHeight: number, sizeLag: number }[] = []
        for (let index = 0; index < 12; index++) {
          const output = `Live output ${index}`
          await emit('tool_call', { tool_call: {
            id: tool.id, name: tool.name, status: 'running', command_output: output
          } })
          await expect(panel.getByLabel('Output JSON')).toContainText(output)
          await emit('text_stream', {
            kind: 'answer', generationId: 'resize-answer', token: `Additional streamed line ${index}.\n`
          })

          frames.push(...await page.evaluate(async () => {
            const samples = []
            for (let frame = 0; frame < 2; frame++) {
              // Read after paint so an animation-frame-delayed measurement
              // cannot hide a stale virtual extent behind its settled result.
              await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
              const main = document.querySelector<HTMLElement>('.app-main')!
              const row = document.querySelector<HTMLElement>('.feed-turn-latest')!
              const sizer = document.querySelector<HTMLElement>('.feed-virtual-content')!
              const panel = document.querySelector<HTMLElement>('.tool-call-details')!
              samples.push({
                gap: main.scrollHeight - main.clientHeight - main.scrollTop,
                scrollTop: main.scrollTop,
                panelHeight: panel.getBoundingClientRect().height,
                sizeLag: Math.abs(row.getBoundingClientRect().height - sizer.getBoundingClientRect().height)
              })
            }

            return samples
          }))
        }

        expect(Math.max(...frames.map((frame) => Math.abs(frame.panelHeight - panelHeight)))).toBeLessThan(2)
        if (followBottom) {
          // At the end, extent and scroll correction must land together.
          // Reading above it may update the extent asynchronously without
          // moving the owner's viewport.
          expect(Math.max(...frames.map((frame) => frame.sizeLag))).toBeLessThan(2)
          expect(Math.max(...frames.map((frame) => Math.abs(frame.gap)))).toBeLessThan(2)
        } else {
          expect(Math.max(...frames.map((frame) => Math.abs(frame.scrollTop - originalScrollTop)))).toBeLessThan(2)
        }

        const refreshed = page.waitForResponse((response) =>
          new URL(response.url()).pathname === detailsPath && response.ok()
        )
        refresh.resolve()
        await refreshed
        await expect(panel.getByLabel('Output JSON')).toContainText('Live output 11')
        await expect(panel.getByRole('status')).toHaveCount(0)
      } finally {
        refresh.resolve()
      }
    })
  }
}

test('replaces one standalone processing row in place and retains completed request history', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  let sequence = 0
  const startedAt = Date.now()
  const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
    type, data, sequence: ++sequence, session_id: SESSION_ID,
    turn_id: 'phase-owner', response_id: 'phase-response', created_at: startedAt + sequence
  }])
  await emit('turn_status', { status: 'accepted' })
  const phases = [
    [TurnPhase.Request, 'Processing...', 'cpu-line'],
    [TurnPhase.ToolSchemas, 'Loading tools...', 'stack-line'],
    [TurnPhase.ToolRequest, 'Preparing tool calls...', 'wrench-line'],
    [TurnPhase.Skill, 'Loading skills...', 'book-open-line'],
    [TurnPhase.Plan, 'Updating the plan...', 'list-check-3'],
    [TurnPhase.Clarification, 'Preparing a question...', 'question-mark'],
    [TurnPhase.Cancellation, 'Preparing to stop...', 'close-circle-line'],
    [TurnPhase.Connection, 'Preparing connection setup...', 'plug-line'],
    [TurnPhase.Answer, 'Generating an answer...', 'pencil-ai-line'],
    [TurnPhase.Inspection, 'Inspecting images...', 'eye-2-line'],
    [TurnPhase.Compaction, 'Compacting context...', 'file-reduce-line'],
    [TurnPhase.Review, 'Reviewing...', 'search-eye-line']
  ] as const
  const timings = phases.map(([goal], index) => ({
    id: 'd'.repeat(index + 1), goal, startedAt: startedAt + index * 200,
    durationMs: 100, outcome: 'completed'
  }))
  const request = page.getByRole('region', { name: 'Leon’s inference', exact: true })
  const processing = page.getByRole('region', { name: 'Leon’s processing', exact: true })
  let originalRow: ElementHandle | null = null

  for (const [index, [goal, label, icon]] of phases.entries()) {
    const activity = { ...timings[index]!, goal, durationMs: 0, outcome: 'started' }
    await emit('inference_activity', { activity })
    await expect(processing).toHaveCount(0)
    await expect(request).toHaveCount(1)
    await expect(request.getByRole('button')).toHaveCount(0)
    await expect(request.locator('.process-group-title')).toHaveText(label)
    await expect(request.locator(`.ri-${icon}`)).toBeVisible()
    await expect(request.locator('.activity-wave')).toHaveClass(/activity-wave-active/)
    originalRow ??= await request.elementHandle()
    expect(await originalRow!.evaluate((element) => element.isConnected)).toBe(true)

    const previous = timings[index - 1]
    if (previous) {
      // A delayed completion must not replace the newer running phase.
      await emit('inference_activity', { activity: previous })
      await expect(request).toHaveCount(1)
      await expect(request.locator('.process-group-title')).toHaveText(label)
    }

    const position = await request.boundingBox()
    const scrollTop = await page.locator('.app-main').evaluate((element) => element.scrollTop)
    await emit('inference_activity', { activity: timings[index]! })
    const waiting = page.getByRole('region', { name: 'Leon’s work', exact: true })
    await expect(waiting).toBeVisible()
    await expect(waiting.locator('.process-group-indicator, i, svg')).toHaveCount(0)
    expect(await originalRow!.evaluate((element) => element.isConnected)).toBe(true)
    expect(Math.abs((await waiting.boundingBox())!.y - position!.y)).toBeLessThan(2)
    expect(Math.abs(await page.locator('.app-main').evaluate((element) => element.scrollTop) - scrollTop)).toBeLessThan(2)
  }

  await emit('inference_activity', { activity: timings.at(-1)! })
  await expect(request).toHaveCount(0)
  await expect(processing).toHaveCount(0)
  await originalRow?.dispose()

  await emit('final_answer', {
    content: 'All done.',
    response_trace: {
      plan_steps: [], tool_calls: [], metrics: { durationMs: 3_000 },
      timings: timings.map((timing) => ({ ...timing, kind: 'inference' }))
    }
  })
  const work = page.getByRole('region', { name: 'Leon’s completed work', exact: true })
  await work.getByRole('button', { name: 'Worked for 3s', exact: true }).click()
  await processing.getByRole('button', { name: 'Processed for 1s', exact: true }).click()
  await expect(processing.getByRole('region', { name: 'Leon’s inference', exact: true })).toHaveCount(phases.length)
  await expect(processing.getByText('Prepared tool calls in 100ms', { exact: true })).toBeVisible()
  await expect(processing.getByText('Reviewed for 100ms', { exact: true })).toBeVisible()
  await expect(processing.locator('.activity-wave-active')).toHaveCount(0)
})
