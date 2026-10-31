import type { Locator } from '@playwright/test'
import type { ConversationEvent } from '../../../apps/web/src/data/conversation'
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
  const stop = page.getByRole('button', { name: 'Stop this session', exact: true })
  await expect(stop).toBeEnabled()
  await expect(send).toHaveCount(0)
  await expect(stop).toHaveClass(/button-danger/)
  await expect(stop).toHaveAttribute('type', 'button')
  await expect(stop.locator('.ri-stop-mini-fill')).toBeVisible()
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
    await expect(working).toHaveText('Coming together...')
    await expect(working.locator('.process-group-indicator, i, svg')).toHaveCount(0)
    await emit('metrics', { metrics: { durationMs: 100 } })
    await expect(working).toHaveText('Coming together...')
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
