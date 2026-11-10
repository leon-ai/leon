import { resolveIconName } from '../../../apps/web/src/components/icon/icon-name'
import fs from 'node:fs/promises'
import type { ElementHandle, Locator } from '@playwright/test'
import type { ConversationEvent, ConversationRecord } from '../../../apps/web/src/data/conversation'
import { TurnPhase } from '../../../server/src/core/llm-manager/turn-timing-contract'
import type { SessionStatus } from '../../../apps/web/src/data/sessions'
import { test, expect, SESSION_ID, SESSION_URL, toolContentsFixture, finishFiniteAnimations } from './fixtures'
import { CODE_PREVIEW_LINES } from '../../../apps/web/src/components/code-view/code-highlight-types'
import { FyiKind } from '../../../server/src/core/fyi/fyi-contract'
import { LogoMaskMode } from '../../../aurora/src/contracts/package-logo'

test('replaces fallback artwork after favicon loading and shows complete URL tooltips within the viewport', async ({ page, ui }) => {
  const url = `https://example.com/guide?note=${'slow-craft-'.repeat(24)}`
  ui.history.get(SESSION_ID)!.at(-1)!.message = `A little guidance from [a warm guide](${url}) and [another page](https://missing.example/page).`
  const ready = Promise.withResolvers<void>()
  await page.route('**/api/v1/favicons?**', async (route) => {
    const origin = new URL(route.request().url()).searchParams.get('origin')
    if (origin === 'https://example.com') {
      await ready.promise
      await route.fulfill({ status: 200, contentType: 'image/png', path: 'apps/web/public/img/favicon.png' })
    } else {
      await route.fulfill({ status: 404, body: '' })
    }
  })
  try {
    await page.goto(SESSION_URL)
    const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
    const link = answer.getByRole('link', { name: 'a warm guide' })
    await expect(link.locator('[data-icon="global"]')).toHaveCount(1)
    await expect(link.locator('img')).toHaveCSS('opacity', '0')
    ready.resolve()
    await expect(link.locator('img')).toHaveAttribute('data-loaded', 'true')
    await expect(link.locator('[data-icon="global"]')).toHaveCount(0)
    await expect(answer.getByRole('link', { name: 'another page' }).locator('[data-icon="global"]')).toHaveCount(1)
    await expect(answer.locator('p')).toHaveCSS('line-height', '30px')
    for (const width of [1_512, 390]) {
      await page.setViewportSize({ width, height: 982 })
      await link.hover()
      const tooltip = page.getByRole('tooltip').filter({ hasText: url })
      await expect(tooltip).toHaveText(url)
      await expect(tooltip).toBeVisible()
      const bounds = (await tooltip.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      await page.mouse.move(0, 0)
      await link.focus()
      await expect(tooltip).toHaveText(url)
      await link.blur()
    }
  } finally {
    ready.resolve()
  }
})

test('preserves original navigation and tooltip URLs without fetching page previews', async ({ page, ui }) => {
  const original = 'https://example.com/guide#read'
  const signedURL = 'https://example.com/guide?signature=keep-me#read'
  const campaignURL = 'https://example.com/guide?utm_source=newsletter&utm_medium=email#read'
  ui.history.get(SESSION_ID)!.at(-1)!.message = `[A warm guide](${original}) and [another guide](${signedURL}) and [an existing referral](${campaignURL}) and [a download](https://example.com/archive.zip) and [a resource](https://example.com/archive%2Ezip) and [an API](https://example.com/data.json) and [email](mailto:hello@example.com).`
  const previewRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/link-preview')) {
      previewRequests.push(request.url())
    }
  })
  await page.route('**/api/v1/favicons?**', (route) => route.fulfill({
    status: 200, contentType: 'image/png', path: 'apps/web/public/img/favicon.png'
  }))
  await page.goto(SESSION_URL)
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  const link = answer.getByRole('link', { name: 'A warm guide' })
  await expect(link).toHaveAttribute('href', original)
  await link.hover()
  await expect(page.locator('[role="tooltip"].tooltip-content-open')).toHaveText(original)
  await page.mouse.move(0, 0)
  await link.focus()
  await expect(page.locator('[role="tooltip"].tooltip-content-open')).toHaveText(original)
  for (const [name, url] of [
    ['another guide', signedURL], ['an existing referral', campaignURL], ['a download', 'https://example.com/archive.zip'],
    ['a resource', 'https://example.com/archive%2Ezip'], ['an API', 'https://example.com/data.json'],
    ['email', 'mailto:hello@example.com']
  ] as const) {
    await expect(answer.getByRole('link', { name, exact: true })).toHaveAttribute('href', url)
  }
  expect(previewRequests).toEqual([])
})

test('keeps failed favicons quiet and retries only after the cooldown on intent', async ({ page, ui }) => {
  const url = 'https://example.com/guide'
  ui.history.get(SESSION_ID)!.at(-1)!.message = `[A warm guide](${url})`
  let icons = 0
  await page.route('**/api/v1/favicons?**', async (route) => {
    icons++
    await route.fulfill(icons === 1 ? { status: 404, body: '' }
      : { status: 200, contentType: 'image/png', path: 'apps/web/public/img/favicon.png' })
  })
  await page.goto(SESSION_URL)
  const link = page.getByRole('link', { name: 'A warm guide' })
  await expect(link.locator('[data-icon="global"]')).toHaveCount(1)
  await link.focus()
  await expect(page.getByRole('tooltip')).toHaveText(url)
  expect(icons).toBe(1)
  await expect(page.locator('.toast')).toHaveCount(0)
  await expect(link).toHaveAttribute('href', url)
  await link.evaluate((element) => (element as HTMLElement).blur())
  await page.clock.setFixedTime(new Date(Date.now() + 31_000))
  await link.focus()
  await expect(link.locator('img')).toHaveAttribute('data-loaded', 'true')
  expect(icons).toBe(2)
})

for (const legacy of [false, true]) {
  test(`renders search Markdown live and saved without replacing it with progress or metadata (legacy: ${legacy})`, async ({ page, ui }, testInfo) => {
    const text = '## A useful guide\n\nKeep **one good idea** close.\n\n| Topic | Note |\n| --- | --- |\n| Craft | Take your time |'
    const sources = [{ url: 'https://example.com/guide', title: 'A useful guide' }]
    const responseId = 'rich-search-response'
    const logo = { url: 'tools/communication.gmail/assets/logo.svg', mode: LogoMaskMode.Alpha }
    await page.route('**/api/v1/tools/communication.gmail/assets/logo.svg', (route) => route.fulfill({
      contentType: 'image/svg+xml', path: 'tools/communication/gmail/logo.svg'
    }))
    const tool = { id: 'rich-search', name: 'search_web.hosted.searchWeb', toolCallTitle: 'Read useful guidance',
      toolLogo: logo,
      status: 'running' as const, input: { query: 'Useful guidance' },
      output: { output: text, format: 'markdown' }, commandOutput: text }
    const saved: ConversationRecord = {
      who: 'leon', messageId: responseId, message: '', sentAt: Date.now(), isAddedToHistory: false,
      agentResponseTrace: { id: responseId, planSteps: [], toolCalls: [tool], metrics: { durationMs: 1_000 } }
    }
    await page.goto(SESSION_URL)
    ui.history.get(SESSION_ID)!.push(saved)
    let sequence = 0
    const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'rich-search-turn', response_id: responseId, created_at: Date.now()
    }])
    await emit('turn_status', { status: 'accepted' })
    await emit('tool_call', { tool_call: { ...tool, tool_logo: logo, tool_call_title: tool.toolCallTitle, command_output: text } })
    const call = page.locator('.tool-call').filter({ hasText: 'Read useful guidance' })
    const revealTool = async (): Promise<void> => {
      const tools = page.getByRole('region', { name: 'Leon’s tool usage', exact: true }).last()
      const group = tools.getByRole('button').first()
      if (await group.getAttribute('aria-expanded') === 'false') {
        await group.click()
      }
      const toggle = call.getByRole('button', { name: /Read useful guidance/ })
      if (await toggle.getAttribute('aria-expanded') === 'false') {
        await toggle.click()
      }
      await expect(call.locator('.package-icon-mask')).toHaveAttribute('data-logo-mask', LogoMaskMode.Alpha)
    }
    await revealTool()
    const preview = call.getByRole('region', { name: 'Tool output', exact: true })
    await expect(preview.getByRole('heading', { name: 'A useful guide' })).toBeVisible()
    await expect(preview.getByRole('table')).toContainText('Take your time')
    await expect(preview.locator('.code-view')).toHaveCount(0)
    const finished = { ...tool, status: 'success' as const, output: {
      result: { content: text, sources, ...(legacy ? {} : { format: 'markdown' }) }
    }, commandOutput: `Searching the web...\nSource: https://example.com/guide\n${text}` }
    saved.agentResponseTrace!.toolCalls = [finished]
    await emit('tool_call', { tool_call: { ...finished, tool_call_title: tool.toolCallTitle, command_output: finished.commandOutput } })
    await revealTool()
    await expect(preview.getByRole('heading')).toHaveText('A useful guide')
    await expect(preview).not.toContainText('Source:')
    await expect(preview).not.toContainText('Searching the web...')
    await call.getByRole('button', { name: 'View details', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: tool.toolCallTitle, exact: true })
    await expect(dialog.getByRole('region', { name: 'Output', exact: true }).getByRole('table')).toContainText('Take your time')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await dialog.getByRole('button', { name: 'Copy output', exact: true }).click()
    await expect.poll(async () => JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(finished.output)
    await page.keyboard.press('Escape')
    saved.message = 'The useful points are ready.'
    saved.isAddedToHistory = true
    await emit('final_answer', { content: saved.message, response_trace: saved.agentResponseTrace })
    await emit('turn_status', { status: 'completed' })
    await page.reload()
    const work = page.getByRole('region', { name: 'Leon’s completed work', exact: true }).last()
    await work.getByRole('button').first().click()
    await revealTool()
    await expect(preview.getByRole('table')).toContainText('Take your time')
    await expect(preview.getByRole('table')).toBeVisible()
    await expect(preview).not.toContainText('Source:')
    await finishFiniteAnimations(call)
    await page.screenshot({ path: testInfo.outputPath('search-markdown.png') })
  })
}

test('bounds page Markdown previews and virtualizes oversized complete documents', async ({ page, ui }) => {
  const text = `# More to read\n\n${'A **small idea** worth keeping.\n\n'.repeat(3_000)}`
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [{
    id: 'long-page', name: 'search_web.crawlberg.fetchUrl', toolCallTitle: 'Read a longer page',
    status: 'success', output: { result: { data: { text, format: 'markdown', content_kind: 'extracted_text' } } }
  }] }
  await page.goto(SESSION_URL)
  await page.getByRole('region', { name: 'Leon’s completed work', exact: true }).last().getByRole('button').first().click()
  await page.getByRole('region', { name: 'Leon’s tool usage', exact: true }).last().getByRole('button').first().click()
  const call = page.locator('.tool-call').filter({ hasText: 'Read a longer page' })
  await call.getByRole('button', { name: /Read a longer page/ }).click()
  const preview = call.getByRole('region', { name: 'Tool output', exact: true })
  await expect(preview.getByRole('heading')).toHaveText('More to read')
  expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(CODE_PREVIEW_LINES * 22 + 25)
  expect(await preview.locator('p').count()).toBeLessThan(600)
  await expect(preview).toHaveCSS('overflow-y', 'hidden')
  await call.getByRole('button', { name: 'View details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Read a longer page', exact: true })
  await expect(dialog).toContainText('Large output is shown as text to keep scrolling smooth.')
  const full = dialog.getByRole('region', { name: 'Output', exact: true })
  await expect(full).toContainText('# More to read')
  expect(await full.locator('.code-view-line').count()).toBeLessThan(60)
  expect((await dialog.boundingBox())!.y + (await dialog.boundingBox())!.height).toBeLessThan(982)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`renders safe streaming Markdown with Leon's character motion and restores its formatting (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const faviconRequests: string[] = []
    await page.route('**/api/v1/favicons?**', async (route) => {
      faviconRequests.push(new URL(route.request().url()).searchParams.get('origin')!)
      await route.fulfill({ status: 404, body: '' })
    })
    await page.goto(SESSION_URL)
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
    const responseId = 'markdown-answer'
    const createdAt = Date.now()
    let sequence = 0
    const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'markdown-turn', response_id: responseId, created_at: createdAt + sequence
    }])
    await emit('owner_message', { message: { who: 'owner', messageId: 'markdown-owner', message: 'Explain **Markdown** literally.', sentAt: createdAt, isAddedToHistory: true } })
    await emit('turn_status', { status: 'accepted' })
    await emit('text_stream', { kind: 'answer', generationId: 'markdown-generation', token: '## A little guide\n\nA **warm' })
    const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
    await expect(answer.getByRole('heading', { name: 'A little guide' })).toBeVisible()
    await expect(answer.locator('strong')).toHaveText('warm')
    const character = answer.locator('strong .streaming-text-character-new').last()
    if (reducedMotion === 'no-preference') {
      await expect(character).toHaveCSS('animation-name', 'streaming-text-character-enter')
      await expect(character).toHaveCSS('animation-duration', '0.42s')
    } else {
      await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
    }
    await expect(answer.locator('[data-sd-animate]')).toHaveCount(0)
    const settledHeading = await answer.getByRole('heading').elementHandle()
    await emit('text_stream', { kind: 'answer', generationId: 'markdown-generation', token: '** welcome with [a useful source](https://example.com/guide) and `inline code`.\n\n- Read slowly\n- Try one thing\n\n> Keep some room for ideas.\n\n| Item | Value |\n| --- | --- |\n| Pace | Gentle |\n\n```json\n{"cozy": true, "count": 2}' })
    await expect(answer.getByRole('link', { name: 'a useful source' })).toHaveAttribute('href', 'https://example.com/guide')
    await expect(answer.getByRole('listitem')).toHaveCount(2)
    await expect(answer.getByRole('table')).toContainText('Gentle')
    await expect(answer.getByRole('region', { name: 'Code block', exact: true })).toContainText('"cozy": true')
    expect(await settledHeading!.evaluate((element) => element.isConnected)).toBe(true)
    await expect.poll(() => faviconRequests).toEqual(['https://example.com'])

    const source = '## A little guide\n\nA **warm** welcome with [a useful source](https://example.com/guide) and `inline code`.\n\n- Read slowly\n- Try one thing\n\n> Keep some room for ideas.\n\n| Item | Value |\n| --- | --- |\n| Pace | Gentle |\n\n```json\n{"cozy": true, "count": 2}\n```'
    await emit('text_stream', { kind: 'answer', generationId: 'markdown-generation', token: '\n```' })
    const code = answer.getByRole('region', { name: 'Code block', exact: true })
    await expect(code.locator('span[style*="color"]').first()).toBeVisible()
    await emit('final_answer', { content: source, artifacts: [] })
    await emit('turn_status', { status: 'completed' })
    ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: responseId, message: source, sentAt: createdAt, isAddedToHistory: true })
    await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
    const owner = page.locator('.owner-message').filter({ hasText: 'Explain **Markdown** literally.' })
    await expect(owner).toBeVisible()
    await expect(owner.locator('strong')).toHaveCount(0)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await answer.locator('p').first().hover()
    await page.getByRole('button', { name: 'Copy message', exact: true }).last().click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    await page.reload()
    await expect(answer.getByRole('heading', { name: 'A little guide' })).toBeVisible()
    await expect(answer.locator('strong')).toHaveText('warm')
    await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
    await expect(answer.getByRole('region', { name: 'Code block', exact: true })).toBeVisible()

    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1_512, height: 982 })
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await page.setViewportSize({ width: theme === 'light' ? 390 : 1_512, height: 982 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`markdown-${theme}.png`) })
    }
    expect(errors).toEqual([])
  })
}

test('reuses completed Markdown parses across session remounts without sharing IDs or caching live prefixes', async ({ page, ui }, testInfo) => {
  // Observe serialized parser snapshots without a production diagnostics API.
  await page.addInitScript(() => {
    const parse = JSON.parse
    const reads = { completed: 0, live: 0 }
    Reflect.set(window, 'markdownCacheReads', reads)
    JSON.parse = function (...args: Parameters<typeof parse>): ReturnType<typeof parse> {
      const value = parse(...args)
      if (value?.type === 'root' && Array.isArray(value.children)) {
        if (args[0].includes('Cacheable idea')) {
          reads.completed++
        }
        if (args[0].includes('Live cache probe')) {
          reads.live++
        }
      }
      return value
    }
  })
  const source = '## Cacheable idea\n\nA **warm** note[^craft] with $x^2$.\n\n[^craft]: Keep creating.'
  ui.history.get(SESSION_ID)!.at(-1)!.message = source
  ui.history.get(SESSION_ID)!.at(-3)!.message = source
  await page.goto(SESSION_URL)
  const answers = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).filter({ hasText: 'Cacheable idea' })
  await expect(answers.locator('.katex')).toHaveCount(2)
  const initialReads = await page.evaluate(() => Reflect.get(window, 'markdownCacheReads').completed as number)
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
    await expect(answers).toHaveCount(0)
    await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
    await expect(answers.locator('.katex')).toHaveCount(2)
    await expect(answers.locator('strong')).toHaveText(['warm', 'warm'])
    await expect(answers.locator('.streaming-text-character-new')).toHaveCount(0)
    for (const answer of await answers.all()) {
      const href = (await answer.getByRole('link', { name: '1', exact: true }).getAttribute('href'))!
      expect(await answer.evaluate((element, id) => element.contains(document.getElementById(id)), href.slice(1))).toBe(true)
    }
    expect(await answers.evaluateAll((elements) => {
      const ids = elements.flatMap((element) => Array.from(element.querySelectorAll('[id]'), (node) => node.id))
      return new Set(ids).size === ids.length
    })).toBe(true)
  }
  const completedReads = await page.evaluate(() => Reflect.get(window, 'markdownCacheReads').completed as number)
  expect(completedReads).toBeGreaterThan(initialReads)
  await testInfo.attach('markdown-cache-reuse', {
    body: JSON.stringify({ initialReads, completedReads, sessionRoundTrips: 3 }), contentType: 'application/json'
  })

  let sequence = 0
  const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
    type, data, sequence: ++sequence, session_id: SESSION_ID,
    turn_id: 'cache-stream', response_id: 'cache-stream-answer', created_at: Date.now()
  }])
  await emit('turn_status', { status: 'accepted' })
  await emit('text_stream', { kind: 'answer', generationId: 'cache-generation', token: 'Live cache probe **one' })
  const live = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(live).toContainText('Live cache probe one')
  await emit('text_stream', { kind: 'answer', generationId: 'cache-generation', token: '**, then **two**.' })
  await expect(live.locator('strong')).toHaveText(['one', 'two'])
  expect(await page.evaluate(() => Reflect.get(window, 'markdownCacheReads').live as number)).toBe(0)
})

test('shares lazy file artwork across languages, themes and session navigation', async ({ page, ui }) => {
  const resources: string[] = []
  page.on('request', (request) => resources.push(request.url()))
  const languages = [
    ['js', 'JavaScript', 'javascript'], ['typescript', 'TypeScript', 'typescript'],
    ['tsx', 'TSX', 'react'], ['python', 'Python', 'python'],
    ['json', 'JSON', 'json'], ['yaml', 'YAML', 'yml'],
    ['rust', 'Rust', 'rust'], ['dockerfile', 'Dockerfile', 'docker']
  ] as const
  ui.history.get(SESSION_ID)!.at(-1)!.message = languages.map(([language]) =>
    `\`\`\`${language}\nA little code.\n\`\`\``).join('\n\n') + '\n\n```unknown-language\nSome text.\n```'
  await page.goto('./')
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  expect(resources.some((url) => url.includes('pierre-file-icon-'))).toBe(false)
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  for (const [, label, token] of languages) {
    const icon = answer.getByRole('img', { name: label, exact: true })
    await expect(icon).toHaveAttribute('data-file-icon', token)
    expect(await icon.locator('use').getAttribute('href')).toBe(`#file-tree-builtin-${token}`)
    expect(await icon.evaluate((element) => (element as SVGSVGElement).getBBox().width)).toBeGreaterThan(0)
  }
  await expect(answer.locator('.markdown-language-icon').last()).toHaveText('unknown-language')
  expect(resources.filter((url) => /pierre-file-icon-.*\.js$/.test(url))).toHaveLength(1)
  const python = answer.getByRole('img', { name: 'Python', exact: true })
  const colors: string[] = []
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
    colors.push(await python.evaluate((element) => getComputedStyle(element).color))
  }
  expect(colors[0]).not.toBe(colors[1])
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expect(answer.getByRole('img', { name: 'Python', exact: true })).toHaveAttribute('data-file-icon', 'python')
  await expect(page.locator('#leon-pierre-file-icons')).toHaveCount(1)
  const ids = await page.locator('#leon-pierre-file-icons symbol').evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(ids).size).toBe(ids.length)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`renders rich Markdown with bounded local visuals and reading panes (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const source = [
      'A quiet note[^craft], with [a quiet guide](https://example.com/guide).',
      '- [x] Keep room for ideas\n- [ ] Take a small step',
      '> [!TIP]\n> Make something with care.',
      '> [!NOTE]\n> Keep a little space.',
      '> [!IMPORTANT]\n> Save your work.',
      '> [!WARNING]\n> Check before you continue.',
      '> [!CAUTION]\n> This action cannot be undone.',
      '<details>\n<summary>A little more</summary>\n\nA **warm** detail.\n\n</details>',
      '| Craft | Pace |\n| --- | --- |\n| Wood | Gentle |',
      'A right triangle: $a^2 + b^2 = c^2$.',
      '$$\nE = mc^2\n$$',
      '```typescript\nconst craft: string = "care";\n```',
      '```json\n{"craft": "care"}\n```',
      '```python\nprint("Craft")\n```',
      '```html\n<main>Craft</main>\n```',
      '```css\nmain { display: block; }\n```',
      '```bash\npwd\n```',
      '```javascript\n' + Array.from({ length: 60 }, (_, index) => `const idea${index} = "${'A quiet thought. '.repeat(15)}";`).join('\n') + '\n```',
      '[^craft]: A little practice goes a long way.'
    ].join('\n\n')
    ui.history.get(SESSION_ID)!.at(-1)!.message = source
    ui.history.get(SESSION_ID)!.at(-3)!.message = 'Another quiet note[^craft].\n\n[^craft]: A separate footnote.'
    await page.goto(SESSION_URL)
    const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
    await expect(answer.locator('.katex')).toHaveCount(2)
    await expect(answer.locator('math')).toHaveCount(2)
    await expect(answer.locator('.markdown-task-item')).toHaveCount(2)
    await expect(answer.getByRole('checkbox').first()).toBeChecked()
    await expect(answer.getByRole('checkbox').first()).toBeDisabled()
    await expect(answer.locator('ul.contains-task-list')).toHaveCSS('padding-left', '0px')
    await expect(answer.locator('.markdown-task-item').first()).toHaveCSS('display', 'list-item')
    await expect(answer.locator('.markdown-alert-tip')).toContainText('Make something with care.')
    await expect(answer.locator('.markdown-alert-tip .markdown-alert-title')).toHaveText('Tip')
    const details = answer.locator('details')
    await expect(details).not.toHaveAttribute('open')
    await details.locator('summary').click()
    await expect(details.locator('strong')).toHaveText('warm')
    await expect(answer.locator('.markdown-table')).toHaveCSS('border-radius', '12px')
    await expect(answer.getByRole('img', { name: 'TypeScript', exact: true })).toBeVisible()
    await expect(answer.getByRole('img', { name: 'JavaScript', exact: true })).toBeVisible()
    for (const label of ['JavaScript', 'TypeScript', 'Python', 'JSON', 'HTML', 'CSS', 'Shell']) {
      const icon = answer.getByRole('img', { name: label, exact: true })
      await expect(() => icon.scrollIntoViewIfNeeded()).toPass()
      await expect(icon).toHaveClass(/pierre-file-icon/)
      expect(await icon.locator('use').getAttribute('href')).toContain('#file-tree-builtin-')
      expect(await icon.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0)
    }
    await expect(answer.getByRole('region', { name: 'Code block', exact: true }).first()).toHaveCSS('overscroll-behavior-y', 'auto')
    const footnote = answer.getByRole('link', { name: '1', exact: true })
    await footnote.click()
    const href = (await footnote.getAttribute('href'))!
    expect(await answer.locator('[id]').evaluateAll((elements, fragment) => elements.some((element) => element.id === fragment.slice(1)), href)).toBe(true)
    const ids = await page.locator('.markdown-content [id]').evaluateAll((elements) => elements.map((element) => element.id))
    expect(new Set(ids).size).toBe(ids.length)
    const code = answer.getByRole('region', { name: 'Code block', exact: true }).last()
    await code.scrollIntoViewIfNeeded()
    await expect.poll(() => code.locator('span[style*="color"]').count()).toBeGreaterThan(0)
    expect(await code.locator('.code-view-line').count()).toBeLessThan(30)
    await expect(code).toHaveCSS('overscroll-behavior-y', 'auto')

    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await expect(code.locator('..')).toHaveCSS('background-color', theme === 'light' ? 'rgb(245, 245, 247)' : 'rgb(10, 10, 10)')
      const visuals = await answer.evaluate((element) => {
        function resolveColor(token: string): string {
          const probe = document.createElement('span')
          probe.style.color = `var(${token})`
          element.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()

          return color
        }
        const input = element.querySelector<HTMLInputElement>('.markdown-task-checkbox input')!
        const mark = element.querySelector<SVGElement>('.markdown-task-checkbox svg')!
        const inputBox = input.getBoundingClientRect()
        const markBox = mark.getBoundingClientRect()

        return {
          markColor: getComputedStyle(mark).color, contrastColor: resolveColor('--color-accent-contrast'),
          checkboxColor: getComputedStyle(input).backgroundColor, accent: resolveColor('--color-accent'),
          centerX: Math.abs(inputBox.x + inputBox.width / 2 - markBox.x - markBox.width / 2),
          centerY: Math.abs(inputBox.y + inputBox.height / 2 - markBox.y - markBox.height / 2),
          header: getComputedStyle(element.querySelector('th')!).backgroundColor, headerToken: resolveColor('--color-surface'),
          codeBlocks: Array.from(element.querySelectorAll<HTMLElement>('.markdown-code')).map((block) => {
            const header = block.querySelector('.markdown-code-header')!
            const body = block.querySelector('.code-view')!
            const logo = header.querySelector('.app-icon')!

            return { background: getComputedStyle(block).backgroundColor, body: getComputedStyle(body).backgroundColor,
              header: getComputedStyle(header).backgroundColor, border: getComputedStyle(block).borderWidth,
              separator: getComputedStyle(header).borderBottomWidth,
              logoSize: logo.getBoundingClientRect().width, fontSize: Number.parseFloat(getComputedStyle(header).fontSize),
              logoRadius: getComputedStyle(logo).borderRadius }
          }),
          alerts: Array.from(element.querySelectorAll<HTMLElement>('.markdown-alert')).map((alert) => {
            const kind = Array.from(alert.classList).find((name) => name.startsWith('markdown-alert-'))!.slice('markdown-alert-'.length)
            const title = alert.querySelector('.markdown-alert-title')!
            const icon = title.querySelector<HTMLElement>('.app-icon')!

            return { kind, color: getComputedStyle(title).color, token: resolveColor(`--color-markdown-alert-${kind}`),
              background: getComputedStyle(alert).backgroundColor, radius: getComputedStyle(alert).borderRadius,
              icon: icon.dataset['icon'], mask: getComputedStyle(icon).maskImage }
          })
        }
      })
      expect(visuals.markColor).toBe(visuals.contrastColor)
      expect(visuals.checkboxColor).toBe(visuals.accent)
      expect(visuals.centerX).toBeLessThanOrEqual(.5)
      expect(visuals.centerY).toBeLessThanOrEqual(.5)
      expect(visuals.header).toBe(visuals.headerToken)
      for (const block of visuals.codeBlocks) {
        expect(block.background).toBe(block.body)
        expect(block.header).toBe('rgba(0, 0, 0, 0)')
        expect(block.border).toBe('0px')
        expect(block.separator).toBe('0px')
        expect(block.logoSize).toBe(block.fontSize)
        expect(block.logoRadius).toBe('4px')
      }
      expect(visuals.alerts).toHaveLength(5)
      for (const alert of visuals.alerts) {
        expect(alert.color).toBe(alert.token)
        expect(alert.background).toBe('rgba(0, 0, 0, 0)')
        expect(alert.radius).toBe('0px')
        expect(alert.icon).toBe(`github-${alert.kind}`)
        expect(alert.mask).toContain(`/img/alerts/${alert.kind}.svg`)
      }
      const guide = answer.getByRole('link', { name: 'a quiet guide', exact: true })
      await guide.hover()
      await expect(guide).toHaveCSS('color', visuals.accent)
      await page.screenshot({ path: testInfo.outputPath(`rich-markdown-${theme}.png`) })
      await answer.locator('ul.contains-task-list').screenshot({ path: testInfo.outputPath(`task-list-${theme}.png`) })
      await answer.locator('.markdown-alert-tip').screenshot({ path: testInfo.outputPath(`alert-${theme}.png`) })
      await answer.locator('.markdown-code').first().screenshot({ path: testInfo.outputPath(`language-logo-${theme}.png`) })
    }
    expect(errors).toEqual([])
  })

  test(`waits for completed diagrams and enlarges trusted visuals with keyboard access (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const resources: string[] = []
    page.on('request', (request) => resources.push(request.url()))
    await page.goto(SESSION_URL)
    const createdAt = Date.now()
    let sequence = 0
    const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'diagram-turn', response_id: 'diagram-answer', created_at: createdAt + sequence
    }])
    await emit('turn_status', { status: 'accepted' })
    await emit('text_stream', { kind: 'answer', generationId: 'diagram-generation', token: '```mermaid\nflowchart LR\n  A[Ideas] --> B[Craft]\n' })
    await expect(page.getByRole('status').filter({ hasText: 'Drawing diagram…' })).toBeVisible()
    expect(resources.some((url) => url.includes('markdown-mermaid'))).toBe(false)
    const block = page.locator('.markdown-code').filter({ has: page.getByRole('img', { name: 'Mermaid', exact: true }) })
    await block.getByRole('button', { name: 'View diagram code', exact: true }).click()
    await expect(block.getByRole('region', { name: 'Code block', exact: true })).toContainText('flowchart LR')
    await emit('text_stream', { kind: 'answer', generationId: 'diagram-generation', token: '```' })
    expect(resources.some((url) => url.includes('markdown-mermaid'))).toBe(false)
    await page.getByRole('button', { name: 'View diagram', exact: true }).click()
    const preview = page.getByRole('button', { name: 'Enlarge diagram', exact: true })
    await expect(preview.locator('svg')).toBeVisible()
    expect(resources.some((url) => url.includes('markdown-math-engine'))).toBe(false)
    await expect(preview).toHaveCSS('cursor', 'zoom-in')
    const drawing = await preview.locator('svg').elementHandle()
    await page.getByRole('button', { name: 'View diagram code', exact: true }).click()
    await expect(preview).not.toBeVisible()
    await expect(page.getByRole('region', { name: 'Code block', exact: true })).toContainText('A[Ideas] --> B[Craft]')
    await page.getByRole('button', { name: 'View diagram', exact: true }).click()
    await expect(preview).toBeVisible()
    expect(await drawing!.evaluate((element) => element.isConnected)).toBe(true)
    await preview.focus()
    await page.keyboard.press('Enter')
    const viewer = page.getByRole('dialog', { name: 'Diagram', exact: true })
    const enlarged = viewer.getByRole('img', { name: 'Diagram', exact: true })
    await expect(enlarged).toBeVisible()
    const svgUrl = (await enlarged.getAttribute('src'))!
    expect(svgUrl.startsWith('blob:')).toBe(true)
    await finishFiniteAnimations(page.locator('.dialog-overlay').last())
    await page.screenshot({ path: testInfo.outputPath('diagram-viewer.png') })
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(preview).toBeFocused()
    expect(await page.evaluate(async (url) => {
      try {
        await fetch(url)
        return true
      } catch {
        return false
      }
    }, svgUrl)).toBe(false)
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1_512, height: 982 })
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await expect(preview.locator('svg')).toBeVisible()
      const toggle = block.getByRole('button', { name: 'View diagram code', exact: true })
      const copy = block.getByRole('button', { name: 'Copy code', exact: true })
      await expect(block).toHaveCSS('background-color', theme === 'light' ? 'rgb(245, 245, 247)' : 'rgb(10, 10, 10)')
      await page.mouse.move(0, 0)
      await finishFiniteAnimations(block.locator('.markdown-code-actions'))
      await expect(toggle).toHaveCSS('color', await copy.evaluate((element) => getComputedStyle(element).color))
      await toggle.hover()
      await finishFiniteAnimations(toggle)
      const hoverColor = await toggle.evaluate((element) => getComputedStyle(element).color)
      await copy.hover()
      await expect(copy).toHaveCSS('color', hoverColor)
      for (const width of [1_512, 390]) {
        await page.setViewportSize({ width, height: 982 })
        await expect(preview).toBeInViewport()
        await expect.poll(() => preview.evaluate((element) => {
          const svg = element.querySelector('svg')
          const block = element.closest('.markdown-diagram-block')
          if (!svg || !block) {
            return null
          }
          const width = block.getBoundingClientRect().width

          return { fullWidth: width > 0 && Math.abs(svg.getBoundingClientRect().width - width) <= 1,
            framed: Boolean(element.closest('.markdown-code')), background: getComputedStyle(block).backgroundColor }
        })).toEqual({ fullWidth: true, framed: true, background: 'rgba(0, 0, 0, 0)' })
        await page.screenshot({ path: testInfo.outputPath(`diagram-${theme}-${width}.png`) })
      }
    }
    await page.setViewportSize({ width: 1_512, height: 982 })
    const imageUrl = `/api/v1/artifacts/${SESSION_ID}/sketch`
    await page.route(`**${imageUrl}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', path: 'apps/web/public/img/favicon.png' })
    })
    const artifact = { id: 'sketch', session_id: SESSION_ID, filename: 'sketch.png', mime_type: 'image/png',
      size_bytes: 1_024, created_at: createdAt, source: 'tool', url: imageUrl }
    await emit('final_answer', { content: '```mermaid\nflowchart LR\n  A[Ideas] --> B[Craft]\n```',
      artifacts: [artifact, { ...artifact, id: 'unsafe', filename: 'unsafe.png', url: 'https://untrusted.example/image.png' }] })
    await emit('turn_status', { status: 'completed' })
    const image = page.getByRole('button', { name: 'Enlarge sketch.png', exact: true })
    await expect(image.getByRole('img')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enlarge unsafe.png', exact: true })).toHaveCount(0)
    await image.click()
    const imageViewer = page.getByRole('dialog', { name: 'sketch.png', exact: true })
    await expect(imageViewer.getByRole('img')).toHaveAttribute('src', imageUrl)
    await page.keyboard.press('Escape')
    await expect(imageViewer).toHaveCount(0)
    await expect(image).toBeFocused()
    expect(errors).toEqual([])
  })
}

test('does not execute Markdown HTML, unsafe links, or remote images', async ({ page, ui }) => {
  const outbound: string[] = []
  await page.route('https://**', async (route) => {
    outbound.push(route.request().url())
    await route.abort()
  })
  ui.history.get(SESSION_ID)!.at(-1)!.message = [
    'A safe paragraph.',
    '<script>window.markdownExecuted = true</script>',
    '<img src="https://untrusted.example/track" onerror="window.markdownExecuted = true">',
    '[unsafe](javascript:alert%281%29)',
    '[private](file:///etc/passwd)',
    '![No automatic image](https://untrusted.example/image.png)',
    '[credentials](https://user:password@example.com/private)'
  ].join('\n\n')
  await page.goto(SESSION_URL)
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(answer).toContainText('A safe paragraph.')
  await expect(answer.locator('script, img, a')).toHaveCount(0)
  await expect(answer).toContainText('No automatic image')
  expect(await page.evaluate(() => Reflect.get(window, 'markdownExecuted'))).toBeUndefined()
  expect(outbound).toEqual([])
})

test('reserves completed diagram geometry while loading and across session revisits', async ({ page, ui }) => {
  ui.history.get(SESSION_ID)!.at(-1)!.message = 'A few ideas, with room to explore.\n\n```mermaid\nflowchart TB\n A[An idea] --> B[Explore]\n B --> C[Make something]\n C --> D[Share]\n```\n\nA calm place to continue.'
  const blocked = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route('**/markdown-mermaid-*.js', async (route) => {
    blocked.resolve()
    await release.promise
    await route.continue()
  })
  await page.goto(SESSION_URL)
  await blocked.promise
  const layout = page.locator('.markdown-diagram-block > .visual-layout')
  await expect(layout).toHaveAttribute('aria-busy', 'true')
  expect((await layout.boundingBox())!.height).toBeGreaterThanOrEqual(240)
  release.resolve()
  await expect(layout).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: 'Enlarge diagram', exact: true }).locator('svg')).toBeVisible()
  const settled = (await layout.boundingBox())!.height
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(layout).toHaveCount(0)
  await page.evaluate(() => {
    const heights: number[] = []
    let frame = 0
    function sample(): void {
      const height = document.querySelector('.markdown-diagram-block > .visual-layout')?.getBoundingClientRect().height
      if (height) {
        heights.push(height)
      }
      frame = requestAnimationFrame(sample)
    }
    frame = requestAnimationFrame(sample)
    const host = window as typeof window & { finishVisualProbe: () => number[] }
    host.finishVisualProbe = (): number[] => {
      cancelAnimationFrame(frame)

      return heights
    }
  })
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expect(layout).toHaveAttribute('aria-busy', 'false')
  const heights = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const host = window as typeof window & { finishVisualProbe: () => number[] }

    return host.finishVisualProbe()
  })
  expect(heights.length).toBeGreaterThan(0)
  expect(Math.max(...heights.map((height) => Math.abs(height - settled)))).toBeLessThan(2)
})

test('renders independently loaded diagram families and safe mathematical labels', async ({ page, ui }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const sources = [
    'sequenceDiagram\n Alice->>Bob: Hello',
    'classDiagram\n class Idea',
    'stateDiagram-v2\n [*] --> Ready',
    'erDiagram\n OWNER ||--o{ IDEA : creates',
    'mindmap\n root((Ideas))\n  Craft',
    'architecture-beta\n service app(server)[App]',
    'pie title Quiet time\n "Craft": 80\n "Rest": 20',
    'packet-beta\n 0-7: "Ideas"',
    'gitGraph\n commit\n branch ideas\n checkout ideas\n commit',
    'flowchart LR\n A["$$x^2 + y^2$$"] --> B[Craft]'
  ]
  ui.history.get(SESSION_ID)!.at(-1)!.message = sources.map((source) => `\`\`\`mermaid\n${source}\n\`\`\``).join('\n\n')
  await page.goto(SESSION_URL)
  const diagrams = page.getByRole('button', { name: 'Enlarge diagram', exact: true })
  await expect(diagrams.locator('.markdown-diagram > svg')).toHaveCount(sources.length)
  await expect(diagrams.last().locator('math')).toHaveCount(1)
  await expect(diagrams.locator('a, image, img, script, style')).toHaveCount(0)
  await diagrams.last().click()
  const image = page.getByRole('dialog', { name: 'Diagram', exact: true }).getByRole('img', { name: 'Diagram', exact: true })
  await expect(image).toBeVisible()
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth > 0)).toBe(true)
  expect(errors).toEqual([])
})

test('keeps diagram directives from enabling scripts or remote image requests', async ({ page, ui }) => {
  const outbound: string[] = []
  await page.route('https://**', async (route) => {
    outbound.push(route.request().url())
    await route.abort()
  })
  ui.history.get(SESSION_ID)!.at(-1)!.message = [
    '```mermaid',
    '---',
    'config:',
    '  securityLevel: loose',
    '  htmlLabels: true',
    '  themeCSS: "@import url(https://untrusted.example/style.css);"',
    '---',
    'flowchart LR',
    ' A["<img src=https://untrusted.example/track onerror=alert(1)>"] --> B[Safe]',
    '```'
  ].join('\n')
  await page.goto(SESSION_URL)
  const preview = page.getByRole('button', { name: 'Enlarge diagram', exact: true })
  await expect(preview.locator('svg')).toBeVisible()
  await expect(preview.locator('img, image, script, foreignObject')).toHaveCount(0)
  expect(outbound).toEqual([])
})

test('preserves prose and source copying when the optional diagram download fails', async ({ page, ui }) => {
  await page.route('**/assets/markdown-mermaid-*.js', (route) => route.abort())
  ui.history.get(SESSION_ID)!.at(-1)!.message = 'A quiet idea.\n\n```mermaid\nflowchart LR\n A --> B\n```\n\nThere is still room to create.'
  await page.goto(SESSION_URL)
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(answer).toContainText('I couldn’t load this diagram. Check your connection; its source is available to copy.')
  await expect(answer).toContainText('A quiet idea.')
  await expect(answer).toContainText('There is still room to create.')
  await answer.locator('.markdown-diagram-block').hover()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await answer.getByRole('button', { name: 'Copy code', exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('A --> B')
})

test('enlarges diagrams from tool inspectors without closing their parent dialog', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
      id: 'diagram-tool', name: 'test.render', toolCallTitle: 'Sketch the idea', status: 'success',
      output: { result: { content: '```mermaid\nflowchart LR\n A[Ideas] --> B[Craft]\n```', format: 'markdown' } }
    }]
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
  await page.getByRole('button', { name: 'Used 1 tool', exact: true }).click()
  await page.getByRole('button', { name: 'Sketch the idea', exact: true }).click()
  await page.getByRole('button', { name: 'View details', exact: true }).click()
  const inspector = page.getByRole('dialog', { name: 'Sketch the idea', exact: true })
  const preview = inspector.getByRole('button', { name: 'Enlarge diagram', exact: true })
  await expect(preview.locator('svg')).toBeVisible()
  await preview.click()
  const viewer = page.getByRole('dialog', { name: 'Diagram', exact: true })
  await expect(viewer.getByRole('img', { name: 'Diagram', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(inspector).toBeVisible()
  await expect(preview).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(inspector).toHaveCount(0)
})

test('waits for complete streamed destinations before enabling links or fetching favicons', async ({ page, ui }) => {
  const requests: string[] = []
  await page.route('**/api/v1/favicons?**', async (route) => {
    requests.push(route.request().url())
    await route.fulfill({ status: 404, body: '' })
  })
  await page.goto(SESSION_URL)
  let sequence = 0
  const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
    type, data, sequence: ++sequence, session_id: SESSION_ID, turn_id: 'link-turn',
    response_id: 'link-answer', created_at: Date.now()
  }])
  await emit('turn_status', { status: 'accepted' })
  await emit('text_stream', { kind: 'answer', generationId: 'link-generation', token: 'Read https://exa' })
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(answer).toContainText('Read https://exa')
  await expect(answer.getByRole('link')).toHaveCount(0)
  expect(requests).toEqual([])
  await emit('text_stream', { kind: 'answer', generationId: 'link-generation', token: 'mple.com/guide for a little context.' })
  await expect(answer.getByRole('link')).toHaveAttribute('href', 'https://example.com/guide')
  await expect.poll(() => requests.length).toBe(1)
  await emit('text_stream', { kind: 'answer', generationId: 'link-generation', token: ' More to follow.' })
  await expect(answer).toContainText('More to follow.')
  expect(requests).toHaveLength(1)
})

test('bounds large Markdown reveals and code rows while keeping settled selections stable', async ({ page, ui }, testInfo) => {
  await page.goto(SESSION_URL)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  const responseId = 'long-markdown'
  let sequence = 0
  const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
    type, data, sequence: ++sequence, session_id: SESSION_ID,
    turn_id: 'long-markdown-turn', response_id: responseId, created_at: Date.now()
  }])
  await emit('turn_status', { status: 'accepted' })
  const source = Array.from({ length: 180 }, (_, index) => `Paragraph ${index}: **Keep a little room** for curiosity, with *one useful idea* at a time.`).join('\n\n')
  const started = performance.now()
  await emit('text_stream', { kind: 'answer', generationId: 'long-markdown-generation', token: source })
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(answer.locator('p')).toHaveCount(180)
  expect(await answer.locator('.streaming-text-character-new').count()).toBeLessThanOrEqual(1_024)
  await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
  const paragraph = answer.locator('p').last()
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
  })
  const selected = await page.evaluate(() => window.getSelection()!.toString())
  const node = await paragraph.elementHandle()
  await emit('text_stream', { kind: 'answer', generationId: 'long-markdown-generation', token: '\n\nMore space for the next idea.\n\n```js\n' + Array.from({ length: 240 }, (_, index) => `const idea${index} = "Make something useful";`).join('\n') + '\n```' })
  const code = answer.getByRole('region', { name: 'Code block', exact: true })
  await expect(code).toBeVisible()
  expect(await code.locator('.code-view-line').count()).toBeLessThan(30)
  expect(await node!.evaluate((element) => element.isConnected)).toBe(true)
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(selected)
  await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
  await testInfo.attach('large-markdown-observations', {
    body: JSON.stringify({ sourceCharacters: source.length, paragraphs: 180, codeLines: 240,
      visibleCodeRows: await code.locator('.code-view-line').count(),
      descendantElements: await answer.locator('*').count(), elapsedMs: Math.round(performance.now() - started) }),
    contentType: 'application/json'
  })
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`adds a delayed FYI without reopening the completed turn (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.message = 'Daytime skies look blue because air molecules scatter shorter wavelengths of sunlight more strongly than longer wavelengths. This effect is called Rayleigh scattering.'
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], toolCalls: [],
      reasoning: [{ id: 'thought', text: 'Checking the source.', phase: 'agent', startedAt: answer.sentAt - 1_000 }],
      metrics: { durationMs: 6_000 }
    }
    await page.goto(SESSION_URL)
    const footer = page.getByRole('complementary', { name: 'FYI', exact: true })
    const finalAnswer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
    await expect(finalAnswer).toHaveText(answer.message)
    await expect(footer).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
    const fyi = { kind: FyiKind.Fact, text: 'FYI, a related detail can make the answer easier to remember.' }
    const event: ConversationEvent = {
      type: 'fyi', sequence: 1, session_id: SESSION_ID, turn_id: null,
      response_id: answer.messageId, created_at: Date.now(), data: { fyi }
    }
    answer.fyi = fyi
    await ui.emit([event])
    await expect(footer).toHaveText(fyi.text)
    await expect(footer).toHaveCSS('font-style', 'italic')
    await expect(finalAnswer).toHaveText(answer.message)
    await expect(page.getByRole('button', { name: 'Worked for 6s', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop this turn', exact: true })).toHaveCount(0)
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(footer.locator('.bonus-response-icon')).toHaveCSS('background-image', new RegExp(`logo-for-${theme === 'light' ? 'light' : 'dark'}-bg\\.svg`))
      await expect(footer).toHaveCSS('font-size', await footer.evaluate((element) => getComputedStyle(element).getPropertyValue('--font-size-sm').trim()))
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await page.screenshot({ path: testInfo.outputPath(`fyi-${theme}.png`) })
    }
    await ui.emit([{ ...event, sequence: 2 }, { ...event, sequence: 3, response_id: 'unloaded-answer' }])
    await expect(footer).toHaveCount(1)
    expect((await footer.boundingBox())!.y).toBeGreaterThan((await finalAnswer.boundingBox())!.y)
    await page.screenshot({ path: testInfo.outputPath('fyi-footer.png') })
    await page.reload()
    await expect(footer).toHaveText(fyi.text)
    await expect(footer).toHaveCount(1)
    await expect(finalAnswer).toHaveText(answer.message)
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
  })
}

test('keeps brief replies footer-free for saved history and late background events', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = 'Hey there. What is on your mind?'
  answer.fyi = { kind: FyiKind.Mood, text: answer.message }
  await page.goto(SESSION_URL)
  const footer = page.getByRole('complementary', { name: 'FYI', exact: true })
  const finalAnswer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(finalAnswer).toHaveText(answer.message)
  await expect(footer).toHaveCount(0)
  await ui.emit([{
    type: 'fyi', sequence: 1, session_id: SESSION_ID, turn_id: null,
    response_id: answer.messageId, created_at: Date.now(), data: { fyi: answer.fyi }
  }])
  await expect(footer).toHaveCount(0)
  await page.reload()
  await expect(finalAnswer).toHaveText(answer.message)
  await expect(footer).toHaveCount(0)
})

for (const kind of ['skill', 'experience'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`updates, inspects and restores one ${kind} activity (${reducedMotion})`, async ({ page, ui }, testInfo) => {
      await page.emulateMedia({ reducedMotion })
      await page.goto(SESSION_URL)
      const name = kind === 'experience' ? 'expense-report' : 'coding'
      const responseId = 'skill-response'
      const createdAt = Date.now()
      const skill = { name, instructions: [
        `# ${name}`, '', 'Read the source files before making changes.',
        ...Array.from({ length: 64 }, (_, index) => `Inspect source ${index + 1} and record its behavior.`),
        'Verify the result before answering.'
      ].join('\n') }
      const progress = { id: `skill-activity:task:${kind}:fixture`,
        content: `Loaded ${kind}: ${name}`, created_at: createdAt, icon_name: kind === 'experience' ? 'brain-2-line' : 'book-ai-line', skill }
      let sequence = 0
      const emit = (): Promise<void> => ui.emit([{
        type: 'progress_message', sequence: ++sequence, session_id: SESSION_ID,
        turn_id: 'skill-task', response_id: responseId, created_at: Date.now(),
        data: { message: { ...progress } }
      }])

      await ui.emit([{
        type: 'turn_status', sequence: ++sequence, session_id: SESSION_ID,
        turn_id: 'skill-task', response_id: responseId, created_at: createdAt,
        data: { status: 'accepted' }
      }])
      await emit()
      const item = page.getByRole('region', { name: 'Leon’s activity', exact: true }).filter({ hasText: name })
      await expect(item).toHaveCount(1)
      await expect(item).toContainText(progress.content)
      await expect(item.locator(kind === 'experience' ? '[data-icon="brain-2"]' : '[data-icon="book-ai"]')).toBeVisible()
      const disclosure = item.getByRole('button', { name: progress.content, exact: true })
      const contents = item.getByRole('region', { name: `${name}/SKILL.md`, exact: true })
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await expect(contents).toHaveCount(0)
      await disclosure.focus()
      await page.keyboard.press('Enter')
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
      await expect(contents).toContainText('Read the source files before making changes.')
      await expect(contents.locator('.code-view-line')).toHaveCount(CODE_PREVIEW_LINES)
      await expect(contents).not.toContainText('Verify the result before answering.')
      await expect(contents.locator('.code-view-line').last()).toHaveText('…')
      await expect(contents.locator('.code-view-ellipsis')).toHaveAttribute('aria-label', 'More content omitted')
      progress.content = `${kind === 'experience' ? 'Used' : 'Using'} ${kind}: ${name}`
      await emit()
      await emit()
      await expect(item).toHaveCount(1)
      await expect(item).toContainText(progress.content)
      await expect(item).not.toContainText(`Loaded ${kind}`)
      await expect(item.getByRole('button', { name: progress.content, exact: true })).toHaveAttribute('aria-expanded', 'true')
      await expect(contents).toContainText('Read the source files before making changes.')
      const details = item.getByRole('button', { name: 'View details', exact: true })
      await expect(details.locator('.button-label')).toHaveText('View details')
      await expect(details.locator('.button-icon')).toHaveCount(0)
      await expect(item.locator('.activity-details-heading').getByRole('button')).toHaveCount(0)
      const dialog = page.getByRole('dialog', { name, exact: true })
      const complete = dialog.getByRole('region', { name: 'SKILL.md', exact: true })
      for (const theme of ['light', 'dark']) {
        await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
        if (reducedMotion === 'reduce') {
          await page.setViewportSize({ width: 390, height: 844 })
        }
        await expect(item.locator(kind === 'experience' ? '[data-icon="brain-2"]' : '[data-icon="book-ai"]')).toBeVisible()
        await expect(item.locator('.activity-details-frame')).toBeVisible()
        const frameBounds = (await item.locator('.activity-details-frame').boundingBox())!
        const buttonBounds = (await details.boundingBox())!
        const footerBounds = (await item.locator('.activity-details-footer').boundingBox())!
        const previewBounds = (await contents.boundingBox())!
        expect(Math.abs(buttonBounds.x + buttonBounds.width / 2 - frameBounds.x - frameBounds.width / 2)).toBeLessThanOrEqual(1)
        expect(Math.abs(buttonBounds.x - footerBounds.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(buttonBounds.width - footerBounds.width)).toBeLessThanOrEqual(1)
        expect(Math.abs(buttonBounds.height - footerBounds.height)).toBeLessThanOrEqual(1)
        expect(buttonBounds.y).toBeGreaterThan(previewBounds.y + previewBounds.height)
        await page.screenshot({ path: testInfo.outputPath(`skill-activity-${theme}.png`) })
        await details.click()
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
        await expect(dialog.getByText(`${name}/SKILL.md`, { exact: true })).toHaveCount(1)
        await expect(dialog.locator('.activity-details-path')).toHaveText(`${name}/SKILL.md`)
        await expect(dialog.locator('.activity-details-toolbar .activity-details-title')).toHaveCount(0)
        await expect(complete).toContainText(`# ${name}`)
        await complete.evaluate((element) => { element.scrollTop = element.scrollHeight })
        await expect(complete).toContainText('Verify the result before answering.')
        expect(await complete.locator('.code-view-line').count()).toBeLessThan(40)
        const viewport = page.viewportSize()!
        const bounds = (await dialog.boundingBox())!
        expect(bounds.width).toBeLessThanOrEqual(viewport.width - 28)
        expect(bounds.y + bounds.height).toBeLessThan(viewport.height)
        await page.screenshot({ path: testInfo.outputPath(`skill-dialog-${theme}.png`) })
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(details).toBeFocused()
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
        if (reducedMotion === 'reduce') {
          await page.setViewportSize({ width: 1_512, height: 982 })
        }
      }

      await details.click()
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await dialog.getByRole('button', { name: 'Copy SKILL.md', exact: true }).click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(skill.instructions)
      const downloadEvent = page.waitForEvent('download')
      await dialog.getByRole('button', { name: 'Download SKILL.md', exact: true }).click()
      const download = await downloadEvent
      expect(download.suggestedFilename()).toBe('SKILL.md')
      expect(await fs.readFile((await download.path())!, 'utf8')).toBe(skill.instructions)

      const saved: ConversationRecord = {
        who: 'leon', messageId: responseId, message: 'The result is verified.',
        sentAt: createdAt + 1_000, isAddedToHistory: true,
        agentResponseTrace: {
          id: responseId, planSteps: [], toolCalls: [],
          progressMessages: [{ id: progress.id, content: progress.content, createdAt, iconName: progress.icon_name, skill }]
        }
      }
      ui.history.get(SESSION_ID)!.push(saved)
      await ui.emit([
        { type: 'final_answer', sequence: ++sequence, session_id: SESSION_ID,
          turn_id: 'skill-task', response_id: responseId, created_at: createdAt + 1_000,
          data: { content: saved.message, response_trace: saved.agentResponseTrace } },
        { type: 'turn_status', sequence: ++sequence, session_id: SESSION_ID,
          turn_id: 'skill-task', response_id: responseId, created_at: createdAt + 1_001,
          data: { status: 'completed' } }
      ])
      await expect(page.getByRole('region', { name: 'Leon’s completed work', exact: true }).last()
        .getByRole('button').first()).toHaveAttribute('aria-expanded', 'false')
      await expect(dialog).toBeVisible()
      await expect(contents).toHaveCount(0)
      await expect(complete).toContainText(`# ${name}`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.reload()
      const work = page.getByRole('region', { name: 'Leon’s completed work', exact: true }).last()
      await work.getByRole('button').first().click()
      await expect(item).toHaveCount(1)
      await expect(item).toContainText(progress.content)
      await expect(item.locator(kind === 'experience' ? '[data-icon="brain-2"]' : '[data-icon="book-ai"]')).toBeVisible()
      const restored = item.getByRole('button', { name: progress.content, exact: true })
      await expect(restored).toHaveAttribute('aria-expanded', 'false')
      await restored.click()
      await expect(contents).toContainText('Read the source files before making changes.')
      await details.click()
      await expect(complete).toContainText(`# ${name}`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await restored.click()
      await expect(contents).toHaveCount(0)
    })
  }
}

for (const withPlan of [false, true]) {
  test(`updates post-answer compaction independently of turn and plan state (plan: ${withPlan})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion: withPlan ? 'reduce' : 'no-preference' })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    const startedAt = Date.now()
    answer.agentResponseTrace = { id: answer.messageId, toolCalls: [], metrics: { durationMs: 6_000 },
      planSteps: withPlan ? [{ id: 'inspect', label: 'Inspect the sources', status: 'completed' }] : [] }
    await page.goto(SESSION_URL)
    const status = page.getByRole('region', { name: 'History compaction', exact: true })
    const activity = { id: 'history-maintenance', goal: TurnPhase.Compaction,
      startedAt, durationMs: 0, outcome: 'started' }
    const widget = { widget: 'PlanWidget', fallbackText: 'Compacting history...', activity }
    let sequence = 0
    const emit = (): Promise<void> => ui.emit([{
      type: 'widget', sequence: ++sequence, session_id: SESSION_ID, turn_id: null,
      response_id: activity.id, created_at: startedAt + activity.durationMs, data: { widget }
    }])
    await emit()
    await expect(status).toHaveClass(/process-group-active/)
    await expect(status.locator('.process-group-title')).toHaveText('Compacting history...')
    await expect(status.locator('.activity-wave-active')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()).toHaveText(answer.message)
    await expect(page.locator('.leon-message-work')).toHaveCount(withPlan ? 1 : 0)
    const saved: ConversationRecord = { who: 'leon', messageId: activity.id, message: widget.fallbackText,
      sentAt: startedAt, isAddedToHistory: false, widget: structuredClone(widget) }
    ui.history.get(SESSION_ID)!.push(saved)
    await page.reload()
    await expect(status).toHaveClass(/process-group-active/)
    await expect(status.locator('.process-group-title')).toHaveText('Compacting history...')

    activity.durationMs = 8_679
    activity.outcome = 'completed'
    widget.fallbackText = 'Compacted history'
    saved.widget = structuredClone(widget)
    await emit()
    await expect(status).not.toHaveClass(/process-group-active/)
    await expect(status.locator('.process-group-title')).toHaveText('Compacted history in 9s')
    await expect(status.locator('.activity-wave-active')).toHaveCount(0)
    await page.reload()
    await expect(status.locator('.process-group-title')).toHaveText('Compacted history in 9s')
    await expect(status.locator('.activity-timestamp')).toHaveCount(1)
    await expect(page.locator('.leon-message-work')).toHaveCount(withPlan ? 1 : 0)
    await expect(page.locator('.leon-message').filter({ has: status }).locator('.final-answer')).toHaveCount(0)
    if (withPlan) {
      await expect(page.getByRole('button', { name: 'Worked for 6s', exact: true })).toBeVisible()
    }
    await page.screenshot({ path: testInfo.outputPath('completed-compaction.png') })

    activity.outcome = 'started'
    activity.durationMs = 0
    await emit()
    await expect(status).toHaveClass(/process-group-active/)
    activity.outcome = 'failed'
    activity.durationMs = 435
    widget.fallbackText = 'History compaction failed'
    saved.widget = structuredClone(widget)
    await emit()
    await expect(status.locator('.process-group-title')).toHaveText('History compaction failed after 435ms')
    await expect(status).not.toHaveClass(/process-group-active/)
    await page.reload()
    await expect(status.locator('.process-group-title')).toHaveText('History compaction failed after 435ms')
  })
}

test('updates and restores legacy compaction from its checkbox without inventing duration', async ({ page, ui }) => {
  const label = 'Compacting history...'
  const widget: NonNullable<ConversationRecord['widget']> = { widget: 'PlanWidget', fallbackText: label, componentTree: {
    component: 'WidgetWrapper', props: { children: [{ component: 'List', props: { children: [{
      component: 'ListItem', props: { children: [{ component: 'Text', props: { children: label } }] }
    }] } }] }
  } }
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = { id: answer.messageId, toolCalls: [], metrics: { durationMs: 6_000 },
    planSteps: [{ id: 'finished', label: 'Inspect the sources', status: 'completed' }] }
  ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: 'saved-compaction', message: label,
    sentAt: Date.now(), isAddedToHistory: false, widget })
  await page.goto(SESSION_URL)
  const status = page.getByRole('region', { name: 'History compaction', exact: true })
  await expect(status).toHaveClass(/process-group-active/)
  widget.componentTree = { component: 'WidgetWrapper', props: { children: [{ component: 'List', props: { children: [{
    component: 'ListItem', props: { children: [{ component: 'Checkbox', props: { label, checked: true } }] }
  }] } }] } }
  await ui.emit([{ type: 'widget', sequence: 1, session_id: SESSION_ID, turn_id: null,
    response_id: 'saved-compaction', created_at: Date.now(), data: { widget } }])
  await expect(status.locator('.process-group-title')).toHaveText('Compacted history')
  await page.reload()
  await expect(status.locator('.process-group-title')).toHaveText('Compacted history')
  await expect(status).not.toHaveClass(/process-group-active/)
  await expect(status.locator('.activity-timestamp')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Worked for 6s', exact: true })).toBeVisible()
  await expect(page.locator('.leon-message').filter({ has: status }).locator('.final-answer')).toHaveCount(0)
})

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
  await expect(stop.locator('[data-icon="stop-mini"]')).toBeVisible()
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
  await expect(send.locator('[data-icon="send-ins"]')).toBeVisible()
  await expect(composer).toHaveValue('Draft for later')
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const withPlan of [false, true]) {
    test(`continues work below follow-ups without duplicating the turn (${reducedMotion}, plan: ${withPlan})`, async ({ page, ui }, testInfo) => {
      await page.emulateMedia({ reducedMotion })
      const startedAt = Date.now() - 10_000
      const owner: ConversationRecord = { who: 'owner', messageId: 'followup-root', message: 'Inspect the sources.',
        sentAt: startedAt, isAddedToHistory: true }
      const responseId = `${owner.messageId}:leon`
      const step = { id: 'sources', label: 'Inspect the sources carefully', status: 'in_progress' as const }
      const firstCall = { id: 'source-one', name: 'test.lookup.run', toolCallTitle: 'Read first source',
        status: 'running' as const, startedAt: startedAt + 100, preparationStartedAt: startedAt + 90,
        input: { source: 'first' }, commandOutput: 'Initial source output', ...(withPlan ? { planStepId: step.id } : {}) }
      const saved: ConversationRecord = { who: 'leon', messageId: responseId, message: '',
        sentAt: startedAt + 1, isAddedToHistory: false, agentResponseTrace: { id: responseId,
          toolCalls: [firstCall], planSteps: withPlan ? [step] : [],
          planTransitions: withPlan ? [{ ...step, changedAt: startedAt + 50 }] : [] } }
      ui.history.set(SESSION_ID, [owner, saved])
      ui.sessions[0]!.status = 'wip' as SessionStatus
      await page.route(`**/api/v1/sessions/${SESSION_ID}/messages`, (route) => {
        const input = route.request().postDataJSON() as { id: string }
        return route.fulfill({ json: { command: { id: input.id, status: 'accepted' } } })
      })
      await page.goto(SESSION_URL)
      const composer = page.getByRole('textbox', { name: 'Message Leon' })
      let sequence = 0
      const emit = (type: string, data: Record<string, unknown>, offset: number): Promise<void> => ui.emit([{
        type, data, sequence: ++sequence, session_id: SESSION_ID, turn_id: owner.messageId,
        response_id: responseId, created_at: startedAt + offset
      }])
      const sendFollowup = async (query: string, offset: number): Promise<void> => {
        const posted = page.waitForRequest((request) => request.method() === 'POST' &&
          new URL(request.url()).pathname === `/api/v1/sessions/${SESSION_ID}/messages`)
        await composer.fill(query)
        await composer.press('Enter')
        const input = (await posted).postDataJSON() as { id: string }
        const message: ConversationRecord = { who: 'owner', messageId: input.id, message: query,
          sentAt: startedAt + offset, isAddedToHistory: true }
        ui.history.get(SESSION_ID)!.push(message)
        await emit('owner_message', { message }, offset)
        await ui.emit([{ type: 'turn_status', data: { status: 'completed', consumed: true },
          sequence: ++sequence, session_id: SESSION_ID, turn_id: input.id,
          response_id: `${input.id}:leon`, created_at: startedAt + offset + 1 }])
      }
      const root = page.locator('.feed-turn').filter({ has: page.getByText(owner.message, { exact: true }) })
      await expect(root.locator('.tool-call-title')).toHaveText('Read first source')
      await sendFollowup('Also inspect the second source.', 400)
      const middle = page.locator('.feed-turn').filter({ has: page.getByText('Also inspect the second source.', { exact: true }) })
      const secondCall = { id: 'source-two', name: firstCall.name, toolCallTitle: 'Read second source',
        status: 'running' as const, startedAt: startedAt + 500, ...(withPlan ? { planStepId: step.id } : {}) }
      saved.agentResponseTrace!.toolCalls.push(secondCall)
      await emit('tool_call', { tool_call: { id: secondCall.id, name: secondCall.name, tool_call_title: secondCall.toolCallTitle,
        status: secondCall.status, started_at: secondCall.startedAt, ...(withPlan ? { plan_step_id: step.id } : {}) } }, 500)
      await expect(middle.locator('.tool-call-title')).toHaveText('Read second source')
      await expect(root.locator('.tool-call-title')).toHaveText('Read first source')
      await expect(middle.locator('.leon-message')).toHaveCount(1)
      saved.agentResponseTrace!.toolCalls[0] = { ...firstCall, status: 'success', durationMs: 600, commandOutput: 'Finished first source' }
      await emit('tool_call', { tool_call: { id: firstCall.id, name: firstCall.name,
        status: 'success', duration_ms: 600, command_output: 'Finished first source' } }, 700)
      const openTools = async (turn: Locator): Promise<void> => {
        const work = turn.getByRole('region', { name: 'Leon’s completed work', exact: true }).locator(':scope > .process-group-heading > button')
        if (await work.count() && await work.getAttribute('aria-expanded') === 'false') {
          await work.click()
        }
        if (withPlan) {
          const plan = turn.getByRole('region', { name: 'Leon’s execution plan', exact: true })
          const trigger = plan.locator(':scope > .process-group-heading > button')
          if (await trigger.getAttribute('aria-expanded') === 'false') {
            await trigger.click()
          }
          const stepTrigger = plan.locator('.task-list-item-trigger')
          if (await stepTrigger.getAttribute('aria-expanded') === 'false') {
            await stepTrigger.click()
          }
        }
        const tools = turn.getByRole('region', { name: 'Leon’s tool usage', exact: true }).locator(':scope > .process-group-heading > button')
        if (await tools.getAttribute('aria-expanded') === 'false') {
          await tools.click()
        }
      }
      await openTools(root)
      await root.getByRole('button', { name: 'Read first source' }).click()
      await expect(root.getByLabel('Tool output', { exact: true })).toContainText('Finished first source')
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(ui.requests.some((url) => decodeURIComponent(url.pathname).includes(`/messages/${responseId}/tools/`))).toBe(true)
      saved.agentResponseTrace!.toolCalls[1] = { ...secondCall, status: 'success', durationMs: 300 }
      await emit('tool_call', { tool_call: { id: secondCall.id, name: secondCall.name, status: 'success', duration_ms: 300 } }, 800)
      await sendFollowup('Please check the conclusion too.', 900)
      const tail = page.locator('.feed-turn').filter({ has: page.getByText('Please check the conclusion too.', { exact: true }) })
      const review = { id: 'dddd', goal: TurnPhase.Review, kind: 'inference' as const,
        startedAt: startedAt + 1_000, durationMs: 0, outcome: 'started' as const,
        ...(withPlan ? { planStepId: step.id } : {}) }
      await emit('inference_activity', { activity: review }, 1_000)
      await expect(tail.getByRole('region', { name: 'Leon’s inference', exact: true }).locator('.process-group-title')).toHaveText('Reviewing...')
      await expect(tail.locator('.tool-call')).toHaveCount(0)
      const completedReview = { ...review, outcome: 'completed' as const, durationMs: 300 }
      saved.agentResponseTrace!.timings = [completedReview]
      await emit('inference_activity', { activity: completedReview }, 1_300)
      if (withPlan) {
        saved.agentResponseTrace!.planSteps = [{ ...step, status: 'completed' }]
        saved.agentResponseTrace!.planTransitions!.push({ ...step, status: 'completed', changedAt: startedAt + 1_400 })
        await emit('plan_step', { step: { ...step, status: 'completed' } }, 1_400)
      }
      saved.message = 'Both sources are checked.\nThe conclusion is ready.'
      saved.isAddedToHistory = true
      saved.sentAt = startedAt + 2_000
      saved.agentResponseTrace!.metrics = { durationMs: 2_000 }
      ui.sessions[0]!.status = 'idle' as SessionStatus
      await emit('final_answer', { content: saved.message, response_trace: saved.agentResponseTrace }, 2_000)
      await emit('session_changed', { is_running: false }, 2_001)
      for (const reload of [false, true]) {
        if (reload) {
          await page.reload()
        }
        await expect(page.getByRole('region', { name: 'Leon’s completed work', exact: true })).toHaveCount(1)
        await expect(tail.getByRole('button', { name: 'Worked for 2s', exact: true })).toBeVisible()
        await expect(tail.getByRole('region', { name: 'Leon’s final answer', exact: true })).toHaveText(saved.message)
        await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
        await openTools(root)
        await expect(root.locator('.tool-call-title')).toHaveText('Read first source')
        await openTools(middle)
        await expect(middle.locator('.tool-call-title')).toHaveText('Read second source')
        await expect(root.locator('.leon-message-work')).toHaveCount(0)
        await expect(middle.locator('.leon-message-work')).toHaveCount(0)
      }
      await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
      await expect(root.getByText(owner.message, { exact: true })).toBeVisible()
      await finishFiniteAnimations(page.locator('.feed'))
      const path = testInfo.outputPath('followup-order.png')
      await page.screenshot({ path })
      await testInfo.attach('followup-order', { path, contentType: 'image/png' })
    })
  }

  test(`connects groups within their scope and stops child links at the last tool (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const startedAt = Date.now() - 4_000
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    const first = { id: 'first', label: 'Gather the sources', status: 'completed' as const }
    const second = { id: 'second', label: 'Check the sources', status: 'completed' as const }
    answer.sentAt = startedAt + 4_000
    answer.agentResponseTrace = {
      id: answer.messageId, metrics: { durationMs: 4_000 },
      planSteps: [first, second],
      planTransitions: [{ ...first, status: 'in_progress', changedAt: startedAt },
        { ...first, changedAt: startedAt + 1_000 },
        { ...second, status: 'in_progress', changedAt: startedAt + 1_100 },
        { ...second, changedAt: startedAt + 3_000 }],
      toolCalls: [{ id: 'first-source', name: 'test.lookup.run', toolCallTitle: 'Read first source',
        status: 'success', startedAt: startedAt + 100, durationMs: 100, planStepId: first.id,
        input: { source: 'first' }, output: { sources: Array.from({ length: 40 }, (_, index) => `Source ${index}`) } },
      { id: 'second-source', name: 'test.lookup.run', toolCallTitle: 'Read second source',
        status: 'success', startedAt: startedAt + 300, durationMs: 100, planStepId: first.id }],
      reasoning: [{ id: 'compare-sources', text: '**Compare source details**\nKeep the conclusion grounded.\n\n**Check the conclusion**\nUse the observed result.',
        phase: 'agent', startedAt: startedAt + 600, planStepId: first.id }]
    }
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 4s', exact: true }).click()
    const plan = page.getByRole('region', { name: 'Leon’s execution plan', exact: true })
    await plan.getByRole('button', { name: 'Completed plan for 3s', exact: true }).click()
    await expect(plan.locator('.task-list-item')).toHaveCount(2)
    await plan.getByRole('button', { name: first.label, exact: true }).click()
    await plan.getByRole('button', { name: 'Used 2 tools for 200ms', exact: true }).click()
    const thought = plan.getByRole('region', { name: 'Leon’s thinking', exact: true })
    await thought.getByRole('button').locator('.process-group-title').click()
    await expect(thought.locator('.thinking-message-details p')).toHaveCount(2)
    await expect(thought.locator('strong')).toHaveText(['Compare source details', 'Check the conclusion'])
    await expect(thought.locator('.thinking-message-details p').first())
      .toHaveText('Compare source details\nKeep the conclusion grounded.')
    const tool = plan.locator('.tool-call').first()
    const initialTop = await tool.evaluate((element) => getComputedStyle(element, '::after').top)
    await tool.getByRole('button', { name: 'Read first source' }).click()
    await expect(tool.getByLabel('Tool output', { exact: true })).toBeVisible()
    await expect.poll(() => tool.locator('.activity-details').evaluate((element) =>
      element.getBoundingClientRect().height
    )).toBeGreaterThan(200)
    await plan.evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished))
    })
    const geometry = await plan.evaluate((element) => {
      const tools = element.querySelectorAll('.tool-call')
      const firstTool = tools[0]!
      const line = getComputedStyle(firstTool, '::after')
      const row = firstTool.getBoundingClientRect()
      const firstIcon = firstTool.querySelector('.tool-call-tool-icon')!.getBoundingClientRect()
      const nextIcon = tools[1]!.querySelector('.tool-call-tool-icon')!.getBoundingClientRect()
      const group = firstTool.closest('.leon-message-execution')!
      const groupBounds = group.getBoundingClientRect()
      const continuation = getComputedStyle(group, '::after')
      const nextActivity = group.nextElementSibling!.querySelector('.process-group-indicator')!.getBoundingClientRect()
      const step = element.querySelector('.task-list-item')!
      const stepBounds = step.getBoundingClientRect()
      const stepLink = getComputedStyle(step, '::after')
      const nextStep = step.nextElementSibling!.querySelector('.task-list-item-marker')!.getBoundingClientRect()
      return { top: line.top, width: line.width,
        startGap: row.top + Number.parseFloat(line.top) - firstIcon.bottom,
        endGap: nextIcon.top - (row.bottom - Number.parseFloat(line.bottom)),
        length: row.height - Number.parseFloat(line.top) - Number.parseFloat(line.bottom),
        entries: [
          [element.querySelector(':scope > .process-group-heading')!,
            element.querySelector(':scope > .process-group-heading .process-group-indicator')!,
            element.querySelector('.task-list-item-marker')!],
          [element.querySelector('.task-list-item-trigger')!,
            element.querySelector('.task-list-item-marker')!,
            element.querySelector('.task-list-item-tool-calls .process-group-indicator')!],
          [firstTool.closest('.process-group')!.querySelector('.process-group-heading')!,
            firstTool.closest('.process-group')!.querySelector('.process-group-indicator')!,
            firstTool.querySelector('.tool-call-tool-icon')!]
        ].map(([heading, marker, child]) => {
          const link = getComputedStyle(heading!, '::before')
          const bounds = heading!.getBoundingClientRect()
          const parent = marker!.getBoundingClientRect()
          const firstChild = child!.getBoundingClientRect()
          return { content: link.content,
            startGap: bounds.top + Number.parseFloat(link.top) - parent.bottom,
            endGap: firstChild.top - (bounds.top + Number.parseFloat(link.top) + Number.parseFloat(link.height)) }
        }),
        continuation: { content: continuation.content,
          boundaryGap: Number.parseFloat(continuation.top) - groupBounds.height,
          endGap: nextActivity.top - (groupBounds.bottom - Number.parseFloat(continuation.bottom)) },
        steps: Array.from(element.querySelectorAll('.task-list-item'))
          .map((step) => getComputedStyle(step, '::after').content),
        stepContinuation: {
          boundaryGap: Number.parseFloat(stepLink.top) - stepBounds.height,
          endGap: nextStep.top - (stepBounds.bottom - Number.parseFloat(stepLink.bottom))
        },
        last: getComputedStyle(tools[1]!, '::after').content }
    })
    expect(geometry.top).toBe(initialTop)
    expect(geometry.width).toBe('1px')
    expect(geometry.startGap).toBeCloseTo(4, 0)
    expect(geometry.endGap).toBeCloseTo(4, 0)
    expect(geometry.length).toBeGreaterThan(220)
    for (const entry of geometry.entries) {
      expect(entry.content).toBe('""')
      expect(entry.startGap).toBeCloseTo(4, 0)
      expect(entry.endGap).toBeCloseTo(4, 0)
    }
    expect(geometry.continuation.content).toBe('""')
    expect(geometry.continuation.boundaryGap).toBeCloseTo(4, 0)
    expect(geometry.continuation.endGap).toBeCloseTo(4, 0)
    expect(geometry.steps).toEqual(['""', 'none'])
    expect(geometry.stepContinuation.boundaryGap).toBeCloseTo(4, 0)
    expect(geometry.stepContinuation.endGap).toBeCloseTo(4, 0)
    expect(geometry.last).toBe('none')
    const path = testInfo.outputPath('expanded-tool-connector.png')
    await page.screenshot({ path })
    await testInfo.attach('expanded-tool-connector', { path, contentType: 'image/png' })
    await plan.getByRole('button', { name: 'Used 2 tools for 200ms', exact: true }).click()
    await expect(plan.locator('.tool-call')).toHaveCount(0)
    const collapsed = await plan.getByRole('region', { name: 'Leon’s tool usage', exact: true }).evaluate((element) => {
      const header = element.querySelector('.process-group-heading')!
      const group = element.parentElement!
      const line = getComputedStyle(group, '::after')
      const icon = element.querySelector('.process-group-indicator')!.getBoundingClientRect()
      return { entry: getComputedStyle(header, '::before').content, continuation: line.content,
        startGap: group.getBoundingClientRect().top + Number.parseFloat(line.top) - icon.bottom }
    })
    expect(collapsed.entry).toBe('none')
    expect(collapsed.continuation).toBe('""')
    expect(collapsed.startGap).toBeCloseTo(4, 0)
    await plan.getByRole('button', { name: first.label, exact: true }).click()
    await expect(thought).toHaveCount(0)
    // Nested content can unmount before the enclosing row finishes shrinking.
    await expect.poll(() => plan.locator('.task-list-item').first().evaluate((element) =>
      element.getBoundingClientRect().height - element.querySelector('.task-list-item-trigger')!.getBoundingClientRect().height
    )).toBeLessThanOrEqual(1)
    const collapsedStep = await plan.locator('.task-list-item').first().evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const line = getComputedStyle(element, '::after')
      const marker = element.querySelector('.task-list-item-marker')!.getBoundingClientRect()
      const next = element.nextElementSibling!.querySelector('.task-list-item-marker')!.getBoundingClientRect()
      return { content: line.content,
        startGap: bounds.top + Number.parseFloat(line.top) - marker.bottom,
        endGap: next.top - (bounds.bottom - Number.parseFloat(line.bottom)),
        last: getComputedStyle(element.nextElementSibling!, '::after').content }
    })
    expect(collapsedStep.content).toBe('""')
    expect(collapsedStep.startGap).toBeCloseTo(4, 0)
    expect(collapsedStep.endGap).toBeCloseTo(4, 0)
    expect(collapsedStep.last).toBe('none')
  })

  test(`binds activity to its starting step and appends plan continuations around unrelated progress (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const startedAt = Date.now()
    const responseId = 'plan-response'
    const owner: ConversationRecord = { who: 'owner', messageId: 'plan-owner', message: 'Work through these steps.',
      sentAt: startedAt, isAddedToHistory: true }
    let sequence = 0
    const emit = (type: string, data: Record<string, unknown>, offset: number): Promise<void> => ui.emit([{
      type, data, sequence: ++sequence, session_id: SESSION_ID,
      turn_id: owner.messageId, response_id: responseId, created_at: startedAt + offset
    }])
    const first = { id: 'first', label: 'Gather the sources', status: 'in_progress' }
    const second = { id: 'second', label: 'Check the sources', status: 'pending' }
    const request = { id: 'first-request', goal: TurnPhase.ToolRequest, startedAt: startedAt + 20,
      durationMs: 0, outcome: 'started', planStepId: first.id }
    const firstTool = { id: 'source', name: 'test.lookup.run', tool_call_title: 'Read the source', plan_step_id: first.id }
    const parallel = { ...firstTool, id: 'parallel', tool_call_title: 'Read another source' }
    await emit('owner_message', { message: owner }, 0)
    await emit('turn_status', { status: 'accepted' }, 1)
    await emit('plan_step', { step: first }, 10)
    await emit('plan_step', { step: second }, 10)
    await emit('inference_activity', { activity: request }, 20)
    await emit('text_stream', { kind: 'reasoning', generationId: 'first-thought', phase: 'agent',
      token: 'I will read the sources.', planStepId: first.id }, 30)
    const plans = page.getByRole('region', { name: 'Leon’s execution plan', exact: true })
    await expect(plans).toHaveCount(1)
    const original = await plans.first().elementHandle()
    await expect(plans.first().getByRole('button', { name: 'Thinking...', exact: true })).toBeVisible()
    await emit('tool_call', { tool_call: { ...firstTool, status: 'running', preparation_started_at: startedAt + 40,
      started_at: startedAt + 50 } }, 50)
    await emit('tool_call', { tool_call: { ...parallel, status: 'running', started_at: startedAt + 60 } }, 60)
    await emit('inference_activity', { activity: { ...request, outcome: 'completed', durationMs: 50 } }, 70)
    await expect(plans.first().getByRole('region', { name: 'Leon’s thinking', exact: true })).toBeVisible()
    await expect(plans.first().getByRole('region', { name: 'Leon’s inference', exact: true })).toContainText('Prepared tool calls in 50ms')
    await page.locator('.leon-message').last().evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished))
    })
    const geometry = await plans.first().evaluate((element) => {
      const icons = Array.from(element.querySelectorAll('.process-group-indicator, .task-list-item-marker, .tool-call-tool-icon'))
      const columns = icons.map((icon) => icon.getBoundingClientRect().left)
      const incoming = Array.from(element.querySelectorAll('.activity-timeline-parent > .process-group-heading:has(> [aria-expanded="true"]), .task-list-item-trigger[aria-expanded="true"]'))
        .map((heading) => getComputedStyle(heading, '::before').content)
      const stepLines = Array.from(element.querySelectorAll('.task-list-item'))
        .map((step) => getComputedStyle(step, '::after').content)
      const marker = element.querySelector('.task-list-item-in_progress .task-list-item-marker')!
      const dot = getComputedStyle(marker, '::before')
      return { spread: Math.max(...columns) - Math.min(...columns),
        incoming, stepLines, dot: { color: dot.backgroundColor, accent: getComputedStyle(marker).color,
          width: dot.width, animation: dot.animationName, duration: dot.animationDuration } }
    })
    expect(geometry.spread).toBeLessThanOrEqual(1)
    expect(geometry.incoming).toHaveLength(3)
    expect(geometry.incoming.every((content) => content === '""')).toBe(true)
    expect(geometry.stepLines.every((content) => content === 'none')).toBe(true)
    expect(geometry.dot.width).toBe('6px')
    expect(geometry.dot.color).toBe(geometry.dot.accent)
    expect(geometry.dot.animation).toBe(reducedMotion === 'reduce' ? 'none' : 'task-list-item-dot-pulse')
    if (reducedMotion === 'no-preference') {
      expect(geometry.dot.duration).toBe('3s')
    }
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await page.evaluate(async () => {
        await Promise.allSettled(document.getAnimations().filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished))
      })
      const prepared = plans.first().getByRole('region', { name: 'Leon’s inference', exact: true })
      expect(await prepared.locator('.process-group-title').evaluate((element) =>
        getComputedStyle(element).color === getComputedStyle(element.closest('.leon-message')!).color
      )).toBe(false)
      const screenshotPath = testInfo.outputPath(`running-plan-${theme}.png`)
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach(`running-plan-${theme}`, { path: screenshotPath, contentType: 'image/png' })
    }
    await emit('plan_step', { step: { ...first, status: 'completed' } }, 100)
    await emit('progress_message', { message: { id: 'unrelated', content: 'A separate update.',
      created_at: startedAt + 110, plan_step_id: null } }, 110)
    await emit('plan_step', { step: { ...second, status: 'in_progress' } }, 120)
    const next = { ...request, id: 'second-request', startedAt: startedAt + 130, planStepId: second.id }
    await emit('inference_activity', { activity: next }, 130)
    await emit('text_stream', { kind: 'reasoning', generationId: 'second-thought', phase: 'agent',
      token: 'I will check the result.', planStepId: second.id }, 140)
    const secondTool = { ...firstTool, id: 'verification', tool_call_title: 'Check the result', plan_step_id: second.id }
    await emit('tool_call', { tool_call: { ...secondTool, status: 'running', started_at: startedAt + 150 } }, 150)
    await expect(plans).toHaveCount(2)
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
    const response = page.locator('.leon-message').last()
    expect(await response.evaluate((element) => Array.from(element.children).map((child) => child.classList[0])))
      .toEqual(['leon-message-execution', 'leon-message-summary', 'leon-message-execution'])
    await emit('tool_call', { tool_call: { ...firstTool, status: 'success', duration_ms: 100 } }, 160)
    await emit('tool_call', { tool_call: { ...parallel, status: 'success', duration_ms: 80 } }, 170)
    await emit('inference_activity', { activity: { ...next, outcome: 'completed', durationMs: 50 } }, 180)
    await emit('tool_call', { tool_call: { ...secondTool, status: 'success', duration_ms: 40 } }, 190)
    await emit('plan_step', { step: { ...second, status: 'completed' } }, 200)
    const review = { ...request, id: 'review-request', goal: TurnPhase.Review,
      startedAt: startedAt + 210, planStepId: null }
    await emit('inference_activity', { activity: review }, 210)
    await expect(response.getByRole('region', { name: 'Leon’s inference', exact: true }).last().locator('.process-group-title')).toHaveText('Reviewing...')
    await emit('inference_activity', { activity: { ...review, outcome: 'completed', durationMs: 10 } }, 220)
    const saved: ConversationRecord = { who: 'leon', messageId: responseId, message: 'Checked and ready.',
      sentAt: startedAt + 230, isAddedToHistory: true, agentResponseTrace: {
        id: responseId, metrics: { durationMs: 230 },
        planSteps: [{ ...first, status: 'completed' }, { ...second, status: 'completed' }],
        planTransitions: [{ ...first, status: 'in_progress', changedAt: startedAt + 10 },
          { ...first, status: 'completed', changedAt: startedAt + 100 },
          { ...second, status: 'in_progress', changedAt: startedAt + 120 },
          { ...second, status: 'completed', changedAt: startedAt + 200 }],
        reasoning: [{ id: 'first-thought', phase: 'agent', startedAt: startedAt + 30,
          text: 'I will read the sources.', planStepId: first.id },
        { id: 'second-thought', phase: 'agent', startedAt: startedAt + 140,
          text: 'I will check the result.', planStepId: second.id }],
        progressMessages: [{ id: 'unrelated', content: 'A separate update.', createdAt: startedAt + 110, planStepId: null }],
        toolCalls: [{ id: firstTool.id, name: firstTool.name, toolCallTitle: firstTool.tool_call_title,
          status: 'success', preparationStartedAt: startedAt + 40, startedAt: startedAt + 50, durationMs: 100, planStepId: first.id },
        { id: parallel.id, name: parallel.name, toolCallTitle: parallel.tool_call_title,
          status: 'success', startedAt: startedAt + 60, durationMs: 80, planStepId: first.id },
        { id: secondTool.id, name: secondTool.name, toolCallTitle: secondTool.tool_call_title,
          status: 'success', startedAt: startedAt + 150, durationMs: 40, planStepId: second.id }],
        timings: [request, next, review].map((activity) => ({ ...activity,
          kind: 'inference', outcome: 'completed', durationMs: activity.id === review.id ? 10 : 50 }))
      } }
    ui.history.get(SESSION_ID)!.push(owner, saved)
    await emit('final_answer', { content: saved.message, response_trace: saved.agentResponseTrace }, 230)
    await emit('session_changed', { is_running: false }, 231)
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload()
      }
      await page.getByRole('button', { name: 'Worked for 230ms', exact: true }).click()
      await expect(plans).toHaveCount(2)
      for (const plan of await plans.all()) {
        await plan.getByRole('button', { name: 'Completed plan for 190ms', exact: true }).click()
        await plan.locator('.task-list-item-trigger').click()
      }
      await plans.first().getByRole('button', { name: 'Used 2 tools for 180ms', exact: true }).click()
      await plans.last().getByRole('button', { name: 'Used 1 tool for 40ms', exact: true }).click()
      await expect(plans.first().locator('.tool-call-title')).toHaveText(['Read the source', 'Read another source'])
      await expect(plans.last().getByRole('region', { name: 'Leon’s thinking', exact: true })).toBeVisible()
      await expect(plans.last().locator('.tool-call-title')).toHaveText(['Check the result'])
      await expect(response.locator('.leon-message-summary .streaming-text-characters')).toHaveText('A separate update.')
      await expect(response.getByRole('region', { name: 'Leon’s processing', exact: true })).toContainText('Processed for 10ms')
    }
    await original?.dispose()
  })

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
    const row = group.locator('.tool-call').filter({ has: page.getByText('Check tomorrow’s weather', { exact: true }) })
    await expect(row).toHaveCount(1)
    await expect(row.locator('.tool-call-title')).toHaveText('Check tomorrow’s weather')
    await expect(row.locator('.activity-wave-active')).toHaveCount(1)
    await expect(row.locator('.tool-call-duration, .tool-call-error-indicator')).toHaveCount(0)
    expect(await originalGroup!.evaluate((element) => element.isConnected)).toBe(true)
    const originalRow = await row.elementHandle()
    await emit('tool_call', { tool_call: { ...tool, status: 'running' } })
    await expect(row.locator('.tool-call-title')).toHaveText('Check tomorrow’s weather')
    await expect(row.locator('.activity-wave-active')).toHaveCount(1)
    await expect(row.locator('.tool-call-duration, .tool-call-error-indicator')).toHaveCount(0)
    expect(await originalRow!.evaluate((element) => element.isConnected)).toBe(true)

    // A call that executes without a title still needs a readable, inspectable row.
    await emit('tool_call', { tool_call: {
      id: 'untitled-execution', name: tool.name, status: 'running'
    } })
    await expect(group.locator('.tool-call-title')).toHaveText(['Check tomorrow’s weather', 'Get Weather'])
    await expect(group.getByText(tool.name, { exact: true })).toHaveCount(0)

    await emit('tool_call', { tool_call: {
      id: 'untitled-execution', name: tool.name, status: 'error', duration_ms: 435,
      error_message: 'The weather service did not respond.'
    } })
    const failed = group.locator('.tool-call-error')
    await expect(failed.locator('.tool-call-error-indicator[data-icon="close"]')).toBeVisible()
    await expect(failed.locator('.tool-call-trigger')).toHaveAccessibleDescription('Tool call failed')
    await expect(failed.locator('.tool-call-duration')).toHaveText('435ms')
    await expect(failed.locator('.activity-wave-active')).toHaveCount(0)
    await expect(group.getByText('Failed', { exact: true })).toHaveCount(0)

    await emit('tool_call', { tool_call: { ...tool, status: 'success', duration_ms: 618 } })
    const completedGroup = group.locator(':scope > .process-group-heading > button')
    await expect(completedGroup).toHaveAttribute('aria-expanded', 'false')
    await completedGroup.click()
    await expect(row.locator('.tool-call-duration')).toHaveText('618ms')
    await expect(row.locator('.activity-wave-active, .tool-call-error-indicator')).toHaveCount(0)

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
    await expect(review.locator('[data-icon="search-eye"]')).toBeVisible()
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
    await expect(waiting).toBeVisible()
    await expect(waiting.locator('.process-group-indicator, svg')).toHaveCount(0)
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
    await expect(waiting).toBeVisible()
    await expect(inference).toHaveCount(0)
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
      if (reducedMotion === 'no-preference') {
        await expect(first).toHaveClass('streaming-text-character-new')
        await expect(first).toHaveCSS('animation-duration', '0.42s')
        await expect.poll(() => first.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).not.toBeNull()
        const startedAt = await first.evaluate((element) => element.getAnimations()[0]!.startTime)
        await append()
        await expect(first).toHaveClass('streaming-text-character-new')
        await expect.poll(() => first.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).toBe(startedAt)
      } else {
        await expect(target.locator('.streaming-text-character-new')).toHaveCount(0)
        await append()
        await expect(target.locator('.streaming-text-character-new')).toHaveCount(0)
      }
    }

    await emit('owner_message', { message: { who: 'owner', messageId: 'live-owner', message: 'Stream this reply.', sentAt: createdAt, isAddedToHistory: true } })
    await emit('turn_status', { status: 'accepted' })
    await emit('text_stream', { kind: 'answer', generationId: 'waiting-answer', token: '', reset: true })
    const working = page.getByRole('region', { name: 'Leon’s work', exact: true })
    await expect(working).toHaveText('Helping with this...')
    await expect(working.locator('.process-group-indicator, i, svg')).toHaveCount(0)
    await emit('metrics', { metrics: { durationMs: 100 } })
    await expect(working).toHaveText('Helping with this...')
    await expect(page.getByText('Thinking...', { exact: true })).toHaveCount(0)
    await emit('text_stream', { kind: 'reasoning', generationId: 'live-thinking', token: 'Checking ' })
    const thinking = page.getByRole('region', { name: 'Leon’s thinking' }).last()
    await expect(thinking).toContainText('Thinking...')
    await checkAppend(thinking, async () => {
      await emit('text_stream', { kind: 'reasoning', generationId: 'live-thinking', token: 'the details.' })
      await expect(thinking.locator('.thinking-message-details .streaming-text-characters')).toHaveText('Checking the details.')
    })
    await emit('text_stream', { kind: 'reasoning', generationId: 'live-thinking', token: '\n\n' })
    await emit('text_stream', { kind: 'reasoning', generationId: 'live-thinking',
      token: '**Checking the source**\nKeep the useful details.\n\n**Preparing the reply**\nKeep it clear.' })
    await expect(thinking.locator('.thinking-message-details p')).toHaveCount(3)
    await expect(thinking.locator('strong')).toHaveText(['Checking the source', 'Preparing the reply'])
    await expect(thinking.locator('.thinking-message-details p').last()).toHaveText('Preparing the reply\nKeep it clear.')
    await emit('text_stream', { kind: 'answer', generationId: 'provisional-answer', token: 'I will look this up.' })
    await expect(page.getByText('Thinking...', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Leon’s final answer' }).last()).toContainText('I will look this up.')
    await emit('progress_message', { message: { id: 'live-progress', content: 'Looking ', created_at: createdAt + sequence } })
    const progress = page.locator('.leon-message-summary').last()
    await checkAppend(progress, async () => {
      await emit('progress_message', { message: { id: 'live-progress', content: 'Looking closer.', created_at: createdAt + sequence } })
      await expect(progress.locator('.streaming-text-characters')).toHaveText('Looking closer.')
    })
    await emit('text_stream', { kind: 'answer', generationId: 'live-answer', token: 'Hello ' })
    const answer = page.getByRole('region', { name: 'Leon’s final answer' }).last()
    const finalText = `Hello ${'world. '.repeat(32)}`
    await checkAppend(answer, async () => {
      // Bursts larger than the usual character window must retain in-flight fades.
      await emit('text_stream', { kind: 'answer', generationId: 'live-answer', token: finalText.slice('Hello '.length) })
      await expect(answer.locator('.streaming-text-characters')).toHaveText(finalText.trimEnd())
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
    if (reducedMotion === 'no-preference') {
      await expect(answer.locator('.streaming-text-character-new')).not.toHaveCount(0)
    } else {
      await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
    }
    await page.reload()
    await expect(answer).toContainText(finalText.trim())
    await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
  })
}

test('settles hidden and reduced-motion arrivals while preserving selected text', async ({ page, ui }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(SESSION_URL)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  let sequence = 0
  const emit = (type: string, data: Record<string, unknown>): Promise<void> => ui.emit([{
    type, data, sequence: ++sequence, session_id: SESSION_ID,
    turn_id: 'motion-turn', response_id: 'motion-response', created_at: Date.now()
  }])
  const setHidden = (hidden: boolean): Promise<void> => page.evaluate((value) => {
    // Simulate tab visibility without opening a desktop window or changing OS preferences.
    if (value) {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    } else {
      Reflect.deleteProperty(document, 'hidden')
      Reflect.deleteProperty(document, 'visibilityState')
    }
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)

  await emit('turn_status', { status: 'accepted' })
  await emit('text_stream', { kind: 'answer', generationId: 'motion-answer', token: 'Selected text' })
  const answer = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  const characters = answer.locator('.streaming-text-character-new')
  await expect(characters).not.toHaveCount(0)
  await answer.locator('.streaming-text-characters').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
  })
  const selectedCharacters = await characters.count()
  await setHidden(true)
  await emit('text_stream', { kind: 'answer', generationId: 'motion-answer', token: ' received in background.' })
  await expect(answer).toContainText('Selected text received in background.')
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('Selected text')
  await expect(characters).toHaveCount(selectedCharacters)

  await page.evaluate(() => window.getSelection()!.removeAllRanges())
  await emit('text_stream', { kind: 'answer', generationId: 'motion-answer', token: ' More background text.' })
  await expect(answer).toContainText('More background text.')
  await expect(characters).toHaveCount(0)
  await setHidden(false)
  await expect(characters).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await emit('text_stream', { kind: 'answer', generationId: 'motion-answer', token: ' Reduced motion.' })
  await expect(answer).toContainText('Reduced motion.')
  await expect(characters).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(characters).toHaveCount(0)
  // Browser media-query change events settle at the next rendering opportunity.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  const visibleToken = ' New visible text.'
  await emit('text_stream', { kind: 'answer', generationId: 'motion-answer', token: visibleToken })
  await expect.poll(() => characters.allTextContents()).toEqual(Array.from(visibleToken))
})

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
      await page.route(`**${detailsPath}/tools/${tool.id}*`, async (route) => {
        detailsRequests++
        if (detailsRequests > 1) {
          await refresh.promise
        }
        if (!route.request().failure()) {
          await route.fulfill({ json: toolContentsFixture(record.agentResponseTrace!.toolCalls[0]!) })
        }
      })

      try {
        await page.goto(SESSION_URL)
        await page.getByRole('button', { name: tool.toolCallTitle, exact: true }).click()
        const panel = page.locator('.activity-details')
        await expect(panel.getByRole('status')).toHaveCount(0)
        await expect(panel.getByLabel('Tool output', { exact: true })).toContainText('Initial output')
        await page.evaluate(() => document.fonts.ready)
        await finishFiniteAnimations(page.locator('.feed'))
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
          await expect(panel.getByLabel('Tool output', { exact: true })).toContainText(output)
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
              const panel = document.querySelector<HTMLElement>('.activity-details')!
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
          new URL(response.url()).pathname.startsWith(`${detailsPath}/tools/`) && response.ok()
        )
        refresh.resolve()
        await refreshed
        await expect(panel.getByLabel('Tool output', { exact: true })).toContainText('Live output 11')
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
  await emit('inference_activity', { activity: {
    id: 'ddd', goal: TurnPhase.Request, startedAt, durationMs: 0, outcome: 'started'
  } })
  const initialWorkingLabel = await page.getByRole('region', { name: 'Leon’s work', exact: true })
    .locator('.process-group-title').innerText()
  const phases = [
    [TurnPhase.Request, initialWorkingLabel, undefined],
    [TurnPhase.Request, initialWorkingLabel, undefined],
    ['unclassified-purpose', initialWorkingLabel, undefined],
    [TurnPhase.ToolSchemas, 'Loading tools...', 'stack-line'],
    [TurnPhase.Tools, 'Choosing tools...', 'wrench-line'],
    [TurnPhase.ToolRequest, 'Preparing tool calls...', 'wrench-line'],
    [TurnPhase.Skill, 'Loading skills...', 'book-open-line'],
    [TurnPhase.Plan, 'Updating the plan...', 'list-check-3'],
    [TurnPhase.Clarification, 'Preparing a question...', 'question-mark'],
    [TurnPhase.Cancellation, 'Preparing to stop...', 'close-circle-line'],
    [TurnPhase.Connection, 'Preparing connection setup...', 'plug-line'],
    [TurnPhase.VisualSetup, 'Preparing visual guidance...', 'layout-4-line'],
    [TurnPhase.Visual, 'Creating a visual...', 'layout-4-line'],
    [TurnPhase.VisualPresentation, 'Preparing visual presentation...', 'layout-4-line'],
    [TurnPhase.Answer, 'Generating an answer...', 'pencil-ai-line'],
    [TurnPhase.Inspection, 'Inspecting images...', 'eye-2-line'],
    [TurnPhase.Compaction, 'Compacting context...', 'file-reduce-line'],
    [TurnPhase.Review, 'Reviewing...', 'search-eye-line']
  ] as const
  const timings = phases.map(([goal], index) => ({
    id: 'd'.repeat((index + 1) * 3), goal, startedAt: startedAt + index * 200,
    durationMs: 100, outcome: 'completed'
  }))
  const request = page.getByRole('region', { name: 'Leon’s inference', exact: true })
  const processing = page.getByRole('region', { name: 'Leon’s processing', exact: true })
  let originalRow: ElementHandle | null = null

  for (const [index, [goal, label, icon]] of phases.entries()) {
    const activity = { ...timings[index]!, goal, durationMs: 0, outcome: 'started' }
    await emit('inference_activity', { activity })
    await expect(processing).toHaveCount(0)
    const live = icon ? request : page.getByRole('region', { name: 'Leon’s work', exact: true })
    await expect(live).toHaveCount(1)
    await expect(live.getByRole('button')).toHaveCount(0)
    await expect(live.locator('.process-group-title')).toHaveText(label)
    if (icon) {
      await expect(live.locator(`[data-icon="${resolveIconName(icon)}"]`)).toBeVisible()
    } else {
      await expect(live.locator('.process-group-indicator, svg')).toHaveCount(0)
    }
    await expect(live.locator('.activity-wave')).toHaveClass(/activity-wave-active/)
    originalRow ??= await live.elementHandle()
    expect(await originalRow!.evaluate((element) => element.isConnected)).toBe(true)

    const previous = timings[index - 1]
    if (previous) {
      // A delayed completion must not replace the newer running phase.
      await emit('inference_activity', { activity: previous })
      await expect(live).toHaveCount(1)
      await expect(live.locator('.process-group-title')).toHaveText(label)
    }

    const position = await live.boundingBox()
    const scrollTop = await page.locator('.app-main').evaluate((element) => element.scrollTop)
    await emit('inference_activity', { activity: timings[index]! })
    const waiting = page.getByRole('region', { name: 'Leon’s work', exact: true })
    await expect(waiting).toBeVisible()
    await expect(waiting.locator('.process-group-title')).toHaveText(initialWorkingLabel)
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
  await processing.getByRole('button', { name: /^Processed for / }).click()
  await expect(processing.getByRole('region', { name: 'Leon’s inference', exact: true })).toHaveCount(phases.length)
  await expect(processing.getByText('Prepared tool calls in 100ms', { exact: true })).toBeVisible()
  await expect(processing.getByText('Reviewed for 100ms', { exact: true })).toBeVisible()
  await expect(processing.locator('.activity-wave-active')).toHaveCount(0)
})
