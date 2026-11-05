import { resolveIconName } from '../../../apps/web/src/components/icon/icon-name'
import type { Locator, Page, Route } from '@playwright/test'
import { TurnPhase } from '../../../server/src/core/llm-manager/turn-timing-contract'
import { FyiKind } from '../../../server/src/core/fyi/fyi-contract'
import type { ConversationPage, ConversationTool } from '../../../apps/web/src/data/conversation'

import { test, expect, SESSION_ID, OTHER_SESSION_ID, SESSION_URL, LATEST_ANSWER, finishFiniteAnimations } from './fixtures'

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`retains icon states and reverses interrupted toggle morphs (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
    const mute = page.getByRole('button', { name: 'Mute sounds', exact: true })
    const unmute = page.getByRole('button', { name: 'Unmute sounds', exact: true })
    const initial = await mute.locator('animate[attributeName="d"]').first().getAttribute('from')
    expect(initial).toBeNull()
    await mute.click()
    await expect(unmute.locator('[data-icon-state="off"]')).toBeVisible()
    if (reducedMotion === 'no-preference') {
      const before = await unmute.locator('svg').evaluate((element) => {
        const svg = element as SVGSVGElement
        svg.pauseAnimations()
        const path = svg.querySelectorAll('path')[1]!
        const animation = path.querySelector('animate')!
        svg.setCurrentTime(animation.getStartTime() + animation.getSimpleDuration() * 0.4)

        return path.getPointAtLength(0).y
      })
      await unmute.click()
      const after = await mute.locator('svg').evaluate((element) => {
        const svg = element as SVGSVGElement
        const path = svg.querySelectorAll('path')[1]!
        const from = path.querySelector('animate')!.getAttribute('from')!
        svg.unpauseAnimations()

        return Number(from.split('C')[0]!.split(' ')[1])
      })
      expect(after).toBeCloseTo(before, 3)
    } else {
      expect(await unmute.locator('animate[attributeName="d"]').first().getAttribute('from')).toBeNull()
      await unmute.click()
    }
    await expect(mute.locator('[data-icon-state="on"]')).toBeVisible()
    await page.reload()
    await expect(mute).toBeVisible()
    expect(await mute.locator('animate[attributeName="d"]').first().getAttribute('from')).toBeNull()
    const sidebar = page.locator('.sidebar')
    const sidebarIcon = sidebar.locator('.sidebar-controls [data-icon="sidebar-fold"], .sidebar-controls [data-icon="sidebar-unfold"]')
    const frame = await sidebarIcon.locator('path').first().getAttribute('d')
    const divider = await sidebarIcon.locator('path').nth(1).getAttribute('d')
    await expect(sidebarIcon.locator('path')).toHaveCount(3)
    await expect(sidebarIcon.locator('path').nth(1)).toHaveAttribute('opacity', '1')
    await expect(sidebarIcon.locator('path').nth(2)).toHaveAttribute('fill-opacity', '0.5')
    await page.getByRole('button', { name: 'Close sidebar', exact: true }).click()
    await expect(sidebar).toHaveClass(/sidebar-collapsed/)
    await expect(sidebarIcon.locator('[data-icon-state="unfold"]')).toHaveCount(1)
    await expect(sidebarIcon.locator('path').first()).toHaveAttribute('d', frame!)
    await expect(sidebarIcon.locator('path').nth(1)).not.toHaveAttribute('d', divider!)
    await expect(sidebarIcon.locator('path').nth(1)).toHaveAttribute('opacity', '1')
    await expect(sidebarIcon.locator('path').nth(2)).toHaveAttribute('fill-opacity', '0')
    if (reducedMotion === 'no-preference') {
      const middle = await sidebarIcon.evaluate((element) => {
        const svg = element as SVGSVGElement
        const pane = svg.querySelectorAll('path')[2]!
        const motion = pane.querySelector<SVGAnimateElement>('animate[attributeName="fill-opacity"]')!
        svg.pauseAnimations()
        svg.setCurrentTime(motion.getStartTime() + motion.getSimpleDuration() / 2)
        const opacity = Number(getComputedStyle(pane).fillOpacity)
        const dividerX = svg.querySelectorAll('path')[1]!.getPointAtLength(0).x
        svg.unpauseAnimations()

        return { opacity, dividerX }
      })
      expect(middle.opacity).toBeCloseTo(0.25, 2)
      expect(middle.dividerX).toBeCloseTo(7.5, 2)
    } else {
      expect(await sidebarIcon.locator('animate').first().getAttribute('from')).toBeNull()
    }
    await finishFiniteAnimations(sidebar)
    expect(await sidebarIcon.locator('path').nth(1).evaluate((element) => (element as SVGPathElement).getPointAtLength(0).x)).toBe(6)
    await expect(sidebar).toHaveClass(/sidebar-content-collapsed/)
    await sidebar.locator('.sidebar-logo-slot').hover()
    await expect(sidebar.locator('.sidebar-logo-open-button')).toHaveCSS('opacity', '1')
    await sidebar.locator('.sidebar-header').screenshot({ path: testInfo.outputPath(`sidebar-collapsed-${reducedMotion}.png`) })
    await sidebar.locator('.sidebar-logo-open-button button').click()
    await expect(sidebar).not.toHaveClass(/sidebar-collapsed/)
    await expect(sidebarIcon.locator('[data-icon-state="fold"]')).toHaveCount(1)
    await expect(sidebarIcon.locator('path').nth(1)).toHaveAttribute('opacity', '1')
    await expect(sidebarIcon.locator('path').nth(1)).toHaveAttribute('d', divider!)
    await expect(sidebarIcon.locator('path').nth(2)).toHaveAttribute('fill-opacity', '0.5')
    await expect(sidebarIcon.locator('path').first()).toHaveAttribute('d', frame!)
    await finishFiniteAnimations(sidebar)
    await sidebar.locator('.sidebar-header').screenshot({ path: testInfo.outputPath(`sidebar-expanded-${reducedMotion}.png`) })
    const logo = Promise.withResolvers<Route>()
    await page.route('**/img/logo-for-light-bg-text.svg', (route) => logo.resolve(route))
    const transitionStyles = await page.addStyleTag({ content: `
      html[data-theme-transition]::view-transition-group(root),
      html[data-theme-transition]::view-transition-old(root),
      html[data-theme-transition]::view-transition-new(root) { animation-duration: 1s; }
    ` })
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator(`.sidebar-controls [data-icon-state="${theme === 'light' ? 'sun' : 'moon'}"]`)).toBeVisible()
      if (theme === 'light') {
        const pending = await logo.promise
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
        await expect(page.locator('.sidebar-logo-slot img')).toHaveAttribute('src', /logo-for-dark-bg-text\.svg$/)
        const animation = page.locator('.sidebar-theme-toggle animate[attributeName="d"]').first()
        if (reducedMotion === 'no-preference') {
          await expect(animation).toHaveAttribute('from', /^M/)
        } else {
          expect(await animation.getAttribute('from')).toBeNull()
        }
        await pending.abort()
        await page.unroute('**/img/logo-for-light-bg-text.svg')
        await expect(page.getByRole('button', { name: 'Apply light theme', exact: true })).toBeVisible()
        await expect(page.locator('.sidebar-theme-toggle [data-icon-state="moon"]')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
        await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      if (reducedMotion === 'no-preference') {
        await expect(page.locator('html')).toHaveAttribute('data-theme-transition')
        const liveLayer = await page.locator('.sidebar-theme-toggle').evaluate((element) => ({
          name: getComputedStyle(element).viewTransitionName,
          old: getComputedStyle(document.documentElement, '::view-transition-old(theme-toggle)').display,
          motion: getComputedStyle(document.documentElement, '::view-transition-new(theme-toggle)').animationName
        }))
        expect(liveLayer).toEqual({ name: 'theme-toggle', old: 'none', motion: 'none' })
      }
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      const screenshot = testInfo.outputPath(`rounded-icons-${theme}-${reducedMotion}.png`)
      await page.screenshot({ path: screenshot })
      await testInfo.attach(`rounded-icons-${theme}-${reducedMotion}`, { path: screenshot, contentType: 'image/png' })
    }
    await transitionStyles.evaluate((element) => {
      element.parentNode?.removeChild(element)
    })
    expect(requests.some((url) => url.includes('remixicon') || /\.(woff2?|ttf|eot)(\?|$)/.test(url) && url.includes('icon'))).toBe(false)
    expect(ui.requests.filter((url) => url.pathname.includes('/sessions/')).length).toBeGreaterThan(0)
  })
}

test('resolves dynamic SVG artwork locally and highlights running tools with safe fallbacks', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = ''
  answer.isAddedToHistory = false
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [
    ['terminal-line', 'Shell'], ['football-line', 'Sport'], ['spotify-line', 'Music'],
    ['cursor-line', 'Cursor'], ['file-text-line', 'File'], ['file-list-3-line', 'File list'],
    ['constructor', 'Unknown'], ['<svg onload="alert(1)">', 'Untrusted']
  ].map(([icon, label], index) => ({ id: `icon-${index}`, name: 'test.tools.run', toolCallTitle: label!,
    toolIconName: icon!, toolkitIconName: label === 'Unknown' ? 'global-line' : 'tools-line', status: 'running', input: {}, output: '' })) }
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.goto(SESSION_URL)
  await expect(page.getByRole('button', { name: 'Sport', exact: true }).locator('[data-icon="football"]')).not.toHaveAttribute('data-icon-fallback')
  for (const [label, name, artwork] of [
    ['Cursor', 'cursor', 'soft-b'], ['File', 'file-text', 'soft-b'],
    ['File list', 'file-list-3', 'original'], ['Shell', 'terminal', 'original']
  ]) {
    await expect(page.getByRole('button', { name: label!, exact: true }).locator(`[data-icon="${name}"]`))
      .toHaveAttribute('data-icon-artwork', artwork!)
  }
  for (const label of ['Shell', 'Sport', 'Music', 'Unknown', 'Untrusted']) {
    const icon = page.getByRole('button', { name: label, exact: true }).locator('.tool-call-tool-icon')
    await expect(icon).toBeVisible()
    expect(await icon.locator('path').count()).toBeGreaterThan(0)
    if (label === 'Unknown' || label === 'Untrusted') {
      await expect(icon).toHaveAttribute('data-icon-fallback', label === 'Unknown' ? 'global' : 'tools')
    }
    if (label !== 'Sport') {
      await expect.poll(() => icon.locator('path').first().evaluate((element) => {
        const style = getComputedStyle(element)

        return style.stroke.startsWith('url(') || style.fill.startsWith('url(')
      })).toBe(true)
    }
  }
  expect(await page.locator('[onload]').count()).toBe(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.tool-call-tool-icon defs')).toHaveCount(0)
})

async function expectBottom(page: Page): Promise<void> {
  await expect.poll(() => page.locator('.app-main').evaluate((main) =>
    Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop)
  )).toBeLessThanOrEqual(2)
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
}

/**
 * Samples a disclosure heading through its finite motion, including late
 * virtual measurements, so a brief upward jump cannot pass a settled assertion.
 */
function recordDisclosurePositions(trigger: Locator): Promise<number[]> {
  return trigger.evaluate(async (element) => {
    const positions: number[] = []
    let settledFrames = 0
    const maximumFrames = 120
    for (let frame = 0; frame < maximumFrames && settledFrames < 3; frame++) {
      await new Promise(requestAnimationFrame)
      positions.push(element.isConnected ? element.getBoundingClientRect().top : NaN)
      const animating = element.closest('.feed')?.getAnimations({ subtree: true }).some((animation) =>
        animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity
      )
      settledFrames = element.getAttribute('aria-expanded') === 'true' && !animating ? settledFrames + 1 : 0
    }

    return positions
  })
}

test('reveals conversation loading only after one second and cancels it on navigation', async ({ page, ui }) => {
  const now = new Date('2026-11-01T12:00:00Z')
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  const loading = page.getByText('Loading conversation…', { exact: true })
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeVisible()
  await expect(loading).toHaveCount(0)
  await page.clock.runFor(999)
  await expect(loading).toHaveCount(0)
  await page.clock.runFor(1)
  await expect(loading).toBeVisible()
  await page.getByRole('link', { name: 'New session', exact: true }).click()
  await expect(page).toHaveURL(/\/web-app\/?$/)
  await page.clock.runFor(1_000)
  await expect(loading).toHaveCount(0)
  release()
  await page.clock.resume()
  await expect(loading).toHaveCount(0)
})

test('bounds inline output, virtualizes complete logs, and retains the inspector when work finishes', async ({ page, ui }, testInfo) => {
  expect(page.workers()).toHaveLength(0)
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  const tool: ConversationTool = { id: 'large-log', name: 'test.shell.run', toolCallTitle: 'Inspect the logs',
    status: 'running', input: { command: 'read logs' },
    commandOutput: Array.from({ length: 12_000 }, (_, index) => `Log line ${index}`).join('\n'),
    output: { running: true } }
  answer.message = ''
  answer.isAddedToHistory = false
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [tool] }
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Inspect the logs', exact: true }).click()
  const preview = page.getByLabel('Tool output', { exact: true })
  await expect(preview).toContainText('Log line')
  await expect(preview).not.toContainText('Log line 0')
  await expect(preview).toContainText('Log line 11999')
  expect(ui.requests.some((url) => url.searchParams.get('complete') === 'true')).toBe(false)
  expect(await preview.locator('.code-view-line').count()).toBe(16)
  expect(await preview.evaluate((element) => element.clientHeight)).toBeGreaterThan(300)
  expect(await preview.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(376)
  expect(await preview.evaluate((element) => getComputedStyle(element).overflowY)).toBe('hidden')
  await expect(preview.locator('.code-view-ellipsis')).toHaveText('…')
  await expect(preview.locator('.code-view-line').first()).toHaveAttribute('aria-label', 'Earlier content omitted')
  await page.getByRole('button', { name: 'View details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Inspect the logs', exact: true })
  await expect(dialog.locator('.tool-details-output-size')).toHaveCount(0)
  await expect(dialog.locator('.dialog-footer')).not.toContainText('characters')
  const output = dialog.getByLabel('Output JSON', { exact: true })
  await expect(output).toContainText('Log line')
  await dialog.getByRole('tab', { name: 'Input', exact: true }).click()
  await expect(dialog.getByLabel('Input JSON', { exact: true })).toContainText('read logs')
  await expect(output).toHaveCount(0)
  await dialog.getByRole('tab', { name: 'Output', exact: true }).click()
  await expect(dialog.locator('.scroll-container-viewport')).toHaveCount(1)
  await output.evaluate((element) => { element.scrollTop = 0 })
  await expect(output).toContainText('Log line 0')
  await output.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(output).toContainText('Log line 11999')
  expect(await output.locator('.code-view-line').count()).toBeLessThan(40)
  tool.status = 'success'
  tool.durationMs = 4_000
  await ui.emit([{ type: 'tool_call', sequence: 1, session_id: SESSION_ID, turn_id: 'owner',
    response_id: answer.messageId, created_at: Date.now(),
    data: { tool_call: { id: tool.id, name: tool.name, status: 'success', duration_ms: 4_000 } } }])
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Used 1 tool for 4s', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await testInfo.attach('complete-tool-output', { body: await dialog.screenshot(), contentType: 'image/png' })
  const downloadEvent = page.waitForEvent('download')
  const downloadButton = dialog.getByRole('button', { name: 'Download output', exact: true })
  await expect(downloadButton.locator('.button-label')).toHaveCount(0)
  await downloadButton.hover()
  await expect(page.locator('.tooltip-content-open')).toHaveText('Download output')
  await downloadButton.click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('tool-output.txt')
  expect(await download.failure()).toBeNull()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.workers().length).toBe(0)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`expands large groups downward without moving their headings (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 2_000 },
      reasoning: Array.from({ length: 32 }, (_, index) => ({
        id: `thought-${index}`, text: `Consider part ${index}.`, phase: 'agent', startedAt: index + 1
      })),
      toolCalls: Array.from({ length: 128 }, (_, index) => ({
        id: `expand-${index}`, name: 'test.inspect', toolCallTitle: `Inspect part ${index}`,
        status: 'success', output: `Part ${index}`
      }))
    }
    await page.goto(SESSION_URL)
    await expectBottom(page)
    const work = page.getByRole('button', { name: 'Worked for 2s', exact: true })
    const workTop = (await work.boundingBox())!.y
    const workPositions = recordDisclosurePositions(work)
    await work.click()
    expect(Math.max(...(await workPositions).map((top) => Math.abs(top - workTop)))).toBeLessThan(2)
    await finishFiniteAnimations(page.locator('.feed'))
    const group = page.getByRole('button', { name: 'Used 128 tools', exact: true })
    await group.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const groupTop = (await group.boundingBox())!.y
    const groupPositions = recordDisclosurePositions(group)
    await group.click()
    expect(Math.max(...(await groupPositions).map((top) => Math.abs(top - groupTop)))).toBeLessThan(2)
    await expect(page.getByRole('button', { name: 'Inspect part 0', exact: true })).toBeVisible()
    const leaf = page.getByRole('button', { name: 'Inspect part 0', exact: true })
    await leaf.focus()
    const leafTop = (await leaf.boundingBox())!.y
    const leafPositions = recordDisclosurePositions(leaf)
    await leaf.press('Enter')
    expect(Math.max(...(await leafPositions).map((top) => Math.abs(top - leafTop)))).toBeLessThan(2)
    await expect(page.getByRole('region', { name: 'Tool output', exact: true })).toContainText('Part 0')
    await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).click()
    await expectBottom(page)
  })
}

for (const active of [false, true]) {
  test(`virtualizes long tool groups against the conversation viewport (active: ${active})`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    if (active) {
      answer.isAddedToHistory = false
      answer.message = ''
      ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
    }
    answer.agentResponseTrace = { id: answer.messageId, planSteps: [], metrics: { durationMs: 2_000 },
      toolCalls: Array.from({ length: 128 }, (_, index) => ({ id: `tool-${index}`, name: 'test.inspect',
        toolCallTitle: `Inspect item ${index}`, status: active && index === 127 ? 'running' : 'success', output: `Result ${index}` })) }
    await page.goto(SESSION_URL)
    if (!active) {
      await page.getByRole('button', { name: 'Worked for 2s', exact: true }).click()
      await page.getByRole('button', { name: 'Used 128 tools', exact: true }).click()
    }
    const list = page.getByRole('region', { name: 'Tool calls', exact: true })
    const main = page.locator('.app-main')
    await expect(list).toBeAttached()
    await finishFiniteAnimations(page.locator('.feed'))
    await main.evaluate((element) => {
      const list = element.querySelector('[aria-label="Tool calls"]')!
      element.scrollTop += list.getBoundingClientRect().top - element.getBoundingClientRect().top - 64
    })
    await expect(list.getByRole('button', { name: 'Inspect item 0', exact: true })).toBeVisible()
    expect(await list.locator('.tool-call').count()).toBeLessThan(50)
    expect(await list.evaluate((element) => element.clientHeight)).toBeGreaterThan(360)
    await main.evaluate((element) => {
      const list = element.querySelector('[aria-label="Tool calls"]')!
      element.scrollTop += list.getBoundingClientRect().bottom - element.getBoundingClientRect().top - element.clientHeight / 2
    })
    await expect(list.getByRole('button', { name: 'Inspect item 127', exact: true })).toBeVisible()
    await expect(page.locator('.feed .scroll-container-viewport')).toHaveCount(0)
    await list.getByRole('button', { name: 'Inspect item 127', exact: true }).click()
    await expect(list.getByLabel('Tool output', { exact: true })).toContainText('Result 127')
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`keeps the feed as the only vertical scroll area (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.message = Array.from({ length: 60 }, (_, index) => `Answer paragraph ${index}.`).join('\n\n')
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 2_000 },
      toolCalls: Array.from({ length: 16 }, (_, index) => ({
        id: `scroll-${index}`, name: 'test.inspect', toolCallTitle: `Inspect section ${index}`, status: 'success',
        output: Array.from({ length: 200 }, (_, line) => `Output line ${line} ${'detail '.repeat(80)}`).join('\n')
      }))
    }
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 2s', exact: true }).click()
    await page.getByRole('button', { name: 'Used 16 tools', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect section 0', exact: true }).click()
    const tools = page.getByRole('region', { name: 'Leon’s tool usage', exact: true })
    const firstOutput = tools.getByRole('region', { name: 'Tool output', exact: true }).first()
    const main = page.locator('.app-main')

    await finishFiniteAnimations(page.locator('.feed'))
    await firstOutput.scrollIntoViewIfNeeded()
    await expect(page.locator('.feed .scroll-container-viewport')).toHaveCount(0)
    expect(await firstOutput.locator('.code-view-line').count()).toBeLessThanOrEqual(16)
    await firstOutput.hover()
    const mainTop = await main.evaluate((element) => element.scrollTop)
    await page.mouse.wheel(400, 0)
    await expect.poll(() => firstOutput.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    expect(await main.evaluate((element) => element.scrollTop)).toBe(mainTop)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(mainTop)

    await firstOutput.scrollIntoViewIfNeeded()
    await firstOutput.hover()
    const beforeUp = await main.evaluate((element) => element.scrollTop)
    await page.mouse.wheel(0, -120)
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeLessThan(beforeUp)

    await page.getByRole('button', { name: 'Choose model, current: OpenAI, GPT-6.1 Sol', exact: true }).click()
    const menuViewport = page.locator('.dropdown-content .scroll-container-viewport')
    await expect(menuViewport).toBeVisible()
    expect(await menuViewport.evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe('contain')
  })
}

test('highlights session JSON with long output strings in previews and the tabbed inspector', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
      id: 'session-output', name: 'operating_system_control.shell.readSession', toolCallTitle: 'Read the command session',
      status: 'success', input: { sessionId: 'command-session' },
      output: { result: { success: true, data: {
        sessionId: 'command-session', running: false, exitCode: 0, output: 'A shell output line.\n'.repeat(250)
      } } }
    }]
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
  await page.getByRole('button', { name: 'Used 1 tool', exact: true }).click()
  await page.getByRole('button', { name: 'Read the command session', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Tool output', exact: true })
  await expect.poll(() => preview.locator('.code-view-line > span[style]').count()).toBeGreaterThan(0)
  await expect(preview).toContainText('command-session')
  await page.getByRole('button', { name: 'View details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Read the command session', exact: true })
  const output = dialog.getByRole('region', { name: 'Output JSON', exact: true })
  await expect.poll(() => output.locator('.code-view-line > span[style]').count()).toBeGreaterThan(0)
  await expect(dialog.locator('.scroll-container-viewport')).toHaveCount(1)
  const outputTab = dialog.getByRole('tab', { name: 'Output', exact: true })
  await outputTab.focus()
  await outputTab.press('ArrowLeft')
  await expect(dialog.getByRole('tab', { name: 'Input', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('region', { name: 'Input JSON', exact: true })).toContainText('command-session')
  await expect(output).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(outputTab).toHaveAttribute('aria-selected', 'true')
  await expect(output).toContainText('A shell output line.')
})

test('shows native file-read content as code without exposing its result envelope', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  const content = `export const greeting = "${'Hello '.repeat(100)}"\n`
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
    id: 'source', name: 'file_system.file.read', toolCallTitle: 'Read source file', status: 'success', durationMs: 84,
    input: JSON.stringify({ path: 'greeting.ts' }), output: { result: { success: true,
      data: { path: 'greeting.ts', content, contentHash: 'hash', truncated: false } } }
  }] }
  await page.goto(SESSION_URL)
  expect(page.workers()).toHaveLength(0)
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('jetbrains-mono')))).toBe(false)
  await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
  await page.getByRole('button', { name: 'Used 1 tool for 84ms', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Read source file' })
  await trigger.click()
  const output = page.getByLabel('Tool output', { exact: true })
  await expect(output).toContainText(content.trim())
  await expect(output.locator('.code-view-ellipsis')).toHaveCount(0)
  expect(await output.evaluate((element) => element.clientHeight)).toBeLessThan(200)
  await output.focus()
  await output.press('ArrowRight')
  await expect.poll(() => output.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect(output).not.toContainText('contentHash')
  await expect.poll(() => output.locator('.code-view-line > span[style]').count()).toBeGreaterThan(0)
  expect(await output.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('JetBrains Mono')
  await page.getByRole('button', { name: 'View details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Read source file', exact: true })
  await expect(dialog.getByLabel('Output JSON', { exact: true })).toContainText(content.trim())
  await expect(dialog.getByLabel('Output JSON', { exact: true })).not.toContainText('contentHash')
  await expect(dialog.getByRole('button', { name: 'Structured result', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Formatted output', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await trigger.click()
  await expect.poll(() => page.workers().length).toBe(0)
})

for (const width of [1_512, 390]) {
  test(`defaults to inline diffs with accessible layout controls and raw input/output (${width})`, async ({ page, ui }, testInfo) => {
    const resources: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'script' || new URL(request.url()).pathname.endsWith('.wasm')) {
        resources.push(request.url())
      }
    })
    await page.setViewportSize({ width, height: 982 })
    if (width === 390) {
      // Restricted hosts must retain a usable diff through the JavaScript backend.
      await page.addInitScript(() => Object.defineProperty(window, 'WebAssembly', { value: undefined }))
    }
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = { id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
      id: 'edit', name: 'file_system.file.patch', toolCallTitle: 'Adjust the greeting', status: 'success', durationMs: 100,
      input: JSON.stringify({ path: 'greeting.ts', changes: [{ oldText: 'const greeting = "Hello"\n', newText: 'const greeting = "Welcome"\n' }] }),
      output: { result: { success: true, data: { changed: true, diff: '-const greeting = "Hello"\n+const greeting = "Welcome"', diffTruncated: true } } }
    }] }
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
    await page.getByRole('button', { name: 'Used 1 tool for 100ms', exact: true }).click()
    await page.getByRole('button', { name: 'Adjust the greeting' }).click()
    const diff = page.locator('.feed .tool-diff')
    await expect(diff).toHaveAttribute('data-diff-style', 'unified')
    await expect.poll(() => diff.evaluate((element) => element.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.textContent ?? ''))
      .toContain('Welcome')
    await expect.poll(() => diff.evaluate((element) => Array.from(
      element.querySelector('diffs-container')?.shadowRoot?.querySelectorAll<HTMLSpanElement>('span[style]') ?? []
    ).filter((span) => span.textContent?.trim() === 'const' && span.style.color).length)).toBeGreaterThan(0)
    await expect(page.locator('.feed .scroll-container-viewport')).toHaveCount(0)
    await expect(diff.getByRole('button')).toHaveCount(0)
    expect(await page.locator('.tool-changes-preview').evaluate((element) => element.clientHeight)).toBeLessThan(200)
    await page.setViewportSize({ width: width === 390 ? 1_512 : 390, height: 982 })
    await expect(diff).toHaveAttribute('data-diff-style', 'unified')
    await page.setViewportSize({ width, height: 982 })
    await expect(diff).toHaveAttribute('data-diff-style', 'unified')

    const details = page.getByRole('button', { name: 'View details', exact: true })
    await expect(details.locator('.button-label')).toHaveText('View details')
    await expect(details.locator('.button-icon')).toHaveCount(0)
    await expect(page.locator('.activity-details-heading').getByRole('button')).toHaveCount(0)
    await details.click()
    const dialog = page.getByRole('dialog', { name: 'Adjust the greeting', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
    const bounds = (await dialog.boundingBox())!
    expect(bounds.width).toBeLessThanOrEqual(width - 28)
    if (width > 1_000) {
      expect(bounds.width).toBeGreaterThan(1_000)
    }
    for (const height of [982, 540]) {
      await page.setViewportSize({ width, height })
      await expect.poll(async () => {
        const box = (await dialog.boundingBox())!

        return Math.abs(box.y + box.height / 2 - height / 2)
      }).toBeLessThanOrEqual(1)
      const box = (await dialog.boundingBox())!
      expect(box.y).toBeGreaterThan(0)
      expect(box.y + box.height).toBeLessThan(height)
    }
    await page.setViewportSize({ width, height: 982 })
    const dialogDiff = dialog.locator('.tool-diff')
    await expect(dialogDiff).toHaveAttribute('data-diff-style', 'unified')
    await expect(dialogDiff).toContainText('Truncated change preview.')
    const views = dialogDiff.getByRole('group', { name: 'Diff view', exact: true })
    expect(await views.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
      .toEqual(['Inline view', 'Split view'])
    await expect(views.getByRole('button', { name: 'Inline view', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(views.locator('[data-icon="list-check"]')).toHaveCount(1)
    await expect(dialog.getByRole('button', { name: 'Hunk view', exact: true })).toHaveCount(0)
    const dialogToggle = dialogDiff.getByRole('button', { name: 'Split view', exact: true })
    await expect(dialogToggle.locator('.button-label')).toHaveCount(0)
    await dialogToggle.focus()
    const tooltip = page.locator('.tooltip-content-open')
    await expect(tooltip).toHaveText('Split view')
    const tooltipLayer = await tooltip.evaluate((element) => Number(getComputedStyle(element).zIndex))
    const dialogLayer = await dialog.locator('..').evaluate((element) => Number(getComputedStyle(element).zIndex))
    expect(tooltipLayer).toBeGreaterThan(dialogLayer)
    await dialogToggle.press('Enter')
    await expect(dialogDiff).toHaveAttribute('data-diff-style', 'split')
    await expect(dialogToggle).toBeFocused()
    const inlineToggle = dialogDiff.getByRole('button', { name: 'Inline view', exact: true })
    await finishFiniteAnimations(dialog.locator('..'))
    await testInfo.attach(`tool-diff-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
    await inlineToggle.press('Enter')
    await expect(dialogDiff).toHaveAttribute('data-diff-style', 'unified')
    await dialog.getByRole('tab', { name: 'Input', exact: true }).click()
    await expect(dialog.getByLabel('Input JSON', { exact: true })).toContainText('oldText')
    await expect(dialog.getByLabel('Output JSON', { exact: true })).toHaveCount(0)
    await dialog.getByRole('tab', { name: 'Output', exact: true }).click()
    await expect(dialog.getByLabel('Output JSON', { exact: true })).toContainText('diffTruncated')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'View details', exact: true })).toBeFocused()
    await expect(details).toHaveCSS('outline-style', 'none')
    await details.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(details).toBeFocused()
    await expect(details).not.toHaveCSS('outline-style', 'none')
    await details.press('Enter')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(details).toBeFocused()
    await expect(details).not.toHaveCSS('outline-style', 'none')
    await expect(diff).toHaveAttribute('data-diff-style', 'unified')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    expect(resources.some((url) => new URL(url).pathname.endsWith('.wasm'))).toBe(false)
    await testInfo.attach('syntax-resource-requests', {
      body: JSON.stringify(resources, null, 2), contentType: 'application/json'
    })
  })
}

test('bounds long diff previews and retains recorded context in both inspector layouts', async ({ page, ui }) => {
  const before = Array.from({ length: 60 }, (_, index) => `const marker${index} = ${index};`)
  before[0] = `const description = "${'Context '.repeat(100)}";`
  const after = [...before]
  after[10] = 'const marker10 = 100;'
  after[45] = 'const marker45 = 450;'
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
      id: 'context-edit', name: 'file_system.file.patch', toolCallTitle: 'Update both markers', status: 'success',
      input: JSON.stringify({ path: 'markers.ts', changes: [{ oldText: before.join('\n'), newText: after.join('\n') }] }),
      output: { result: { success: true, data: { changed: true, diff: '-marker10 = 10\n+marker10 = 100' } } }
    }]
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
  await page.getByRole('button', { name: 'Used 1 tool', exact: true }).click()
  await page.getByRole('button', { name: 'Update both markers', exact: true }).click()
  const preview = page.locator('.tool-changes-preview')
  const previewCode = preview.locator('[data-code]').first()
  await expect(previewCode).toBeVisible()
  expect(await preview.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(454)
  expect(await preview.evaluate((element) => element.clientHeight)).toBeGreaterThan(300)
  await previewCode.hover()
  await page.mouse.wheel(400, 0)
  await expect.poll(() => previewCode.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  const previewBounds = (await preview.boundingBox())!
  const codeBounds = (await previewCode.boundingBox())!
  expect(codeBounds.y + codeBounds.height).toBeLessThanOrEqual(previewBounds.y + previewBounds.height)
  const main = page.locator('.app-main')
  const mainTop = await main.evaluate((element) => element.scrollTop)
  await page.mouse.wheel(0, -120)
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeLessThan(mainTop)
  expect(await previewCode.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(preview.getByLabel('More content omitted', { exact: true })).toHaveText('…')
  await page.getByRole('button', { name: 'View details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Update both markers', exact: true })
  const diff = dialog.locator('.tool-diff')
  const text = (): Promise<string> => diff.evaluate((element) =>
    element.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.textContent ?? '')
  await expect.poll(text).toContain('marker30')
  const controls = diff.getByRole('group', { name: 'Diff view', exact: true })
  const inline = controls.getByRole('button', { name: 'Inline view', exact: true })
  const split = controls.getByRole('button', { name: 'Split view', exact: true })
  expect(await controls.locator('[data-icon="list-check"]').evaluateAll((icons) =>
    icons.every((icon) => icon.querySelector('path') !== null && (icon as SVGSVGElement).getBBox().width > 0))).toBe(true)
  await expect.poll(text).toContain('marker10')
  await expect.poll(text).toContain('marker45')
  await split.click()
  await expect(split).toHaveAttribute('aria-pressed', 'true')
  await expect(diff).toHaveAttribute('data-diff-style', 'split')
  await expect.poll(text).toContain('marker30')
  await inline.press('Enter')
  await expect(inline).toHaveAttribute('aria-pressed', 'true')
  await expect(diff).toHaveAttribute('data-diff-style', 'unified')
  await expect.poll(text).toContain('marker30')
  await expect(controls.getByRole('button')).toHaveCount(2)
})

for (const wasm of [true, false]) {
  test(`keeps file diffs readable outside the JavaScript grammar catalog (Wasm: ${wasm})`, async ({ page, ui }) => {
    if (!wasm) {
      await page.addInitScript(() => Object.defineProperty(window, 'WebAssembly', { value: undefined }))
    }
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
        id: 'cpp-edit', name: 'file_system.file.patch', toolCallTitle: 'Adjust the counter', status: 'success',
        input: JSON.stringify({ path: 'counter.cpp', changes: [{ oldText: 'int count = 1;\n', newText: 'int count = 2;\n' }] }),
        output: { result: { success: true, data: { changed: true, diff: '-int count = 1;\n+int count = 2;' } } }
      }]
    }
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
    await page.getByRole('button', { name: 'Used 1 tool', exact: true }).click()
    await page.getByRole('button', { name: 'Adjust the counter', exact: true }).click()
    const diff = page.locator('.feed .tool-diff')
    await expect.poll(() => diff.evaluate((element) =>
      element.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.textContent ?? ''
    )).toContain('count = 2')
    if (wasm) {
      await expect.poll(() => diff.evaluate((element) => Array.from(
        element.querySelector('diffs-container')?.shadowRoot?.querySelectorAll<HTMLSpanElement>('span[style]') ?? []
      ).filter((span) => span.textContent?.trim() === 'int' && span.style.color).length)).toBeGreaterThan(0)
    }
    await expect(diff.getByRole('button')).toHaveCount(0)
    await page.getByRole('button', { name: 'View details', exact: true }).click()
    const dialogDiff = page.getByRole('dialog').locator('.tool-diff')
    await dialogDiff.getByRole('button', { name: 'Split view', exact: true }).click()
    await expect(dialogDiff).toHaveAttribute('data-diff-style', 'split')
    expect(errors).toEqual([])
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`navigates virtual session search from the keyboard without leaving its input (${reducedMotion})`, async ({ page, ui }) => {
    for (let index = ui.sessions.length; index < 80; index++) {
      const session = { ...ui.sessions[0]!, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Test session ${index}` }
      ui.sessions.push(session)
      ui.history.set(session.id, [])
    }
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const trigger = page.getByRole('button', { name: 'Search sessions', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Search sessions', exact: true })
    const search = dialog.getByRole('combobox', { name: 'Search sessions', exact: true })
    const results = dialog.getByRole('listbox', { name: 'Matching sessions', exact: true })
    await expect(search).toBeFocused()
    await search.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
    await expect(search).not.toHaveAttribute('aria-activedescendant')
    await search.press('ArrowDown')
    await expect(results.getByRole('option', { name: /^Test session 0 / })).toHaveAttribute('aria-selected', 'true')
    await search.press('ArrowDown')
    await expect(results.getByRole('option', { name: /^Test session 1 / })).toHaveAttribute('aria-selected', 'true')
    await search.press('ArrowUp')
    await expect(search).toBeFocused()
    await search.fill('Test session')
    await expect.poll(() => ui.requests.some((url) => url.searchParams.get('query') === 'Test session')).toBe(true)
    await search.press('ArrowUp')
    const last = results.getByRole('option', { name: /^Test session 79 / })
    await expect(last).toBeVisible()
    await expect(last).toHaveAttribute('aria-selected', 'true')
    await expect(search).toHaveAttribute('aria-activedescendant', await last.getAttribute('id') ?? '')
    expect(await results.getByRole('option').count()).toBeLessThan(30)
    await search.press('Home')
    expect(await search.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe(0)
    await expect(last).toHaveAttribute('aria-selected', 'true')
    await search.fill('no-matching-session')
    await search.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(new RegExp(SESSION_ID))
    await expect(dialog.getByText('No session found.', { exact: true })).toBeVisible()
    await search.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(search).toBeFocused()
    await search.fill('Test session 1')
    await expect(search).toHaveAttribute('aria-busy', 'false')
    await expect(results.getByRole('option', { name: /^Test session 1 / })).toBeVisible()
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  })
}

test('moves sidebar focus across virtual rows without opening a session until Enter', async ({ page, ui }) => {
  for (let index = ui.sessions.length; index < 80; index++) {
    const session = { ...ui.sessions[0]!, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Test session ${index}` }
    ui.sessions.push(session)
    ui.history.set(session.id, [])
  }
  await page.goto(SESSION_URL)
  const first = page.getByRole('link', { name: 'Test session 0', exact: true })
  await first.focus()
  await first.press('End')
  const last = page.getByRole('link', { name: 'Test session 79', exact: true })
  await expect(last).toBeFocused()
  await expect(last).toBeVisible()
  expect(await page.locator('.session-list-item').count()).toBeLessThan(40)
  await last.press('Home')
  await expect(first).toBeFocused()
  await first.press('ArrowDown')
  const second = page.getByRole('link', { name: 'Test session 1', exact: true })
  await expect(second).toBeFocused()
  await expect(page).toHaveURL(new RegExp(SESSION_ID))
  await second.press('Shift+ArrowDown')
  await expect(second).toBeFocused()
  await second.press('Enter')
  await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
})

test('opens and navigates session action menus with arrows, boundaries and native activation', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Test session 0', exact: true }) })
  await row.getByRole('link').focus()
  const trigger = row.getByRole('button', { name: 'Session options', exact: true })
  await trigger.focus()
  await trigger.press('ArrowDown')
  const menu = page.getByRole('menu')
  const rename = menu.getByRole('menuitem', { name: 'Rename', exact: true })
  await expect(rename).toBeFocused()
  await rename.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Pin session', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rename).toBeFocused()
  await rename.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await rename.press('Enter')
  const title = page.getByRole('textbox', { name: 'Session title', exact: true })
  await expect(title).toBeFocused()
  await title.press('Home')
  await title.press('ArrowDown')
  await expect(title).toBeFocused()
  await title.press('Escape')
  await row.getByRole('link').focus()
  await trigger.press('Enter')
  await expect(rename).toBeFocused()
  await rename.press('Tab')
  await expect(menu).toBeHidden()
})

test('reveals active session options on hover or keyboard focus rather than selection', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Test session 0', exact: true }) })
  const link = row.getByRole('link')
  const actions = row.locator('.session-list-item-actions')
  await composer.focus()
  await composer.hover()
  await expect(link).toHaveClass(/session-list-item-active/)
  await expect(actions).toHaveCSS('opacity', '0')
  await row.hover()
  await expect(actions).toHaveCSS('opacity', '1')
  await link.click()
  await composer.hover()
  await expect(actions).toHaveCSS('opacity', '0')
  await link.focus()
  await page.keyboard.press('Tab')
  const options = row.getByRole('button', { name: 'Session options', exact: true })
  await expect(options).toBeFocused()
  await expect(actions).toHaveCSS('opacity', '1')
  await options.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible()
})

for (const pinned of [false, true]) {
  test(`tracks unread concurrent completions through hover, navigation and refresh (pinned: ${pinned})`, async ({ page, ui }, testInfo) => {
    ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
    ui.sessions[1]!.status = 'wip' as typeof ui.sessions[1]['status']
    ui.sessions[1]!.isPinned = pinned
    await page.goto(SESSION_URL)
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    const otherLink = page.getByRole('link', { name: /Test session 1/ })
    const row = page.getByRole('listitem').filter({ has: otherLink })
    const dot = row.locator('.session-list-item-unread-dot')
    const options = row.getByRole('button', { name: 'Session options', exact: true })
    ui.sessions[1]!.status = 'idle' as typeof ui.sessions[1]['status']
    const completion = { type: 'turn_status', sequence: 10, session_id: OTHER_SESSION_ID,
      turn_id: 'other-turn', response_id: 'other-answer', created_at: Date.now(), data: { status: 'completed' } }
    await ui.emit([completion, {
      ...completion, type: 'session_changed', sequence: 11, data: { is_running: false }
    }])
    await expect(otherLink).toHaveAccessibleName('Test session 1, Unread response')
    await composer.hover()
    await expect(dot).toBeVisible()
    await expect(options).toHaveCSS('opacity', '1')
    await expect(row.locator('.session-list-item-actions')).toHaveCSS('opacity', '0')
    const dotBounds = (await dot.boundingBox())!
    const optionsBounds = (await options.boundingBox())!
    expect(Math.abs(dotBounds.x + dotBounds.width / 2 - optionsBounds.x - optionsBounds.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(dotBounds.y + dotBounds.height / 2 - optionsBounds.y - optionsBounds.height / 2)).toBeLessThanOrEqual(1)
    if (pinned) {
      const pinBounds = (await row.locator('.session-list-item-pinned-icon').boundingBox())!
      expect(pinBounds.x + pinBounds.width).toBeLessThan(dotBounds.x)
    }
    expect(ui.historyRequests.some((url) => url.pathname.endsWith(OTHER_SESSION_ID))).toBe(false)
    await row.hover()
    await expect(dot).not.toBeVisible()
    await expect(row.locator('.session-list-item-actions')).toHaveCSS('opacity', '1')
    await composer.hover()
    await expect(dot).toBeVisible()
    await otherLink.focus()
    await expect(dot).not.toBeVisible()
    await page.keyboard.press('Tab')
    await expect(options).toBeFocused()
    await expect(row.locator('.session-list-item-actions')).toHaveCSS('opacity', '1')
    await composer.focus()
    await composer.hover()
    await expect(dot).toBeVisible()

    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await composer.focus()
      await composer.hover()
      await expect(dot).toBeVisible()
      await expect(dot).toHaveCSS('background-color', 'rgb(28, 117, 219)')
      await page.screenshot({ path: testInfo.outputPath(`unread-${theme}.png`) })
    }

    await page.reload()
    await expect(dot).toBeVisible()
    await otherLink.click()
    await expect(page).toHaveURL(new RegExp(`/session/${OTHER_SESSION_ID}$`))
    await expect(dot).toHaveCount(0)
    await page.getByRole('link', { name: /Test session 0/ }).click()
    await composer.hover()
    await expect(dot).toHaveCount(0)
    await ui.emit([completion])
    await expect(dot).toHaveCount(0)
    await page.reload()
    await expect(dot).toHaveCount(0)
  })
}

test('marks only unseen successful completions and scopes them to the profile', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const third = ui.sessions[2]!.id
  let sequence = 0
  const emit = (sessionId: string, type: string, data: Record<string, unknown>): ReturnType<typeof ui.emit> => ui.emit([{
    type, sequence: ++sequence, session_id: sessionId, turn_id: `turn-${sequence}`,
    response_id: `answer-${sequence}`, created_at: Date.now(), data
  }])
  const dots = page.locator('.session-list-item-unread-dot')
  await emit(SESSION_ID, 'turn_status', { status: 'completed' })
  await emit(OTHER_SESSION_ID, 'turn_status', { status: 'stopped' })
  await emit(third, 'turn_status', { status: 'error' })
  await emit(OTHER_SESSION_ID, 'turn_status', { status: 'completed', consumed: true })
  await emit(OTHER_SESSION_ID, 'fyi', { fyi: { kind: 'mood', text: 'I am taking it gently today.' } })
  await emit(OTHER_SESSION_ID, 'session_changed', { is_running: false })
  await emit(OTHER_SESSION_ID, 'progress_message', { background: true, message: { id: 'background', content: 'Saved a useful detail.' } })
  await expect(dots).toHaveCount(0)
  await emit(OTHER_SESSION_ID, 'turn_status', { status: 'completed' })
  await expect(dots).toHaveCount(1)
  const profile = ui.profile
  ui.profile = 'another-owner'
  await page.reload()
  await expect(page.getByRole('link', { name: 'Test session 1', exact: true })).toBeVisible()
  await expect(dots).toHaveCount(0)
  ui.profile = profile
  await page.reload()
  await expect(dots).toHaveCount(1)
})

test('distinguishes the selected session from concurrent WIP rows in both themes', async ({ page, ui }, testInfo) => {
  for (const session of ui.sessions) {
    session.status = 'wip' as typeof session.status
  }
  await page.goto(SESSION_URL)
  const selected = page.getByRole('link', { name: /Test session 0/ })
  const other = page.getByRole('link', { name: /Test session 1/ })
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
    await composer.hover()
    const colors = await selected.evaluate((element) => {
      const actual = getComputedStyle(element).backgroundColor
      const probe = document.createElement('span')
      probe.style.position = 'fixed'
      probe.style.backgroundColor = 'var(--color-sidebar-background-active)'
      document.body.appendChild(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { actual, expected }
    })
    expect(colors.actual).toBe(colors.expected)
    expect(colors.actual).not.toBe(await other.evaluate((element) => getComputedStyle(element).backgroundColor))
    await selected.hover()
    await expect(selected).toHaveCSS('background-color', colors.expected)
    await other.hover()
    await page.mouse.down()
    await expect(other).toHaveCSS('background-color', colors.expected)
    await composer.hover()
    await page.mouse.up()
    await composer.hover()
    await expect(selected.locator('.session-work-indicator')).toHaveCount(1)
    await expect(other.locator('.session-work-indicator')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`concurrent-selection-${theme}.png`) })
  }
})

test('drafts immediately while history loads and opens the latest messages at the bottom', async ({ page, ui }, testInfo) => {
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
  await composer.fill('Draft before loading')
  await composer.press('Enter')
  await expect(composer).toHaveValue('Draft before loading')
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toHaveCount(0)
  const loading = page.getByRole('status').filter({ hasText: 'Loading conversation…' })
  await expect(loading).toBeVisible()
  await expect(loading.getByRole('button')).toHaveCount(0)
  await expect(loading.locator('.loader-md .loader-indicator')).toHaveCSS('width', '20px')
  await expect(loading.locator('.loader-md .loader-indicator')).toHaveCSS('height', '20px')
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
    await expect.poll(() => loading.evaluate((element) => {
      const form = document.querySelector('.query-input')!.getBoundingClientRect()
      const main = document.querySelector('.app-main')!.getBoundingClientRect()
      const top = main.top + Number.parseFloat(getComputedStyle(document.querySelector('.feed')!).paddingTop)
      const text = element.querySelector('p')!.getBoundingClientRect()
      return Math.max(Math.abs(text.top + text.height / 2 - (top + form.top) / 2),
        Math.abs(text.left + text.width / 2 - form.left - form.width / 2))
    })).toBeLessThanOrEqual(2)
    await page.evaluate(async () => {
      await Promise.allSettled(document.getAnimations().filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished))
    })
    const path = testInfo.outputPath(`loading-${theme}.png`)
    await page.screenshot({ path })
    await testInfo.attach(`loading-${theme}`, { path, contentType: 'image/png' })
  }
  await composer.focus()
  release()
  await expectBottom(page)
  await expect(composer).toHaveValue('Draft before loading')
  await expect(composer).toBeFocused()
  await expect(loading).toHaveCount(0)
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

test('keeps owner text directly selectable with its bubble selection colors and no tooltip', async ({ page, ui }) => {
  const text = 'A message whose text can be selected.'
  ui.history.get(SESSION_ID)!.at(-2)!.message = text
  await page.goto(SESSION_URL)
  const owner = page.locator('.owner-message').last()
  await expect(owner).toHaveText(text)
  await owner.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme)
    const selected = await owner.evaluate((element) => {
      const textNode = element.firstChild!
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      const highlight = getComputedStyle(element, '::selection')
      return { text: selection.toString(), plainText: textNode.nodeType === Node.TEXT_NODE && element.childNodes.length === 1,
        background: highlight.backgroundColor, foreground: getComputedStyle(element).color }
    })
    expect(selected.text).toBe(text)
    expect(selected.plainText).toBe(true)
    expect(selected.background).toBe(selected.foreground)
  }
})

for (const { theme, motion, width } of [
  { theme: 'dark', motion: 'no-preference', width: 1_512 },
  { theme: 'light', motion: 'reduce', width: 390 }
] as const) {
  test(`reveals message copy, dates and recorded token information without shifting text (${theme})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion: motion })
    await page.clock.setFixedTime(new Date(2026, 10, 6, 17))
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const timestamp = new Date(2026, 10, 6, 16, 28, 15).getTime()
    const ownerText = '  Keep these spaces.\nAnd this second line.'
    const answerText = 'A clear answer with enough detail to explain the result.\n\nKeep this paragraph and its new lines when copying.\nOne more line.'
    ui.history.set(SESSION_ID, [
      { who: 'owner', messageId: 'metadata-owner', message: ownerText, sentAt: timestamp, isAddedToHistory: true },
      { who: 'leon', messageId: 'metadata-answer', message: answerText, sentAt: timestamp,
        isAddedToHistory: true, fyi: { kind: FyiKind.Vision, text: 'A separate FYI.' },
        llmMetrics: { inputTokens: 1_200, outputTokens: 80, totalTokens: 1_280,
          tokensPerSecond: 0, averagedPhaseTokensPerSecond: 42.5,
          durationMs: 12_345, reviewCount: 2, reviewDurationMs: 500,
          contextUsedTokens: 4_096, contextWindowTokens: 32_768, contextUsagePercent: 12.5,
          contextUsageEstimated: true, completionCount: 2,
          usageAccounting: { cachedInputTokens: 400, cacheReadCompletionCount: 1, cacheWriteInputTokens: 64 } } }
    ])
    await page.goto(SESSION_URL)
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    }
    await page.setViewportSize({ width, height: 982 })
    await expect(page.getByText('A separate FYI.', { exact: true })).toBeVisible()
    await finishFiniteAnimations(page.locator('.app-main'))
    const owner = page.locator('.owner-message')
    const ownerActions = page.getByRole('group', { name: 'Owner message actions', exact: true })
    const answer = page.locator('.final-answer')
    const answerActions = answer.getByRole('group', { name: 'Answer actions', exact: true })
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(ownerActions).toHaveCSS('opacity', '0')
    await expect(answerActions).toHaveCSS('opacity', '0')
    for (const actions of [ownerActions, answerActions]) {
      const bounds = (await actions.boundingBox())!
      expect(bounds.width).toBeGreaterThanOrEqual((await page.locator('.feed').boundingBox())!.width)
      const pointerX = actions === ownerActions ? bounds.x + 16 : bounds.x + bounds.width - 16
      await page.mouse.move(pointerX, bounds.y + 1)
      await expect(actions).toHaveCSS('opacity', '1')
      expect(await actions.evaluate((element) => {
        const date = element.querySelector('time')!
        const button = element.querySelector('button')!
        const style = getComputedStyle(element)
        const dateStyle = getComputedStyle(date)
        return {
          sameColor: dateStyle.color === getComputedStyle(button).color,
          mediumSize: dateStyle.fontSize === style.getPropertyValue('--font-size-md').trim(),
          mediumLineHeight: dateStyle.lineHeight === style.getPropertyValue('--line-height-md').trim()
        }
      })).toEqual({ sameColor: true, mediumSize: true, mediumLineHeight: true })
      await page.getByRole('textbox', { name: 'Message Leon' }).hover()
      await expect(actions).toHaveCSS('opacity', '0')
    }
    const position = await owner.boundingBox()
    const feedBounds = (await page.locator('.feed').boundingBox())!
    await page.mouse.move(feedBounds.x + 1, position!.y + position!.height / 2)
    await expect(ownerActions).toHaveCSS('opacity', '0')
    await owner.hover()
    await expect(ownerActions).toHaveCSS('opacity', '1')
    expect(await owner.boundingBox()).toEqual(position)
    const ownerDate = ownerActions.locator('time')
    await expect(ownerDate).toHaveText('Today, 16:28')
    await ownerDate.hover()
    await expect(page.locator('.tooltip-content-open')).toHaveText('2026-11-06 16:28:15')
    const ownerCopy = ownerActions.getByRole('button', { name: 'Copy message', exact: true })
    const ownerIcon = (await ownerCopy.locator('.app-icon').boundingBox())!
    expect(Math.abs(ownerIcon.x + ownerIcon.width - position!.x - position!.width)).toBeLessThan(1)
    expect((await ownerDate.boundingBox())!.x).toBeLessThan((await ownerCopy.boundingBox())!.x)
    await ownerCopy.hover()
    await expect(page.locator('.tooltip-content-open')).toHaveText('Copy message')
    await ownerCopy.click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ownerText)
    await expect(ownerActions.locator('[data-icon-state="copied"]')).toBeVisible()
    await answer.locator('.streaming-text-characters').first().hover()
    await expect(answerActions).toHaveCSS('opacity', '1')
    const answerCopy = answerActions.getByRole('button', { name: 'Copy message', exact: true })
    const answerIcon = (await answerCopy.locator('.app-icon').boundingBox())!
    expect(Math.abs(answerIcon.x - (await answer.boundingBox())!.x)).toBeLessThan(1)
    expect(await answer.evaluate((element) => {
      const footer = element.querySelector('.bonus-response')!
      const button = element.querySelector('.message-metadata button')!
      const gap = button.getBoundingClientRect().top - footer.getBoundingClientRect().bottom
      return Math.abs(gap - parseFloat(getComputedStyle(element).getPropertyValue('--space-md')))
    })).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await answerCopy.click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(answerText)
    const info = answerActions.getByRole('button', { name: 'Turn info', exact: true })
    const copyBounds = (await answerActions.locator('button').first().boundingBox())!
    const infoBounds = (await info.boundingBox())!
    expect(Math.abs(infoBounds.x - copyBounds.x - copyBounds.width)).toBeLessThan(0.5)
    expect((await info.boundingBox())!.x).toBeLessThan((await answerActions.locator('time').boundingBox())!.x)
    await info.hover()
    await expect(page.locator('.tooltip-content-open')).toHaveText('Turn info')
    await info.click()
    const dialog = page.getByRole('dialog', { name: 'Turn info', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.hover()
    await expect(answerActions).toHaveCSS('opacity', '1')
    const rows = dialog.locator('.message-info-row')
    await expect(rows.locator('dt')).toHaveText([
      'Tokens', 'Cached input tokens', 'Tokens per second', 'Context usage'
    ])
    for (const [label, value] of [
      ['Tokens', '1,200 in · 80 out · 1,280 total'],
      ['Cached input tokens', '400 (partial)'],
      ['Tokens per second', '42.50'], ['Context usage', '~4,096 / 32,768 (12.5%)']
    ]) {
      const row = rows.filter({ has: page.getByText(label!, { exact: true }) })
      await expect(row.locator('dd')).toHaveText(value!)
      await expect(row.locator('.app-icon')).not.toHaveAttribute('data-icon-fallback')
    }
    await expect(rows.filter({ hasText: 'Cached input tokens' }).locator('.app-icon'))
      .toHaveAttribute('data-icon', 'database')
    await expect(dialog).not.toContainText(/duration|review/i)
    await expect(info).toHaveAttribute('aria-expanded', 'true')
    const screenshot = testInfo.outputPath(`message-information-${theme}.png`)
    await page.screenshot({ path: screenshot })
    await testInfo.attach(`message-information-${theme}`, { path: screenshot, contentType: 'image/png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(info).toBeFocused()
    await expect(info).toHaveCSS('outline-style', 'none')
    await page.reload()
    await answer.locator('.streaming-text-characters').first().hover()
    await info.click()
    await expect(dialog.locator('.message-info-row').filter({ has: page.getByText('Tokens', { exact: true }) }))
      .toContainText('1,200 in · 80 out · 1,280 total')
  })
}

test('keeps absent accounting unknown and updates recorded turn info from live events', async ({ page, ui }) => {
  const response = ui.history.get(SESSION_ID)!.at(-1)!
  response.message = 'A saved answer without recorded usage.'
  response.isAddedToHistory = false
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.goto(SESSION_URL)
  const answer = page.locator('.final-answer').last()
  expect(await answer.locator('.message-metadata').evaluate((element) => {
    const style = getComputedStyle(element)
    return style.paddingTop === style.getPropertyValue('--space-xs').trim()
  })).toBe(true)
  await answer.locator('.streaming-text-characters').first().hover()
  const info = answer.getByRole('button', { name: 'Turn info', exact: true })
  await info.focus()
  await info.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Turn info', exact: true })
  await expect(dialog).toHaveText('No usage data recorded.')
  await expect(dialog.getByLabel('Recorded token metrics', { exact: true })).toBeFocused()
  await ui.emit([{ type: 'metrics', sequence: 1, session_id: SESSION_ID, turn_id: 'live-metrics',
    response_id: response.messageId, created_at: Date.now(),
    data: { metrics: { inputTokens: 0, outputTokens: 18, totalTokens: 18, tokensPerSecond: 12.5,
      contextUsedTokens: 640, contextUsageEstimated: false,
      usageAccounting: { cachedInputTokens: 0, cacheReadCompletionCount: 0, cacheWriteInputTokens: 0 } } } }])
  await expect(dialog.locator('.message-info-row')).toHaveCount(3)
  await expect(dialog.locator('.message-info-row').filter({ has: page.getByText('Tokens', { exact: true }) }))
    .toContainText('0 in · 18 out · 18 total')
  await expect(dialog.locator('.message-info-row').filter({ hasText: 'Context usage' })).toContainText('640 tokens')
  await expect(dialog).not.toContainText(/cache|duration|review/i)
  await page.keyboard.press('Escape')
  await expect(info).toBeFocused()
})

test.describe('touch message actions', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('keeps copy and information available without hover', async ({ page, ui }) => {
    ui.history.set(SESSION_ID, ui.history.get(SESSION_ID)!.slice(-2))
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(SESSION_URL)
    const ownerActions = page.getByRole('group', { name: 'Owner message actions', exact: true })
    const answerActions = page.getByRole('group', { name: 'Answer actions', exact: true })
    await expect(ownerActions).toHaveCSS('opacity', '1')
    await expect(answerActions).toHaveCSS('opacity', '1')
    await answerActions.getByRole('button', { name: 'Copy message', exact: true }).tap()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(LATEST_ANSWER)
    await answerActions.getByRole('button', { name: 'Turn info', exact: true }).tap()
    const dialog = page.getByRole('dialog', { name: 'Turn info', exact: true })
    await expect(dialog).toBeVisible()
    await page.getByRole('textbox', { name: 'Message Leon' }).tap()
    await expect(dialog).toHaveCount(0)
    await expect(answerActions).toHaveCSS('opacity', '1')
  })
})

test('centers general errors in the usable feed area on session and new-session pages', async ({ page, ui }, testInfo) => {
  ui.failure = { path: '/api/v1/profile-auth', status: 503, message: 'I could not complete this request. Please try again.' }
  for (const url of [SESSION_URL, './']) {
    if (url === SESSION_URL) {
      await page.goto(url)
    } else {
      await page.getByRole('link', { name: 'New session', exact: true }).click()
    }
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    for (const draft of ['', 'A restored draft\nwith several lines\nand more room to type.']) {
      await composer.fill(draft)
      await page.getByRole('form', { name: 'Send a message to Leon' }).evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished))
      })
      await expect.poll(() => alert.evaluate((element) => {
        const form = document.querySelector('.query-input')!.getBoundingClientRect()
        const main = document.querySelector('.app-main')!.getBoundingClientRect()
        const feed = document.querySelector('.feed')
        const top = main.top + (feed ? Number.parseFloat(getComputedStyle(feed).paddingTop) : 0)
        const text = element.querySelector('p')!.getBoundingClientRect()
        const button = element.querySelector('button')!.getBoundingClientRect()
        return Math.max(
          Math.abs((text.top + button.bottom) / 2 - (top + form.top) / 2),
          Math.abs(text.left + text.width / 2 - form.left - form.width / 2),
          Math.abs(button.left + button.width / 2 - form.left - form.width / 2)
        )
      })).toBeLessThanOrEqual(2)
      await expect(alert).toHaveCSS('text-align', 'center')
      await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    }
    const path = testInfo.outputPath(url === './' ? 'new-session-error.png' : 'session-error.png')
    await page.screenshot({ path })
    await testInfo.attach(url === './' ? 'new-session-error' : 'session-error', { path, contentType: 'image/png' })
  }
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
    if (reducedMotion === 'reduce') {
      await page.clock.install()
    }
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
    if (reducedMotion === 'reduce') {
      await page.clock.fastForward(2_000)
    }
    const requests = ui.completedRequests.filter((url) => url.pathname.endsWith('/page')).length
    await ui.emit([{ type: 'sessions_changed' }])
    await expect.poll(() => ui.completedRequests.filter((url) => url.pathname.endsWith('/page')).length).toBeGreaterThan(requests)
    await expect(characters).toHaveCount(0)
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

  test(`keeps title fades continuous when pinning reorders existing rows (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    if (reducedMotion === 'reduce') {
      await page.clock.install()
    }
    const session = ui.sessions[0]!
    const other = ui.sessions[1]!
    await page.route(`**/api/v1/sessions/${OTHER_SESSION_ID}?compact=true`, async (route) => {
      const changes = route.request().postDataJSON() as { is_pinned: boolean }
      other.isPinned = changes.is_pinned
      ui.sessions.sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || left.id.localeCompare(right.id))
      await route.fulfill({ json: { session: other } })
    })
    await page.goto(SESSION_URL)
    const otherRow = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: other.title, exact: true }) })
    await otherRow.hover()
    await otherRow.getByRole('button', { name: 'Session options', exact: true }).click()
    session.title = 'A freshly generated session title with enough detail to stay readable while another session moves to the pinned position'
    await ui.emit([{ type: 'sessions_changed' }])
    const link = page.getByRole('link', { name: session.title, exact: true })
    const characters = link.locator('.session-list-item-title-resting .streaming-text-character-new')
    await expect(characters).not.toHaveCount(0)
    const character = (await characters.last().elementHandle())!
    let start: number | null = null
    if (reducedMotion === 'no-preference') {
      await expect.poll(() => character.evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? 0))).toBeGreaterThan(80)
      start = await character.evaluate((element) => element.getAnimations()[0]!.startTime as number)
    }
    await page.getByRole('menuitem', { name: 'Pin session', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Recents', exact: true }).getByRole('link').first()).toHaveAttribute('data-session-id', OTHER_SESSION_ID)
    if (reducedMotion === 'no-preference') {
      await expect.poll(() => character.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).not.toBeNull()
      const after = await character.evaluate((element) => element.getAnimations()[0]!.startTime as number)
      expect(Math.abs(after - start!)).toBeLessThan(35)
      await finishFiniteAnimations(link)
    } else {
      await expect(characters.last()).toHaveCSS('animation-name', 'none')
      await expect(characters.last()).toHaveCSS('opacity', '1')
      await page.clock.fastForward(2_000)
    }
    await otherRow.hover()
    await otherRow.getByRole('button', { name: 'Session options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Unpin session', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Recents', exact: true }).getByRole('link').first()).toHaveAttribute('data-session-id', SESSION_ID)
    await expect(characters).toHaveCount(0)
    await expect(link.locator('.session-list-item-title-resting')).toHaveText(session.title)
    await character.dispose()
  })

  test(`preserves independent session and new-session drafts across navigation and refresh (${reducedMotion})`, async ({ page, ui }) => {
    void ui
    await page.addInitScript(() => {
      Reflect.set(window, 'draftGeometryTransitions', [])
      document.addEventListener('transitionrun', (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement) || !target.closest('.query-input') ||
          !['height', 'margin-left', 'margin-right', 'top', 'transform'].includes(event.propertyName)) {
          return
        }
        const field = document.querySelector<HTMLTextAreaElement>('textarea[name="query"]')
        const transitions = Reflect.get(window, 'draftGeometryTransitions') as string[]
        if (field && transitions.length < 64) {
          transitions.push(field.value)
        }
      })
    })
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
    await page.evaluate(() => Reflect.set(window, 'draftGeometryTransitions', []))
    await first.click()
    await expect(composer).toHaveValue(draft)
    await expect(composer).toBeFocused()
    expect(await composer.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]))
      .toEqual([draft.length, draft.length])
    expect(await page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      return Reflect.get(window, 'draftGeometryTransitions') as string[]
    })).not.toContain(draft)
    if (reducedMotion === 'no-preference') {
      await expect(page.getByRole('form', { name: 'Send a message to Leon' })).toHaveCSS('transition-property', 'height')
    }
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue(draft)
    await page.goBack()
    await expect(composer).toHaveValue('New-session draft')
    await page.goForward()
    await expect(composer).toHaveValue(draft)
    await page.reload()
    await expect(composer).toHaveValue(draft)
    expect(await composer.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]))
      .toEqual([draft.length, draft.length])
    expect(await page.evaluate(() => Reflect.get(window, 'draftGeometryTransitions') as string[])).not.toContain(draft)
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
  expect(await composer.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe('Another profile draft'.length)
  ui.profile = 'ui-tests'
  await page.reload()
  await expect(composer).toHaveValue('First profile draft')

  const release = ui.holdAuthentication()
  try {
    await page.reload()
    await composer.fill('New typing before authentication')
    await composer.press('Home')
    release()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
    await expect(composer).toHaveValue('New typing before authentication')
    expect(await composer.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(0)
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
  for (let index = 0; index < 10; index++) {
    const response = page.waitForResponse((candidate) => new URL(candidate.url()).searchParams.has('before'))
    await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
    await response
    await expect(page.getByRole('status').filter({ hasText: 'Loading earlier messages…' })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'Back to latest messages' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scroll to bottom', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
  const frontier = ui.historyRequests.length
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expectBottom(page)
  const reopened = ui.historyRequests.slice(frontier).filter((url) => url.pathname.endsWith(SESSION_ID))
  expect(reopened.length).toBeGreaterThan(0)
  expect(reopened.every((url) => !url.searchParams.has('before') && !url.searchParams.has('after'))).toBe(true)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`loads history on scroll with a shared loader and a stable reading position (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 },
      toolCalls: [{ id: 'history-tool', name: 'test.inspect', toolCallTitle: 'Inspect history', status: 'success' }]
    }
    await page.goto(SESSION_URL)
    await expectBottom(page)
    // Inspecting turn details must not disable the history-prepend anchor.
    await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
    await finishFiniteAnimations(page.locator('.feed'))
    expect(ui.historyRequests).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toHaveCount(0)
    const release = ui.holdHistory()
    await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
    const loading = page.getByRole('status').filter({ hasText: 'Loading earlier messages…' })
    await expect(loading).toBeVisible()
    await expect(loading.locator('.loader-indicator')).toHaveCSS('width', '12px')
    await expect(loading.locator('.loader-indicator')).toHaveCSS('height', '12px')
    await expect.poll(() => loading.locator('.loader-indicator').evaluate((element) =>
      getComputedStyle(element, '::before').animationName
    )).toBe(reducedMotion === 'reduce' ? 'none' : 'loader-indicator-pulse')
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await expect(loading.locator('.loader-indicator')).toHaveCSS('color', 'rgb(28, 117, 219)')
      await expect(loading).toHaveCSS('color', 'rgb(136, 136, 136)')
      const bounds = await loading.boundingBox()
      const mask = await page.locator('.feed-mask-top').boundingBox()
      expect(bounds!.y).toBeGreaterThan(mask!.y + mask!.height)
      await page.screenshot({ path: testInfo.outputPath(`history-loader-${theme}.png`) })
    }
    expect(ui.historyRequests).toHaveLength(2)
    const firstOwner = page.getByText('Saved question 220', { exact: true })
    const before = await firstOwner.boundingBox()
    release()
    await expect(loading).toHaveCount(0)
    await expect.poll(async () => Math.abs((await firstOwner.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(2)
    expect(ui.historyRequests).toHaveLength(2)
  })
}

test('keeps older history readable after a paging failure and retries only on request', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await expectBottom(page)
  await finishFiniteAnimations(page.locator('.feed'))
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}`, status: 500, message: 'History is unavailable.' }
  await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
  const retry = page.getByRole('button', { name: 'Retry loading earlier messages', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.locator('.request-feedback')).toHaveCount(0)
  await expect(page.getByText('Saved question 220', { exact: true })).toBeVisible()
  await expect(page.locator('.toast-title')).toHaveText(['Could not load the conversation'])
  const requests = ui.requests.filter((url) => url.searchParams.has('before')).length
  await page.getByRole('textbox', { name: 'Message Leon' }).fill('Keep this draft')
  await expect(retry).toBeEnabled()
  expect(ui.requests.filter((url) => url.searchParams.has('before'))).toHaveLength(requests)
  ui.failure = undefined
  await retry.click()
  await expect(retry).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveValue('Keep this draft')
})

for (const shortWindow of [false, true]) {
  test(`continues history loading without another scroll (short window: ${shortWindow})`, async ({ page, ui }) => {
    const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/sessions/${SESSION_ID}`)
    await page.goto(SESSION_URL)
    const snapshot = await (await response).json() as ConversationPage
    await expectBottom(page)
    const records = ui.history.get(SESSION_ID)!
    const first = records.length - (shortWindow ? 2 : snapshot.messages.length)
    let olderReads = 0
    await page.route(`**/api/v1/sessions/${SESSION_ID}?*`, async (route) => {
      const before = new URL(route.request().url()).searchParams.get('before')
      if (before) {
        olderReads++
      }
      await route.fulfill({ json: {
        ...snapshot,
        messages: before === 'first-older' ? records.slice(first - 2, first)
          : before === 'older-tail' ? records.slice(first - 42, first - 2) : records.slice(first),
        next_cursor: before === 'older-tail' ? null : before ? 'older-tail' : 'first-older',
        newer_cursor: before ? String(first) : null
      } })
    })
    await page.reload()
    if (!shortWindow) {
      await expectBottom(page)
      await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
    }
    await expect.poll(() => olderReads).toBe(2)
    await expect(page.getByRole('status').filter({ hasText: 'Loading earlier messages…' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toHaveCount(0)
  })
}

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

test('gives network-specific feedback and keeps drafting available through offline recovery', async ({ page, context, ui }) => {
  let disconnected = true
  await page.route(`**/api/v1/sessions/${SESSION_ID}?*`, async (route) => {
    if (disconnected) {
      await route.abort('internetdisconnected')
    } else {
      await route.fallback()
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('A draft during an outage')
  const notice = page.getByRole('alert')
  await expect(notice).toContainText('I couldn’t reach the server. Check your network connection and try again.')
  const retry = notice.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeEnabled()
  const text = await notice.locator('p').boundingBox()
  const button = await retry.boundingBox()
  expect(button!.y).toBeGreaterThanOrEqual(text!.y + text!.height)
  await expect(page.locator('.toast-error')).toHaveCount(1)
  disconnected = false
  await retry.click()
  await expectBottom(page)
  await expect(notice).toHaveCount(0)
  await expect(composer).toHaveValue('A draft during an outage')
  await context.setOffline(true)
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(notice).toContainText('Check your network connection and try again.')
  await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled()
  await composer.fill('Another offline draft')
  await context.setOffline(false)
  await expect(notice).toHaveCount(0)
  await expect(composer).toHaveValue('Another offline draft')
  void ui
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shows leaf dates as metadata and reveals full dates only from the timestamp (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    await page.clock.setFixedTime(new Date('2026-10-31T12:00:00+08:00'))
    const startedAt = await page.evaluate(() => new Date(2026, 9, 30, 14, 32, 15).getTime())
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.sentAt = startedAt + 3_000
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [],
      toolCalls: [{ id: 'dated-tool', name: 'test.lookup.run', toolCallTitle: 'Look up details',
        status: 'success', startedAt, durationMs: 618 }],
      reasoning: [{ id: 'dated-thought', text: 'Check the details.', phase: 'agent', startedAt }],
      timings: [{ id: 'dated-request', kind: 'inference', goal: TurnPhase.Tools,
        startedAt, durationMs: 1_000, outcome: 'completed' }],
      answerStartedAt: startedAt + 2_000, metrics: { durationMs: 3_000 }
    }
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work', exact: true })
    await work.getByRole('button', { name: 'Worked for 3s', exact: true }).click()
    await work.getByRole('button', { name: 'Used 1 tool for 618ms', exact: true }).click()
    const tool = work.getByRole('button', { name: 'Look up details' })
    const timestamp = work.locator('.tool-call-heading .activity-timestamp time')
    const badge = timestamp.locator('..')
    const tooltip = page.getByRole('tooltip')
    await expect(timestamp).toHaveText('Yesterday, 14:32')
    await page.getByRole('textbox', { name: 'Message Leon' }).focus()
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(badge).toHaveCSS('opacity', '0')
    const reservedWidth = (await badge.boundingBox())!.width
    expect(reservedWidth).toBeGreaterThan(0)
    const titleBounds = await tool.locator('.tool-call-title').boundingBox()
    const chevron = tool.locator('.tool-call-chevron')
    const chevronBounds = await chevron.boundingBox()
    expect(await timestamp.evaluate((element) => {
      const date = getComputedStyle(element)
      const duration = getComputedStyle(element.closest('.tool-call-heading')!.querySelector('.tool-call-duration')!)
      return date.color === duration.color && date.fontSize === duration.fontSize && date.lineHeight === duration.lineHeight
    })).toBe(true)
    const motion = await badge.evaluate((element) => {
      const date = getComputedStyle(element)
      const chevron = getComputedStyle(element.closest('.tool-call-heading')!.querySelector('.tool-call-chevron')!)
      return { property: date.transitionProperty, duration: date.transitionDuration, easing: date.transitionTimingFunction,
        chevronDuration: chevron.transitionDuration.split(', ')[0], chevronEasing: chevron.transitionTimingFunction }
    })
    if (reducedMotion === 'reduce') {
      expect(motion.property).toBe('none')
    } else {
      expect(motion.property).toBe('opacity')
      expect(motion.duration).toBe(motion.chevronDuration)
      expect(motion.chevronEasing).toContain(motion.easing)
    }
    await tool.hover()
    await expect(badge).toHaveCSS('opacity', '1')
    expect((await badge.boundingBox())!.width).toBe(reservedWidth)
    const hoveredTitle = (await tool.locator('.tool-call-title').boundingBox())!
    const hoveredChevron = (await chevron.boundingBox())!
    expect(hoveredTitle.x).toBe(titleBounds!.x)
    expect(hoveredTitle.width).toBe(titleBounds!.width)
    expect(hoveredChevron.x).toBe(chevronBounds!.x)
    const dateBounds = (await badge.boundingBox())!
    const durationBounds = (await tool.locator('.tool-call-duration').boundingBox())!
    expect(dateBounds.x).toBeGreaterThanOrEqual(durationBounds.x + durationBounds.width)
    expect(dateBounds.x + dateBounds.width).toBeLessThanOrEqual(chevronBounds!.x)
    await expect(tooltip).toHaveCount(0)
    await timestamp.hover()
    await expect(tooltip).toHaveText('2026-10-30 14:32:15')
    const bounds = await tooltip.boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(badge).toHaveCSS('opacity', '0')
    await expect(tooltip).toHaveCount(0)
    await tool.focus()
    await expect(badge).toHaveCSS('opacity', '1')
    await expect(tooltip).toHaveCount(0)
    await tool.press('Enter')
    await expect(tool).toBeFocused()
    await expect(tool).toHaveAttribute('aria-expanded', 'true')
    await expect(tooltip).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Message Leon' }).focus()
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(badge).toHaveCSS('opacity', '1')
    await timestamp.focus()
    await expect(tooltip).toHaveText('2026-10-30 14:32:15')
    await tool.focus()
    await expect(tooltip).toHaveCount(0)
    await chevron.click()
    await expect(tool).toHaveAttribute('aria-expanded', 'false')
    await timestamp.click()
    await expect(tool).toHaveAttribute('aria-expanded', 'true')
    const thought = work.getByRole('region', { name: 'Leon’s thinking', exact: true })
    await thought.getByRole('button').locator('.process-group-title').click()
    await expect(thought.locator('.thinking-message-details')).toBeVisible()
    await page.getByRole('textbox', { name: 'Message Leon' }).focus()
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(thought.locator('.process-group-heading > .activity-timestamp')).toHaveCSS('opacity', '1')
    expect(await thought.evaluate((element) => {
      const details = element.querySelector('.thinking-message-details')!.getBoundingClientRect()
      const label = element.querySelector('.process-group-title')!.getBoundingClientRect()
      return Math.abs(details.left - label.left)
    })).toBeLessThanOrEqual(1)
    await thought.hover()
    const thoughtDate = (await thought.locator('.activity-timestamp').boundingBox())!
    const thoughtChevron = (await thought.locator('.process-group-chevron').boundingBox())!
    expect(thoughtDate.x + thoughtDate.width).toBeLessThanOrEqual(thoughtChevron.x)
    await thought.locator('.activity-timestamp time').hover()
    await expect(tooltip).toContainText('2026-10-30 14:32:15')
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(tooltip).toHaveCount(0)
    await page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
      .locator('.streaming-text-characters').hover()
    await expect(tooltip).toHaveCount(0)
    await expect(page.locator('.final-answer').last()
      .getByRole('group', { name: 'Answer actions', exact: true }).locator('.activity-timestamp')).toHaveCount(1)
    await page.reload()
    await work.getByRole('button', { name: 'Worked for 3s', exact: true }).click()
    await work.getByRole('button', { name: 'Used 1 tool for 618ms', exact: true }).click()
    await tool.hover()
    await timestamp.hover()
    await expect(tooltip).toContainText('2026-10-30 14:32:15')
  })
}

test('confirms session management actions once and only after the server accepts them', async ({ page, ui }) => {
  let pending = Promise.withResolvers<Route>()
  await page.route(`**/api/v1/sessions/${SESSION_ID}?*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fallback()
      return
    }
    pending.resolve(route)
  })
  await page.goto(SESSION_URL)
  let title = 'Test session 0'
  for (const action of ['renamed', 'pinned', 'unpinned', 'deleted']) {
    const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })
    await row.hover()
    await row.getByRole('button', { name: 'Session options', exact: true }).click()
    if (action === 'renamed') {
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
      const input = page.getByRole('textbox', { name: 'Session title', exact: true })
      await input.fill('Renamed session')
      await input.press('Enter')
    } else if (action === 'deleted') {
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete session', exact: true }).click()
    } else {
      const item = page.getByRole('menuitem', { name: action === 'pinned' ? 'Pin session' : 'Unpin session', exact: true })
      if (action === 'unpinned') {
        const status = row.locator('.session-list-item-pinned-icon')
        await expect(status).toHaveAttribute('data-icon-variant', 'fill')
        await expect(item.locator('[data-icon="unpin"]')).toHaveAttribute('data-icon-variant', 'line')
        expect(await item.locator('path').first().getAttribute('d')).not.toBe(await status.locator('path').first().getAttribute('d'))
      }
      await item.click()
    }
    const route = await pending.promise
    pending = Promise.withResolvers<Route>()
    await expect(page.locator('.toast')).toHaveCount(0)
    const session = ui.sessions[0]!
    if (action === 'deleted') {
      expect(route.request().method()).toBe('DELETE')
      ui.sessions.shift()
      await route.fulfill({ json: { success: true } })
    } else {
      expect(route.request().method()).toBe('PATCH')
      const changes = route.request().postDataJSON() as { title?: string, is_pinned?: boolean }
      if (changes.title !== undefined) {
        session.title = changes.title
        title = changes.title
      } else {
        session.isPinned = changes.is_pinned!
      }
      await route.fulfill({ json: { session } })
    }
    await expect(page.locator('.toast-success .toast-title')).toHaveText([`Session ${action}`])
    await expect(page.locator('.toast')).toHaveCount(1)
    if (action === 'deleted') {
      await expect(page).toHaveURL(/\/web-app\/$/)
      await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Close notification', exact: true }).click()
    await expect(page.locator('.toast')).toHaveCount(0)
  }
})

test('reports a rejected session action once without confirming success', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}`, status: 500, message: 'Session update rejected.' }
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Test session 0', exact: true }) })
  await row.hover()
  await row.getByRole('button', { name: 'Session options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin session', exact: true }).click()
  await expect(page.locator('.toast-error .toast-title')).toHaveText(['Session could not be updated'])
  await expect(page.locator('.toast')).toHaveCount(1)
  await expect(row).not.toHaveClass(/session-list-item-pinned/)
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

for (const status of ['success', 'error'] as const) {
  test(`keeps recorded tool outcomes quiet and durations centered in both themes (${status})`, async ({ page, ui }, testInfo) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId,
      planSteps: [],
      toolCalls: [{
        id: 'lookup', name: 'search.lookup.run', status,
        toolCallTitle: 'Look up information', toolIconName: 'search-line', startedAt: 0, durationMs: 1_500
      }],
      metrics: { durationMs: 2_000 }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 2s' }).click()
    await page.getByRole('button', { name: 'Used 1 tool for 2s', exact: true }).click()
    const tool = page.getByRole('button', { name: 'Look up information' })
    await expect(tool).toBeVisible()
    await expect(tool.locator('.tool-call-duration')).toHaveText('1.5s')
    await expect(tool.locator('.activity-wave-active')).toHaveCount(0)
    await expect(tool.locator('.tool-call-error-indicator')).toHaveCount(status === 'error' ? 1 : 0)
    await expect(tool.locator('[data-icon="check"], [data-icon="check"]')).toHaveCount(0)

    for (const theme of ['dark', 'light']) {
      await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme)
      if (status === 'error') {
        await expect(tool).toHaveAccessibleDescription('Tool call failed')
        await expect(tool.locator('.tool-call-error-indicator[data-icon="close"]')).toHaveCSS('color', 'rgb(172, 10, 10)')
      }
      const title = await tool.locator('.tool-call-title').boundingBox()
      const duration = await tool.locator('.tool-call-duration').boundingBox()
      expect(title).not.toBeNull()
      expect(duration).not.toBeNull()
      expect(Math.abs(title!.y + title!.height / 2 - duration!.y - duration!.height / 2)).toBeLessThanOrEqual(1)
      if (status === 'error') {
        const indicator = await tool.locator('.tool-call-error-indicator').boundingBox()
        expect(indicator).not.toBeNull()
        expect(Math.abs(indicator!.y + indicator!.height / 2 - duration!.y - duration!.height / 2)).toBeLessThanOrEqual(0.25)
      }
      await testInfo.attach(`tool-duration-${theme}`, { body: await tool.screenshot(), contentType: 'image/png' })
    }
  })
}

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
  await work.getByRole('button', { name: 'Used 2 tools for 210ms', exact: true }).click()
  await expect(work.locator('.tool-call-title')).toHaveText(['Run', 'Run'])
  await expect(work.getByText('test.lookup.run', { exact: true })).toHaveCount(0)
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
    await expect(generation.locator('[data-icon="pencil-ai"]')).toHaveCount(1)
    await expect(review.locator('[data-icon="search-eye"]')).toHaveCount(1)
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
  await expect(page.getByRole('button', { name: 'Thought', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Leon’s review' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Leon’s answer generation' })).toHaveCount(0)
})

test('shows structured plans without duplicate legacy widget answers while retaining other widget content', async ({ page, ui }) => {
  ui.history.set(SESSION_ID, [{
    who: 'owner', messageId: 'old-owner', message: 'An older request.', sentAt: 0, isAddedToHistory: true
  }, {
    who: 'leon', messageId: 'old-plan', message: 'Legacy-only plan', sentAt: 1,
    isAddedToHistory: false, widget: { widget: 'PlanWidget' }
  }, {
    who: 'owner', messageId: 'new-owner', message: 'A planned request.', sentAt: 2, isAddedToHistory: true
  }, {
    who: 'leon', messageId: 'other-widget', message: 'Another widget result', sentAt: 3,
    isAddedToHistory: false, widget: { widget: 'OtherWidget' }
  }, {
    who: 'leon', messageId: 'duplicate-plan', message: 'Verify playback paths', sentAt: 4,
    isAddedToHistory: false, widget: { widget: 'PlanWidget' }
  }, {
    who: 'leon', messageId: 'planned-answer', message: 'The final answer.', sentAt: 5,
    isAddedToHistory: true, agentResponseTrace: {
      id: 'planned-answer', planSteps: [{ id: 'step', label: 'Verify playback paths', status: 'completed' }],
      toolCalls: [], metrics: { durationMs: 5_000 }
    }
  }])
  await page.goto(SESSION_URL)
  for (const reload of [false, true]) {
    if (reload) {
      await page.reload()
    }
    const answers = page.getByRole('region', { name: 'Leon’s final answer', exact: true })
    await expect(answers).toHaveCount(3)
    await expect(answers.nth(0)).toContainText('Legacy-only plan')
    await expect(answers.nth(1)).toContainText('Another widget result')
    await expect(answers.nth(2)).toContainText('The final answer.')
    await expect(answers.filter({ hasText: 'Verify playback paths' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Worked for 5s', exact: true }).click()
    await page.getByRole('button', { name: 'Completed plan', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Execution plan' })).toContainText('Verify playback paths')
  }
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
      await expect(retries.locator('.process-group-title')).toHaveText(label)
      await expect(retries.locator('[data-icon="refresh"]')).toHaveCount(1)
      await expect(retries.getByRole('button')).toHaveCount(0)
      await page.reload()
      await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
      await expect(retries.locator('.process-group-title')).toHaveText(label)
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
  await expect(page.getByRole('region', { name: 'Leon’s retries' }).locator('.process-group-title')).toHaveText('Retried 2 times')
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
    await expect(request.locator(`[data-icon="${resolveIconName(category.icon)}"]`)).toHaveCount(1)
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
      await expect(other.locator('[data-icon="more"]')).toHaveCount(1)
      await expect(other.getByRole('button')).toHaveCount(0)
      await page.reload()
      await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
      await expect(other).toHaveText('Other processing for 3s')
    } else {
      await expect(other).toHaveCount(0)
    }
  })
}
