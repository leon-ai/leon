import type { Page, Locator } from '@playwright/test'

import { test, expect, SESSION_ID, SESSION_URL, OTHER_SESSION_ID } from './fixtures'
import type { SessionStatus } from '../../../apps/web/src/data/sessions'

const READING_PAUSE_MS = 7_000
const MAXIMUM_WAVE_PAINTS_PER_SECOND = 32

/**
 * Counts actual canvas paints so a paused status cannot hide a running renderer.
 */
async function installCanvasPaintCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = new WeakMap<HTMLCanvasElement, number>()
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args): void {
      counts.set(this.canvas, (counts.get(this.canvas) ?? 0) + 1)
      clear.apply(this, args)
    }
    Reflect.set(window, 'canvasPaints', (canvas: HTMLCanvasElement) => counts.get(canvas) ?? 0)
  })
}

async function canvasPaints(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => Reflect.get(window, 'canvasPaints')(element) as number)
}

test('keeps composer particles and the focused caret continuous without changing native editing', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const field = page.getByRole('textbox', { name: 'Message Leon', exact: true })
  const surface = page.locator('.query-input-container')
  const caret = surface.locator('.input-effects-caret')
  await expect(field).toBeFocused()
  await field.pressSequentially('A quiet draft')
  await expect(surface).toHaveClass(/query-input-active/)
  // A reading pause must retain the particles and caret, while the glow settles.
  await page.waitForTimeout(READING_PAUSE_MS)
  await expect(surface).not.toHaveClass(/query-input-active/)
  await expect(surface).toHaveClass(/query-input-visible/)
  await expect.poll(() => surface.locator('.query-input-particles').evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length
  )).toBeGreaterThan(0)
  await expect(caret).toBeVisible()
  await expect.poll(() => caret.evaluate((element) =>
    element.getAnimations().some((animation) => animation.playState === 'running')
  )).toBe(true)

  await field.press('End')
  await field.pressSequentially(' continues')
  await expect(field).toHaveValue('A quiet draft continues')
  await expect(surface).toHaveClass(/query-input-active/)
  await expect.poll(() => caret.evaluate((element) =>
    element.getAnimations().some((animation) => animation.playState === 'running')
  )).toBe(true)

  await field.press('Shift+Home')
  await expect(surface.locator('.input-effects')).toBeHidden()
  await field.press('ArrowRight')
  await expect(surface.locator('.input-effects')).toBeVisible()
  await field.dispatchEvent('compositionstart')
  await expect(caret).toBeHidden()
  await field.dispatchEvent('input', { inputType: 'insertCompositionText', isComposing: true })
  await expect(field).toHaveValue('A quiet draft continues')
  await field.dispatchEvent('compositionend')
  await expect(caret).toBeVisible()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(field).toHaveValue('')
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expect(field).toHaveValue('A quiet draft continues')
})

test('keeps visible working sessions animated across reading pauses and navigation', async ({ page, ui }) => {
  for (const session of ui.sessions) {
    session.status = 'wip' as SessionStatus
  }
  await installCanvasPaintCounter(page)
  await page.goto(SESSION_URL)
  const current = page.locator(`[data-session-id="${SESSION_ID}"]`)
  const other = page.locator(`[data-session-id="${OTHER_SESSION_ID}"]`)
  await expect(current).toHaveAccessibleName('Test session 0, Leon is working')
  await expect(other).toHaveAccessibleName('Test session 1, Leon is working')
  await expect(current.locator('.session-work-indicator')).not.toHaveClass(/session-work-paused/)
  await expect(other.locator('.session-work-indicator')).not.toHaveClass(/session-work-paused/)
  await expect.poll(() => canvasPaints(current.locator('canvas'))).toBeGreaterThan(0)
  await expect.poll(() => canvasPaints(other.locator('canvas'))).toBeGreaterThan(0)
  const initialPaints = await canvasPaints(current.locator('canvas'))

  await page.waitForTimeout(READING_PAUSE_MS)
  const readingPaints = await canvasPaints(current.locator('canvas'))

  // Continuous working waves retain their paint budget during a reading pause.
  expect(readingPaints - initialPaints).toBeLessThanOrEqual(
    READING_PAUSE_MS / 1_000 * MAXIMUM_WAVE_PAINTS_PER_SECOND
  )
  await expect.poll(() => current.locator('.session-work-particles').evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length
  )).toBeGreaterThan(0)
  await expect.poll(() => canvasPaints(current.locator('canvas')), { timeout: 1_000 }).toBeGreaterThan(readingPaints)
  await other.click()
  await expect(current.locator('.session-work-indicator')).not.toHaveClass(/session-work-paused/)
  await expect(other.locator('.session-work-indicator')).not.toHaveClass(/session-work-paused/)
  await expect.poll(() => canvasPaints(other.locator('canvas'))).toBeGreaterThan(0)
  await current.locator('.session-work-indicator').evaluate((element: HTMLElement) => {
    element.style.transform = 'translateX(-200vw)'
  })
  await expect(current.locator('.session-work-indicator')).toHaveClass(/session-work-paused/)
  const pausedPaints = await canvasPaints(current.locator('canvas'))
  await page.waitForTimeout(300)
  expect(await canvasPaints(current.locator('canvas'))).toBe(pausedPaints)
  await current.locator('.session-work-indicator').evaluate((element: HTMLElement) => {
    element.style.transform = ''
  })
  await expect.poll(() => canvasPaints(current.locator('canvas'))).toBeGreaterThan(pausedPaints)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(other.locator('.session-work-indicator')).toHaveClass(/session-work-paused/)
  await expect(other).toHaveAccessibleName('Test session 1, Leon is working')
  const reducedPaints = await canvasPaints(other.locator('canvas'))

  await page.waitForTimeout(200)
  expect(await canvasPaints(other.locator('canvas'))).toBe(reducedPaints)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => canvasPaints(other.locator('canvas'))).toBeGreaterThan(reducedPaints)
})

test('budgets weather frames and suspends decoration outside the viewport or foreground', async ({ page, ui }) => {
  ui.ambient.weather = {
    condition: 'rain', description: 'Rain', temperatureC: 12, feelsLikeC: 10,
    weatherCode: 63, location: 'Test location', observationTime: '2026-11-15T12:00', fetchedAt: Date.now()
  }
  await installCanvasPaintCounter(page)
  const paints = (): Promise<number> => canvasPaints(page.locator('.weather-layer'))
  await page.goto(SESSION_URL)
  await expect(page.locator('.weather-layer')).toBeVisible()
  await expect.poll(paints).toBeGreaterThan(2)
  const before = await paints()
  await page.waitForTimeout(1_000)
  const drawn = await paints() - before
  expect(drawn).toBeGreaterThan(2)
  expect(drawn).toBeLessThanOrEqual(17)

  // Playwright emulates focused, visible pages; deliver the lifecycle contract
  // explicitly here. Headed resource samples disable that override for backgrounding.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.query-input-container')).not.toHaveClass(/query-input-active/)
  await expect(page.locator('.query-input-container')).not.toHaveClass(/query-input-visible/)
  const hidden = await paints()
  await page.waitForTimeout(300)
  expect(await paints()).toBe(hidden)
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(paints).toBeGreaterThan(hidden)

  const weather = page.locator('.weather-layer')
  await weather.evaluate((element) => { element.style.transform = 'translateX(-200vw)' })
  await page.waitForTimeout(150)
  const offscreen = await paints()
  await page.waitForTimeout(300)
  expect(await paints()).toBe(offscreen)
  await weather.evaluate((element) => { element.style.transform = '' })
  await expect.poll(paints).toBeGreaterThan(offscreen)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(150)
  const reduced = await paints()
  await page.getByRole('textbox', { name: 'Message Leon' }).fill('Motion preference respected')
  await page.waitForTimeout(300)
  expect(await paints()).toBe(reduced)
  await expect(page.locator('.query-input-container')).not.toHaveClass(/query-input-active/)
})


test('sweeps smoothly through active task text and releases offscreen highlights', async ({ page, ui }) => {
  ui.sessions[0]!.status = 'wip' as SessionStatus
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = ''
  answer.isAddedToHistory = false
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], toolCalls: [{
      id: 'reading', name: 'test.files.read', toolCallTitle: 'Reading project files',
      toolIconName: 'file-text-line', status: 'running', input: {}, output: ''
    }]
  }
  await page.goto(SESSION_URL)
  const task = page.getByRole('button', { name: 'Reading project files', exact: true })
  await task.scrollIntoViewIfNeeded()
  const heading = task.locator('.activity-wave')
  await expect(heading).toHaveClass(/activity-wave-active/)
  await expect(heading.locator('.activity-wave-band')).toBeVisible()
  const positions = await heading.evaluate(async (element) => {
    const animation = element.querySelector('.activity-wave-band')!.getAnimations()[0]!
    await animation.ready
    animation.pause()
    const duration = Number(animation.effect!.getComputedTiming().duration)
    // Inspect nearby painted positions inside a pass, independently of display FPS.
    return Array.from({ length: 4 }, (_, index) => {
      animation.currentTime = duration / 4 + index * 2
      return new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.activity-wave-band')!).transform).m41
    })
  })
  for (let index = 1; index < positions.length; index++) {
    expect(positions[index]!).toBeGreaterThan(positions[index - 1]!)
  }
  await heading.evaluate((element: HTMLElement) => {
    element.style.transform = 'translateX(-200vw)'
  })
  await expect(heading).not.toHaveClass(/activity-wave-active/)
  await expect(heading.locator('.activity-wave-band')).toHaveCount(0)
  await heading.evaluate((element: HTMLElement) => { element.style.transform = '' })
  await expect(heading).toHaveClass(/activity-wave-active/)
  await expect(heading.locator('.activity-wave-band')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(heading).not.toHaveClass(/activity-wave-active/)
  await expect(heading.locator('.activity-wave-band')).toHaveCount(0)
  await expect(task).toBeVisible()
})
