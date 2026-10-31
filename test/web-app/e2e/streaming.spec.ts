import type { ElementHandle, Locator } from '@playwright/test'
import type { ConversationEvent } from '../../../apps/web/src/data/conversation'
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
