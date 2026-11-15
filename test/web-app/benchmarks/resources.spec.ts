import fs from 'node:fs/promises'

import { test, expect, SESSION_ID, SESSION_URL } from '../e2e/fixtures'
import type { SessionStatus } from '../../../apps/web/src/data/sessions'

const SETTLE_MS = 8_000
const SAMPLE_MS = 5_000
const SESSION_COUNT = 600
const DRAFT_LINE_COUNT = 10

for (const workload of ['idle', 'draft', 'working', 'tasks', 'rain', 'reduced motion', 'scrolling', 'background'] as const) {
  test(`samples production resources: ${workload}`, async ({ page, ui, browser }, testInfo) => {
    const session = ui.sessions[0]!
    const shortConversation = workload === 'idle' || workload === 'draft' || workload === 'reduced motion'
    ui.sessions.splice(0, ui.sessions.length, ...Array.from({ length: shortConversation ? 3 : SESSION_COUNT }, (_, index) => ({
      ...session,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Performance session ${index}`,
      status: workload === 'working' && index < 8 || workload === 'tasks' && index === 0
        ? 'wip' as SessionStatus : 'idle' as SessionStatus
    })))
    if (shortConversation) {
      ui.history.set(SESSION_ID, [
        { who: 'owner', messageId: 'q', message: 'Explain the design', sentAt: 1_000, isAddedToHistory: true },
        { who: 'leon', messageId: 'a', message: 'A saved answer with **formatted text**.\n\nThis conversation has finished.', sentAt: 1_500, isAddedToHistory: true }
      ])
    }
    if (workload === 'tasks') {
      const answer = ui.history.get(SESSION_ID)!.at(-1)!
      answer.message = ''
      answer.isAddedToHistory = false
      answer.agentResponseTrace = {
        id: answer.messageId, planSteps: [], toolCalls: [{
          id: 'reading', name: 'test.files.read', toolCallTitle: 'Reading project files',
          toolIconName: 'file-text-line', status: 'running', input: {}, output: ''
        }]
      }
    }
    if (workload === 'rain' || workload === 'background') {
      ui.ambient.weather = {
        condition: 'rain', description: 'Rain', temperatureC: 12, feelsLikeC: 10,
        weatherCode: 63, location: 'Test location', observationTime: '2026-11-15T12:00', fetchedAt: Date.now()
      }
    }
    if (workload === 'reduced motion') {
      await page.emulateMedia({ reducedMotion: 'reduce' })
    }
    await page.addInitScript(() => {
      localStorage.setItem('leon.web-app.theme', 'dark')
      localStorage.setItem('leon.web-app.sidebar-expanded', 'true')
    })
    await page.goto(SESSION_URL)
    await page.bringToFront()
    const field = page.getByRole('textbox', { name: 'Message Leon' })

    await expect(field).toBeFocused()
    if (workload === 'draft') {
      // A tall composer exercises the rendering area hidden by a single-line draft.
      await field.fill(Array.from({ length: DRAFT_LINE_COUNT }, (_, index) =>
        `Draft line ${index + 1}: keep the original text, caret and soft glow aligned while reading.`
      ).join('\n'))
    }
    await expect(page.locator('.final-answer').last()).toBeVisible()
    if (workload === 'rain' || workload === 'background') {
      await expect(page.locator('.weather-layer')).toBeVisible()
    }
    await page.waitForTimeout(SETTLE_MS)

    const renderer = await page.context().newCDPSession(page)

    if (workload === 'background') {
      // Playwright forces focus/visibility by default, even in a headed browser.
      // Release that override so native tab backgrounding reaches the app.
      await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: false })
      const foreground = await page.context().newPage()
      await foreground.goto('about:blank')
      await foreground.bringToFront()
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
      await page.waitForTimeout(500)
    }

    const browserSession = await browser.newBrowserCDPSession()
    await renderer.send('Performance.enable')
    const info = await browserSession.send('SystemInfo.getInfo')
    const state = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      visible: document.visibilityState,
      focused: document.hasFocus(),
      composerHeight: document.querySelector('.query-input')?.getBoundingClientRect().height,
      animations: document.getAnimations().filter((animation) => animation.playState === 'running').map((animation) => ({
        name: (animation as CSSAnimation).animationName,
        iterations: animation.effect?.getComputedTiming().iterations
      })),
      canvases: document.querySelectorAll('canvas').length,
      nodes: document.querySelectorAll('*').length
    }))
    if (workload === 'tasks') {
      expect(state.animations.some((animation) => animation.name === 'activity-wave')).toBe(true)
    }
    expect(state.focused).toBe(workload !== 'background')
    if (workload !== 'background') {
      expect(state.visible).toBe('visible')
    }

    const processesBefore = await browserSession.send('SystemInfo.getProcessInfo')
    const metricsBefore = await renderer.send('Performance.getMetrics')
    const started = performance.now()
    if (workload === 'scrolling') {
      // Native wheel input exercises virtualization without a page-side RAF probe.
      await page.locator('.app-main').hover()
      for (let index = 0; index < 20; index++) {
        await page.mouse.wheel(0, -450)
        await page.waitForTimeout(125)
      }
      await page.locator('.session-list-items').hover()
      for (let index = 0; index < 20; index++) {
        await page.mouse.wheel(0, 450)
        await page.waitForTimeout(125)
      }
    } else {
      await page.waitForTimeout(SAMPLE_MS)
    }
    const seconds = (performance.now() - started) / 1_000
    const processesAfter = await browserSession.send('SystemInfo.getProcessInfo')
    const metricsAfter = await renderer.send('Performance.getMetrics')
    const cpu: Record<string, number> = {}
    for (const process of processesAfter.processInfo) {
      const before = processesBefore.processInfo.find((entry) => entry.id === process.id)
      if (before !== undefined) {
        // CDP cpuTime is cumulative CPU seconds. 100% means one fully busy core.
        cpu[process.type] = (cpu[process.type] ?? 0) +
          (process.cpuTime - before.cpuTime) / seconds * 100
      }
    }
    const metrics = Object.fromEntries(metricsAfter.metrics.map((metric) => [
      metric.name,
      {
        value: metric.value,
        delta: metric.value - (metricsBefore.metrics.find((entry) => entry.name === metric.name)?.value ?? 0)
      }
    ]))
    const report = {
      workload, project: testInfo.project.name, seconds, state, cpu, metrics,
      historyRecords: ui.history.get(SESSION_ID)?.length,
      gpu: info.gpu,
      note: 'CPU percentages are process totals in this isolated browser. GPU process CPU is not GPU utilization. No CPU throttling. Values are observations, not CI thresholds.'
    }
    const reportPath = testInfo.outputPath('resources.json')

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    await testInfo.attach('resources.json', { path: reportPath, contentType: 'application/json' })
    console.log(JSON.stringify({ workload, project: testInfo.project.name, seconds, cpu }))
    await renderer.detach()
    await browserSession.detach()
  })
}
