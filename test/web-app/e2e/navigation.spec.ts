import type { Page } from '@playwright/test'
import { TurnPhase } from '../../../server/src/core/llm-manager/turn-timing-contract'

import { test, expect, SESSION_ID, OTHER_SESSION_ID, SESSION_URL, LATEST_ANSWER } from './fixtures'

async function expectBottom(page: Page): Promise<void> {
  await expect.poll(() => page.locator('.app-main').evaluate((main) =>
    Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop)
  )).toBeLessThanOrEqual(2)
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
}

test('drafts immediately while history loads and opens the latest messages at the bottom', async ({ page, ui }) => {
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await composer.fill('Draft before loading')
  await composer.press('Enter')
  await expect(composer).toHaveValue('Draft before loading')
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toHaveCount(0)
  release()
  await expectBottom(page)
  await expect(composer).toHaveValue('Draft before loading')
  await expect(composer).toBeFocused()
  expect(ui.completedRequests.filter((url) => url.pathname.endsWith(SESSION_ID))).toHaveLength(1)
  expect(ui.historyRequests[0]!.searchParams.has('before')).toBe(false)
})

test('reselects the current session at the bottom without discarding its draft', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  await expectBottom(page)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this draft')
  await page.locator('.app-main').evaluate((main) => main.scrollTo({ top: main.scrollTop - 500 }))
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expectBottom(page)
  await expect(composer).toHaveValue('Keep this draft')
  await expect(composer).toBeFocused()
})

test('updates session titles from metadata-only notifications during and after a turn', async ({ page, ui }) => {
  const errors: Error[] = []
  const handlePageError = (error: Error): void => {
    errors.push(error)
  }
  page.on('pageerror', handlePageError)
  await page.goto(SESSION_URL)
  await expectBottom(page)
  await expect(page.getByRole('link', { name: 'Test session 0', exact: true })
    .locator('.streaming-text-character-new')).toHaveCount(0)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this draft while the title changes')
  await ui.emit([{
    type: 'turn_status', sequence: 1, session_id: SESSION_ID, turn_id: 'turn', response_id: null,
    created_at: Date.now(), data: { status: 'accepted' }
  }])
  ui.sessions[0]!.title = 'Generated title while working'
  await ui.emit([{ type: 'sessions_changed' }])
  await expect(page.getByRole('link', { name: 'Generated title while working', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Generated title while working', exact: true })
    .locator('.session-list-item-title-resting .streaming-text-character-new')).not.toHaveCount(0)
  ui.sessions[0]!.title = 'Updated title after completion'
  await ui.emit([{
    type: 'session_changed', sequence: 2, session_id: SESSION_ID, turn_id: 'turn', response_id: null,
    created_at: Date.now(), data: { is_running: false }
  }, { type: 'sessions_changed' }])
  await expect(page.getByRole('link', { name: 'Updated title after completion', exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Keep this draft while the title changes')
  await expect(composer).toBeFocused()
  expect(errors).toEqual([])
  await page.reload()
  await expect(page.getByRole('link', { name: 'Updated title after completion', exact: true })
    .locator('.streaming-text-character-new')).toHaveCount(0)
  page.off('pageerror', handlePageError)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`reveals live titles once while preserving ellipsis, hover scrolling and virtualized remounts (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    for (let index = 3; index < 80; index++) {
      ui.sessions.push({
        ...ui.sessions[1]!,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Older session ${index}`
      })
    }
    await page.goto(SESSION_URL)
    await expectBottom(page)
    const title = 'A longer generated session title that needs room beyond the row'
    ui.sessions[0]!.title = title
    await ui.emit([{ type: 'sessions_changed' }])
    const link = page.getByRole('link', { name: title, exact: true })
    const resting = link.locator('.session-list-item-title-resting')
    const characters = resting.locator('.streaming-text-character-new')
    await expect(link).toBeVisible()
    await expect(characters).toHaveCount(Array.from(title).length)
    await expect(characters.first()).toHaveCSS('animation-name',
      reducedMotion === 'reduce' ? 'none' : 'streaming-text-character-enter')
    await expect(resting.locator('.streaming-text-characters')).toHaveCSS('white-space', 'nowrap')
    await expect(resting).toHaveCSS('text-overflow', 'ellipsis')
    await expect(link).toHaveCSS('height', '40px')
    await expect(characters.last()).toHaveCSS('opacity', '1')
    const start = await characters.first().evaluate((element) => element.getAnimations()[0]?.startTime ?? null)
    const requests = ui.completedRequests.filter((url) => url.pathname.endsWith('/page')).length
    await ui.emit([{ type: 'sessions_changed' }])
    await expect.poll(() => ui.completedRequests.filter((url) => url.pathname.endsWith('/page')).length).toBeGreaterThan(requests)
    expect(await characters.first().evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).toBe(start)
    await link.hover()
    const viewport = link.locator('.session-list-item-title')
    if (reducedMotion === 'reduce') {
      await expect(viewport).not.toHaveClass(/session-list-item-title-scrolling/)
    } else {
      await expect(viewport).toHaveClass(/session-list-item-title-scrolling/)
    }
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(viewport).not.toHaveClass(/session-list-item-title-scrolling/)
    await expect.poll(() => link.locator('.session-list-item-title-text')
      .evaluate((element) => element.getAnimations().length)).toBe(0)
    const sidebar = page.locator('.sidebar-scroll-area')
    await sidebar.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await expect(link).toHaveCount(0)
    await sidebar.evaluate((element) => element.scrollTo({ top: 0 }))
    await expect(link).toBeVisible()
    await expect(link.locator('.streaming-text-character-new')).toHaveCount(0)
  })

  test(`preserves independent session and new-session drafts across navigation and refresh (${reducedMotion})`, async ({ page, ui }) => {
    void ui
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    const first = page.getByRole('link', { name: 'Test session 0', exact: true })
    const other = page.getByRole('link', { name: 'Test session 1', exact: true })
    const newSession = page.getByRole('link', { name: 'New session', exact: true })
    const draft = 'First draft\n\nKeep these newlines and spaces.  '
    await composer.fill(draft)
    await other.click()
    await expect(composer).toHaveValue('')
    await composer.fill('Other session draft')
    await newSession.click()
    await expect(composer).toHaveValue('')
    await composer.fill('New-session draft')
    await first.click()
    await expect(composer).toHaveValue(draft)
    await expect(composer).toBeFocused()
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue(draft)
    await page.goBack()
    await expect(composer).toHaveValue('New-session draft')
    await page.goForward()
    await expect(composer).toHaveValue(draft)
    await page.reload()
    await expect(composer).toHaveValue(draft)
    await other.click()
    await expect(composer).toHaveValue('Other session draft')
    await newSession.click()
    await page.reload()
    await expect(composer).toHaveValue('New-session draft')
  })

  test(`opens tall saved answers at the bottom with intact whitespace (${reducedMotion})`, async ({ page, ui }) => {
    const lines = Array.from({ length: 90 }, (_, index) =>
      `Saved line ${index + 1}: this paragraph keeps its own line and spacing.`
    )
    const text = lines.join('\n\n')
    ui.history.get(SESSION_ID)!.at(-1)!.message = text
    await page.emulateMedia({ reducedMotion })
    const expectSavedAnswer = async (): Promise<void> => {
      const answer = page.getByRole('region', { name: 'Leon’s final answer' })
        .filter({ hasText: lines.at(-1)! })
      await expect(answer.locator('.streaming-text-characters')).toHaveCSS('white-space', 'pre-wrap')
      expect(await answer.innerText()).toBe(text)
      await expect.poll(() => page.locator('.app-main').evaluate((main) =>
        Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop)
      )).toBeLessThanOrEqual(2)
      await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
    }

    await page.goto(SESSION_URL)
    await expectSavedAnswer()
    await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
    await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
    await expectSavedAnswer()
    await page.locator('.app-main').evaluate((main) => main.scrollTo({ top: main.scrollTop - 500 }))
    await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
    await expectSavedAnswer()
    await page.reload()
    await expectSavedAnswer()
  })
}

test('saves drafts only when leaving and removes submitted or manually cleared text', async ({ page, ui }) => {
  void ui
  await page.addInitScript(() => {
    let count = 0
    Object.defineProperty(window, 'draftStorageWriteCount', { get: () => count })
    for (const method of ['setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (key: string, value = ''): void {
        if (this === window.sessionStorage) {
          count++
        }
        Reflect.apply(original, this, [key, value])
      }
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  const first = page.getByRole('link', { name: 'Test session 0', exact: true })
  const other = page.getByRole('link', { name: 'Test session 1', exact: true })
  const writes = (): Promise<number> => page.evaluate(() => Reflect.get(window, 'draftStorageWriteCount') as number)
  await composer.pressSequentially('Unsent text')
  expect(await writes()).toBe(0)
  await other.click()
  expect(await writes()).toBe(1)
  await first.click()
  await expect(composer).toHaveValue('Unsent text')
  expect(await writes()).toBe(1)
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await composer.press('Enter')
  await expect(page.getByText('Completed Unsent text', { exact: true })).toBeVisible()
  await other.click()
  expect(await writes()).toBe(2)
  await first.click()
  await expect(composer).toHaveValue('')
  await composer.fill('To clear manually')
  await other.click()
  await first.click()
  await expect(composer).toHaveValue('To clear manually')
  await composer.fill('')
  await page.reload()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue('')
})

test('isolates profile drafts and prioritizes new typing while authentication resolves', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
  await composer.fill('First profile draft')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  ui.profile = 'another-ui-profile'
  await page.reload()
  await expect(composer).toBeFocused()
  await expect(page.getByRole('link', { name: 'Test session 0', exact: true })).toBeVisible()
  await expect(composer).toHaveValue('')
  await composer.fill('Another profile draft')
  await page.reload()
  await expect(composer).toHaveValue('Another profile draft')
  ui.profile = 'ui-tests'
  await page.reload()
  await expect(composer).toHaveValue('First profile draft')

  const release = ui.holdAuthentication()
  try {
    await page.reload()
    await composer.fill('New typing before authentication')
    release()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
    await expect(composer).toHaveValue('New typing before authentication')
    await page.reload()
    await expect(composer).toHaveValue('New typing before authentication')
  } finally {
    release()
  }
})

test('keeps drafting usable and reports browser storage failures', async ({ page, ui }) => {
  void ui
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (this === window.sessionStorage) {
        throw new DOMException('Storage is full.', 'QuotaExceededError')
      }
      setItem.call(this, key, value)
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this text available')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByText('Draft was not saved', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Keep this text available')
  await expect(composer).toBeEnabled()
})

test('reopens an evicted latest window without fetching older cursors first', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await expectBottom(page)
  const load = page.getByRole('button', { name: 'Load earlier messages' })
  for (let index = 0; index < 10; index++) {
    const response = page.waitForResponse((candidate) => new URL(candidate.url()).searchParams.has('before'))
    await load.click()
    await response
    await expect(load).toBeEnabled()
  }
  await expect(page.getByRole('button', { name: 'Back to latest messages' })).toBeVisible()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
  const frontier = ui.historyRequests.length
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expectBottom(page)
  const reopened = ui.historyRequests.slice(frontier).filter((url) => url.pathname.endsWith(SESSION_ID))
  expect(reopened.length).toBeGreaterThan(0)
  expect(reopened.every((url) => !url.searchParams.has('before') && !url.searchParams.has('after'))).toBe(true)
})

test('reports a shared history failure once and keeps the draft through manual recovery', async ({ page, ui }) => {
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}`, status: 500, message: 'History is unavailable.' }
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this during recovery')
  await expect(page.locator('.toast-title')).toHaveText(['Could not load the conversation'])
  ui.failure = undefined
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expectBottom(page)
  await expect(composer).toHaveValue('Keep this during recovery')
})

test('rolls back a rejected model setting and reports it through the shared toast', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await expectBottom(page)
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}/model`, status: 400, message: 'Unsupported setting.' }
  await page.locator('.model-settings-trigger').click()
  await page.getByRole('radio', { name: 'Low', exact: true }).click()
  await expect(page.locator('.toast-title')).toHaveText(['Model settings were not saved'])
  await expect(page.locator('.model-settings-trigger')).toContainText('High')
})

test('cancels obsolete history silently when switching sessions', async ({ page, ui }) => {
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await composer.fill('Only the active session')
  release()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await expect(composer).toHaveValue('Only the active session')
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0)
})

test('retries failed delivery with the original message ID instead of duplicating it', async ({ page, ui }) => {
  await page.goto(`session/${OTHER_SESSION_ID}`)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Retry delivery')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  ui.failure = { path: `/api/v1/sessions/${OTHER_SESSION_ID}/messages`, status: 500, message: 'Delivery failed.' }
  const delivery = page.waitForRequest((request) => request.url().endsWith('/messages'))
  await composer.press('Enter')
  const first = (await delivery).postDataJSON() as { id: string }
  await expect(page.locator('.toast-title')).toHaveText(['Message delivery was not confirmed'])
  ui.failure = undefined
  const retry = page.waitForRequest((request) => request.url().endsWith('/messages'))
  await page.getByRole('button', { name: 'Retry sending message' }).click()
  expect(((await retry).postDataJSON() as { id: string }).id).toBe(first.id)
  await expect(page.getByText('Completed Retry delivery', { exact: true })).toBeVisible()
  await expect(page.getByText('Retry delivery', { exact: true })).toHaveCount(1)
})

test('keeps tool durations centered alongside their titles in both themes', async ({ page, ui }, testInfo) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId,
    planSteps: [],
    toolCalls: [{
      id: 'lookup', name: 'search.lookup.run', status: 'success',
      toolCallTitle: 'Looked up information', toolIconName: 'search-line', startedAt: 0, durationMs: 1_500
    }],
    metrics: { durationMs: 2_000 }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 2s' }).click()
  await page.getByRole('button', { name: 'Used 1 tool for 2s', exact: true }).click()
  const tool = page.getByRole('button', { name: 'Looked up information' })
  await expect(tool).toBeVisible()
  await expect(tool.locator('.tool-call-duration')).toHaveText('1.5s')

  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme)
    const title = await tool.locator('.tool-call-title').boundingBox()
    const duration = await tool.locator('.tool-call-duration').boundingBox()
    expect(title).not.toBeNull()
    expect(duration).not.toBeNull()
    expect(Math.abs(title!.y + title!.height / 2 - duration!.y - duration!.height / 2)).toBeLessThanOrEqual(1)
    await testInfo.attach(`tool-duration-${theme}`, { body: await tool.screenshot(), contentType: 'image/png' })
  }
})

test('preserves sub-second tool totals in milliseconds after reloading', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [],
    toolCalls: [
      { id: 'first', name: 'test.lookup.run', status: 'success', durationMs: 125.2 },
      { id: 'second', name: 'test.lookup.run', status: 'success', durationMs: 84.3 }
    ],
    metrics: { durationMs: 400 }
  }

  await page.goto(SESSION_URL)
  const work = page.getByRole('region', { name: 'Leon’s completed work' })
  await work.getByRole('button', { name: 'Worked for 400ms', exact: true }).click()
  await expect(work.getByRole('button', { name: 'Used 2 tools for 210ms', exact: true })).toBeVisible()
  await page.reload()
  await work.getByRole('button', { name: 'Worked for 400ms', exact: true }).click()
  await expect(work.getByRole('button', { name: 'Used 2 tools for 210ms', exact: true })).toBeVisible()
})

for (const completeTiming of [true, false]) {
  test(`shows cumulative tool execution only with complete timing (${completeTiming})`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId,
      planSteps: [],
      toolCalls: [
        { id: 'short', name: 'search.lookup.run', status: 'success', startedAt: 2_000, durationMs: 2_000 },
        { id: 'long', name: 'search.lookup.run', status: 'success', startedAt: 0, durationMs: 12_000 },
        {
          id: 'middle', name: 'search.lookup.run', status: 'success', startedAt: 1_000,
          ...(completeTiming ? { durationMs: 5_000 } : {})
        }
      ],
      metrics: { durationMs: 14_000 }
    }

    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 14s' }).click()
    // Accumulated execution can exceed the wall-clock turn when calls overlap.
    const label = completeTiming ? 'Used 3 tools for 19s' : 'Used 3 tools'
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Worked for 14s' }).click()
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shows measured generation and review inside the full turn total (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId,
      planSteps: [],
      toolCalls: [
        { id: 'first', name: 'search.lookup.run', status: 'success', startedAt: 0, durationMs: 618 },
        { id: 'second', name: 'search.lookup.run', status: 'success', startedAt: 6_500, durationMs: 435 }
      ],
      metrics: {
        durationMs: 20_000, reviewCount: 1, reviewDurationMs: 3_000,
        phaseMetrics: { final_answer: { durationMs: 5_000 } }
      }
    }
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work' })
    await work.getByRole('button', { name: 'Worked for 20s', exact: true }).click()
    await work.getByRole('button', { name: 'Used 2 tools for 1s', exact: true }).click()
    await expect(work.locator('.tool-call-duration')).toHaveText(['618ms', '435ms'])
    const generation = work.getByRole('region', { name: 'Leon’s answer generation' })
    const review = work.getByRole('region', { name: 'Leon’s review' })
    await expect(generation).toHaveText('Generated answer in 5s')
    await expect(review).toHaveText('Reviewed for 3s')
    await expect(generation.locator('.ri-pencil-ai-line')).toHaveCount(1)
    await expect(review.locator('.ri-search-eye-line')).toHaveCount(1)
    await expect(generation.getByRole('button')).toHaveCount(0)
    await expect(review.getByRole('button')).toHaveCount(0)
    await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
    await testInfo.attach('completed-work', { body: await work.screenshot(), contentType: 'image/png' })
    await page.reload()
    await work.getByRole('button', { name: 'Worked for 20s', exact: true }).click()
    await expect(generation).toHaveText('Generated answer in 5s')
    await expect(review).toHaveText('Reviewed for 3s')
  })
}

test('omits absent or unmeasured phases instead of estimating their duration', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.llmMetrics = { durationMs: 4_000, reviewCount: 0, reviewDurationMs: 0 }
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], toolCalls: [],
    reasoning: [{ id: 'thought', phase: 'agent', startedAt: 0, text: 'Considered the request.' }],
    metrics: { phaseMetrics: { final_answer: { durationMs: 0 } } }
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 4s', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Leon’s review' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Leon’s answer generation' })).toHaveCount(0)
})

test('shows phase summaries from saved message metrics without a detailed trace', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.llmMetrics = {
    durationMs: 12_000, reviewCount: 1, reviewDurationMs: 2_000,
    phaseMetrics: { final_answer: { durationMs: 3_000 } }
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Leon’s review' })).toHaveText('Reviewed for 2s')
  await expect(page.getByRole('region', { name: 'Leon’s answer generation' })).toHaveText('Generated answer in 3s')
})

for (const retryCount of [0, 1, 4]) {
  test(`shows only the recorded retry count (${retryCount}) without changing turn timing`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], toolCalls: [],
      inferences: retryCount === 4 ? [
        { startedAt: 0, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' },
        { startedAt: 500, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' },
        { startedAt: 1_000, elapsedMs: 500, phase: 'agent' },
        { startedAt: 1_500, elapsedMs: 500, phase: 'review', retryDecision: 'retry' },
        { startedAt: 2_000, elapsedMs: 500, phase: 'review' }
      ] : [
        { startedAt: 0, elapsedMs: 500, phase: 'agent' },
        { startedAt: 500, elapsedMs: 500, phase: 'agent', retryDecision: 'stop' },
        { startedAt: 1_000, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' }
      ],
      metrics: {
        durationMs: 12_000, reviewCount: 1, reviewDurationMs: 2_000,
        reviewRetryCount: retryCount === 4 ? 2 : retryCount
      }
    }
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work' })
    await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
    const retries = work.getByRole('region', { name: 'Leon’s retries' })
    if (retryCount === 0) {
      await expect(retries).toHaveCount(0)
    } else {
      const label = `Retried ${retryCount} ${retryCount === 1 ? 'time' : 'times'}`
      await expect(retries).toHaveText(label)
      await expect(retries.locator('.ri-refresh-line')).toHaveCount(1)
      await expect(retries.getByRole('button')).toHaveCount(0)
      await page.reload()
      await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
      await expect(retries).toHaveText(label)
    }
  })
}

test('shows retries from the final live trace without refreshing history', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  const event = {
    type: 'final_answer', sequence: 1, session_id: SESSION_ID,
    turn_id: 'question-239', response_id: answer.messageId, created_at: answer.sentAt,
    data: {
      content: answer.message, artifacts: [],
      response_trace: {
        inferences: [
          { startedAt: 0, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' },
          { startedAt: 500, elapsedMs: 500, phase: 'agent' },
          { startedAt: 1_000, elapsedMs: 500, phase: 'review', retryDecision: 'retry' },
          { startedAt: 1_500, elapsedMs: 500, phase: 'review' }
        ],
        metrics: { durationMs: 12_000, otherProcessingDurationMs: 3_000 }
      }
    }
  }
  await page.route('**/api/v1/sessions/events?*', async (route) => {
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(event)}\n\n` })
  })
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Leon’s retries' })).toHaveText('Retried 2 times')
  await expect(page.getByRole('region', { name: 'Leon’s other processing' })).toHaveText('Other processing for 3s')
  expect(ui.completedRequests.filter((url) => url.pathname.endsWith(SESSION_ID))).toHaveLength(1)
})

test('accounts for tool selection and intermediate model requests alongside execution and the answer', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [],
    toolCalls: [{ id: 'lookup', name: 'test.lookup.run', status: 'success', durationMs: 5_000 }],
    timings: [
      { id: 'selection', kind: 'inference', goal: 'tool-selection', startedAt: 0, durationMs: 4_000, outcome: 'completed' },
      { id: 'answer', kind: 'inference', goal: 'answer-generation', startedAt: 9_000, durationMs: 2_000, outcome: 'completed' }
    ],
    metrics: {
      durationMs: 11_000, modelProcessingDurationMs: 4_000,
      phaseMetrics: { final_answer: { durationMs: 2_000 } }
    }
  }
  await page.goto(SESSION_URL)
  const work = page.getByRole('region', { name: 'Leon’s completed work' })
  await work.getByRole('button', { name: 'Worked for 11s', exact: true }).click()
  await expect(work.getByRole('button', { name: 'Used 1 tool for 5s', exact: true })).toBeVisible()
  await work.getByRole('button', { name: 'Processed for 6s', exact: true }).click()
  await expect(work.getByRole('region', { name: 'Leon’s inference', exact: true }).locator('.process-group-title')).toHaveText(['Processed tool request in 4s', 'Generated answer in 2s'])
})

test('keeps thoughts separate and closes completed work with categorized model requests', async ({ page, ui }) => {
  const categories = [
    { goal: TurnPhase.ToolSchemas, label: 'Loaded tool schemas in', icon: 'stack-line' },
    { goal: TurnPhase.ToolRequest, label: 'Prepared tool calls in', icon: 'wrench-line' },
    { goal: TurnPhase.Skill, label: 'Loaded skills in', icon: 'book-open-line' },
    { goal: TurnPhase.Plan, label: 'Updated plan in', icon: 'list-check-3' },
    { goal: TurnPhase.Clarification, label: 'Requested clarification in', icon: 'question-mark' },
    { goal: TurnPhase.Answer, label: 'Generated answer in', icon: 'pencil-ai-line' },
    { goal: TurnPhase.Review, label: 'Reviewed for', icon: 'search-eye-line' },
    { goal: TurnPhase.Inspection, label: 'Inspected images in', icon: 'eye-2-line' },
    { goal: TurnPhase.Compaction, label: 'Compacted context in', icon: 'file-reduce-line' }
  ]
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], toolCalls: [],
    reasoning: [{ id: 'independent-thought', phase: 'agent', startedAt: 0, text: 'Reviewing the evidence.' }],
    timings: categories.map((category, index) => ({
      id: `request-${index}`, kind: 'inference', goal: category.goal,
      startedAt: index * 1_000, durationMs: 1_000, outcome: 'completed'
    })),
    metrics: { durationMs: 12_000, otherProcessingDurationMs: 3_000 }
  }

  await page.goto(SESSION_URL)
  const work = page.getByRole('region', { name: 'Leon’s completed work' })
  await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
  const processing = work.getByRole('region', { name: 'Leon’s processing', exact: true })

  await expect(work.getByRole('region', { name: 'Leon’s thinking', exact: true })).toHaveCount(1)
  await expect(work.locator('.leon-message-activities').first().locator(':scope > :last-child'))
    .toHaveAttribute('aria-label', 'Leon’s processing')
  await processing.getByRole('button', { name: 'Processed for 9s', exact: true }).click()
  await expect(processing.getByRole('region', { name: 'Leon’s thinking', exact: true })).toHaveCount(0)

  for (const category of categories) {
    const request = processing.getByRole('region', { name: 'Leon’s inference', exact: true })
      .filter({ hasText: `${category.label} 1s` })
    await expect(request).toHaveCount(1)
    await expect(request.locator(`.ri-${category.icon}`)).toHaveCount(1)
  }
})

for (const otherDuration of [undefined, 0, 500, 3_000]) {
  test(`shows only meaningful measured other processing (${otherDuration})`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.llmMetrics = {
      durationMs: 12_000, phaseMetrics: { final_answer: { durationMs: 4_000 } },
      ...(otherDuration === undefined ? {} : { otherProcessingDurationMs: otherDuration })
    }
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work' })
    await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
    const other = work.getByRole('region', { name: 'Leon’s other processing' })
    if (otherDuration === 3_000) {
      await expect(other).toHaveText('Other processing for 3s')
      await expect(other.locator('.ri-more-line')).toHaveCount(1)
      await expect(other.getByRole('button')).toHaveCount(0)
      await page.reload()
      await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
      await expect(other).toHaveText('Other processing for 3s')
    } else {
      await expect(other).toHaveCount(0)
    }
  })
}
