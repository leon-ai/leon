import { test, expect, SESSION_URL } from './fixtures'
import type { ToolCatalogEntry } from '../../../server/src/core/tool-manager/tool-source'
import type { EvaluationRun, EvaluationQuery } from '../../../server/src/core/insights/insights-contract'
import { projectEvaluationHistory } from '../../../server/src/core/insights/evaluation-view'
import { SETTINGS_SECTIONS } from '../../../apps/web/src/data/settings-sections'
import { CONNECTION_PREVIEWS, connectionPreviewView } from '../../fixtures/connections'
import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step } from '../../../aurora/src/contracts/connection-setup'
import { renderOAuthCompletion } from '../../../server/src/core/connections/oauth-completion'
import { CatalogMaintenance, CatalogDistribution } from '../../../server/src/schemas/catalog-metadata-schemas'

const notion: ToolCatalogEntry = { id: 'productivity_collaboration.notion', catalogId: 'productivity_collaboration.notion',
  name: 'Notion', description: 'Work with Notion pages through its official MCP server.', iconName: 'plug-line',
  kind: 'mcp', installed: false, enabled: false, connected: false, canConnect: true }

test('restores menu trigger focus without reopening its tooltip', async ({ page, ui }) => {
  void ui
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/v1/tools/catalog', (route) => route.fulfill({ json: {
    tools: [{ ...notion, installed: true, enabled: true }]
  } }))
  await page.goto('settings/tools')
  const trigger = page.getByRole('button', { name: 'Tool options', exact: true })
  const menu = page.getByRole('menu', { name: 'Notion options', exact: true })
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Tool options' })

  await trigger.hover()
  await expect(tooltip).toBeVisible()
  await trigger.click()
  await expect(menu).toBeVisible()
  await menu.hover()
  await trigger.hover()
  await expect(tooltip).toHaveCount(0)
  await menu.hover()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(tooltip).toHaveCount(0)

  await trigger.hover()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Disable', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(tooltip).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(trigger).toBeFocused()
  await expect(tooltip).toBeVisible()
})

test('keeps catalog navigation virtualized and applies only accepted management changes', async ({ page, ui }) => {
  void ui
  const entries = [{ ...notion }, ...Array.from({ length: 180 }, (_, index): ToolCatalogEntry => ({
    id: `native.tool-${index}`, name: `Workspace tool ${index}`, description: 'A native workspace tool.',
    iconName: 'tools-line', kind: 'native', installed: true, enabled: true, connected: false, canConnect: false
  }))]
  const changes: string[] = []
  let fail = false
  await page.route('**/api/v1/tools**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/catalog')) {
      await route.fulfill({ json: { tools: entries } })
      return
    }
    if (fail) {
      fail = false
      await route.fulfill({ status: 503, json: { message: 'Please try again.' } })
      return
    }
    const body = route.request().postDataJSON()
    if (url.pathname.endsWith('/tools')) {
      expect(body).toEqual({ catalogId: notion.id })
      entries[0] = { ...entries[0]!, installed: true, enabled: true }
      await route.fulfill({ status: 201, json: { id: notion.id } })
      return
    }
    changes.push(body.action)
    if (body.action === 'remove') {
      entries[0] = { ...notion }
    } else {
      entries[0] = { ...entries[0]!, enabled: body.action === 'enable' }
    }
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('settings/tools')
  await expect(page.getByRole('heading', { name: 'Tool catalog', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Notion' })).toBeVisible()
  expect(await page.getByRole('listitem').count()).toBeLessThan(30)
  expect(await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('link').count()).toBe(SETTINGS_SECTIONS.length)
  const row = page.getByRole('listitem', { name: 'Notion', exact: true })
  await row.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(page.getByText('Tool added', { exact: true })).toBeVisible()
  fail = true
  await row.getByRole('button', { name: 'Tool options' }).click()
  await page.getByRole('menuitem', { name: 'Disable', exact: true }).click()
  await expect(page.locator('.toast-error')).toHaveCount(1)
  await expect(row.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
  expect(changes).toEqual([])
  await row.getByRole('button', { name: 'Tool options' }).click()
  await page.getByRole('menuitem', { name: 'Disable', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
  await row.getByRole('button', { name: 'Tool options' }).click()
  await page.getByRole('menuitem', { name: 'Remove server', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remove server?' }).getByRole('button', { name: 'Remove server', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
  expect(changes).toEqual(['disable', 'remove'])
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('Workspace tool 179')
  await expect(page.getByRole('listitem', { name: 'Workspace tool 179', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'General', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sounds', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('starts trusted OAuth from settings without requiring a chat session', async ({ page, context, ui }) => {
  void ui
  let connected = false
  let callback = ''
  const preview = CONNECTION_PREVIEWS['connection-notion']!
  const logoUrl = `tools/${notion.id}/assets/logo.svg`
  await page.route('**/assets/logo.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml', path: 'tools/productivity_collaboration/notion/logo.svg'
  }))
  await page.route('**/api/v1/tools/catalog', (route) => route.fulfill({ json: {
    tools: [{ ...notion, logoUrl, installed: true, enabled: true, connected, connectionMethod: 'oauth' }]
  } }))
  await page.route(`**/api/v1/connections/${notion.id}/setup`, async (route) => {
    const body = route.request().postDataJSON()
    expect(body.session_id).toBe('')
    if (body.action === Action.Connect) {
      const destination = new URL(body.return_url)
      destination.searchParams.set('provider', notion.id)
      destination.searchParams.set('connection_result', 'connected')
      callback = destination.toString()
    }
    const view = connectionPreviewView(preview, 'oauth', connected ? Step.Connected : Step.Choice, true)
    view.actions = connected ? [] : [{ id: Action.Connect, label: 'Connect Notion' }]
    await route.fulfill({ json: { view, ...(body.action === Action.Connect ? {
      authorization_url: `${new URL(callback).origin}/settings-oauth-fixture`
    } : {}) } })
  })
  await context.route('**/settings-oauth-fixture', (route) => route.fulfill({ contentType: 'text/html',
    body: `<a href="${callback}">Authorize fixture account</a>` }))
  await context.route('**/api/v1/connections/complete?**', async (route) => {
    connected = true
    const completion = renderOAuthCompletion(Object.fromEntries(new URL(route.request().url()).searchParams))!
    await route.fulfill({ contentType: 'text/html', body: completion.html,
      headers: { 'Content-Security-Policy': completion.contentSecurityPolicy } })
  })
  await page.goto('settings/tools')
  await expect(page.getByRole('listitem', { name: 'Notion', exact: true }).locator('img.package-icon'))
    .toHaveAttribute('src', `/api/v1/${logoUrl}`)
  const [popup] = await Promise.all([page.waitForEvent('popup'),
    page.getByRole('listitem', { name: 'Notion', exact: true }).getByRole('button', { name: 'Connect', exact: true }).click()])
  const dialog = page.getByRole('dialog', { name: 'Connection setup', exact: true })
  await expect(dialog.locator('img.package-icon')).toHaveAttribute('src', `/api/v1/${logoUrl}`)
  await popup.getByRole('link', { name: 'Authorize fixture account' }).click()
  await expect(dialog.getByRole('status')).toContainText('Connected')
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings\/tools$/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listitem', { name: 'Notion', exact: true }).getByRole('button', { name: 'Manage' })).toBeVisible()
})

test('opens catalog documents on demand and shares contacts and availability controls with skills', async ({ page, ui }) => {
  void ui
  const entry = { ...notion, author: { name: 'Original creator', github: 'creator' },
    maintainers: [
      { name: 'Current maintainer', github: 'maintainer', discord: { id: '123456789012345678', username: 'friendly-maker' } },
      { name: 'Another maintainer', discord: { username: 'studio-maker' } }
    ],
    maintenance: CatalogMaintenance.Community, distribution: CatalogDistribution.Extension,
    documents: { readme: true, changelog: true } }
  const reads: string[] = []
  await page.route('**/api/v1/tools/catalog', (route) => route.fulfill({ json: { tools: [entry] } }))
  await page.route('**/documents/*', (route) => {
    const document = route.request().url().split('/').at(-1)!
    reads.push(document)

    return route.fulfill({ json: { text: document === 'readme'
      ? '# A useful workspace\n\nAsk me to find your notes.\n\n![Workspace preview](/api/v1/tools/productivity_collaboration.notion/assets/media/screen.svg)'
      : '# Release notes\n\nA clearer connection flow.' } })
  })
  await page.route('**/assets/media/screen.svg', (route) => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="gray"/></svg>' }))
  let enabled = true
  await page.route('**/api/v1/skills**', (route) => {
    if (route.request().method() === 'POST') {
      enabled = route.request().postDataJSON().action === 'enable'

      return route.fulfill({ json: { success: true } })
    }

    return route.fulfill({ json: { skills: [{ ...entry, id: 'coding', name: 'Coding', kind: 'agent', version: '1.0.0',
      installed: true, enabled, owned: false }] } })
  })
  await page.goto('settings/tools')
  const row = page.getByRole('listitem', { name: 'Notion', exact: true })
  await expect(row).toBeVisible()
  expect(reads).toEqual([])
  await row.getByRole('button', { name: 'Notion', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Notion', exact: true })
  await expect(details.getByRole('heading', { name: 'A useful workspace' })).toBeVisible()
  await expect(details.getByRole('img', { name: 'Workspace preview' })).toBeVisible()
  expect(reads).toEqual(['readme'])
  await details.getByRole('button', { name: 'Changelog', exact: true }).click()
  await expect(details.getByRole('heading', { name: 'Release notes' })).toBeVisible()
  await details.getByRole('button', { name: 'People', exact: true }).click()
  await expect(details.getByRole('link', { name: 'friendly-maker', exact: true })).toHaveAttribute('href', 'https://discord.com/users/123456789012345678')
  await expect(details.getByRole('link', { name: 'maintainer', exact: true })).toHaveAttribute('href', 'https://github.com/maintainer')
  await expect(details.getByText('studio-maker', { exact: true })).toBeVisible()
  await expect(details.getByRole('link', { name: 'studio-maker', exact: true })).toHaveCount(0)
  await expect(details.getByRole('button', { name: 'Copy Discord username', exact: true })).toBeVisible()
  await expect(details.getByText('Original creator', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Skills', exact: true }).click()
  const skill = page.getByRole('listitem', { name: 'Coding', exact: true })
  await expect(skill).toBeVisible()
  await skill.getByRole('button', { name: 'Skill options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Disable', exact: true }).click()
  await expect(skill.getByText('Disabled · 1.0.0', { exact: true })).toBeVisible()
  await expect(page.getByText('Skill disabled', { exact: true })).toBeVisible()
})

for (const theme of ['light', 'dark']) {
  test(`keeps catalog logos and custom server setup readable on narrow screens in ${theme} theme`, async ({ page, ui }) => {
    void ui
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript((value) => localStorage.setItem('leon.web-app.theme', value), theme)
    const inputs: unknown[] = []
    const entries = [
      ['productivity_collaboration.notion', 'Notion', 'notion-line'],
      ['music_audio.spotify', 'Spotify', 'spotify-line'],
      ['communication.gmail', 'Gmail', 'mail-line'],
      ['productivity_collaboration.ticktick', 'TickTick', 'checkbox-circle-line']
    ].map(([id, name, iconName]) => ({ ...notion, id: id!, catalogId: id!, name: name!, iconName: iconName!,
      logoUrl: `tools/${id}/assets/logo.svg` }))
    await page.route('**/api/v1/tools**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { tools: entries } })
      } else {
        inputs.push(route.request().postDataJSON())
        await route.fulfill({ status: 201, json: { id: 'mcp.custom' } })
      }
    })
    await page.route('**/api/v1/tools/*/assets/logo.svg', (route) => {
      const id = new URL(route.request().url()).pathname.split('/')[4]!

      return route.fulfill({ contentType: 'image/svg+xml', path: `tools/${id.replace('.', '/')}/logo.svg` })
    })
    await page.goto('settings/tools')
    await expect(page.getByRole('listitem', { name: 'Notion', exact: true })).toBeVisible()
    for (const entry of entries) {
      const image = page.getByRole('listitem', { name: entry.name, exact: true }).locator('img.package-icon')
      await expect(image).toHaveAttribute('src', `/api/v1/${entry.logoUrl}`)
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/leon-settings-${theme}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Add MCP server', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add MCP server', exact: true })
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('My workspace')
    await dialog.getByRole('textbox', { name: 'Server URL', exact: true }).fill('https://example.com/mcp')
    await dialog.getByRole('button', { name: 'Add server', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(inputs).toEqual([{ name: 'My workspace', url: 'https://example.com/mcp' }])
  })
}

test('compares measured turns and controlled evaluations while sharing is off', async ({ page, ui }) => {
  const day = Date.UTC(2030, 1, 1)
  const summary = {
    turns: 2, finishedTurns: 1, tokenMeasuredTurns: 1, measuredTurnTokens: 15_000,
    fullyMeasuredTurns: 2, fullyMeasuredTokens: 35_000, medianTurnTokens: 17_500, p95TurnTokens: 20_000,
    modelCalls: 3, meteredCalls: 3, tokenReportedCalls: 3, failedModelCalls: 0,
    inputTokens: 30_000, outputTokens: 5_000, cachedInputTokens: 15_000, cacheReportedCalls: 3,
    cacheComparableCalls: 3, cacheComparableInputTokens: 30_000, cacheComparableCachedTokens: 15_000,
    toolCalls: 1, durationMs: 3_000, failedTurns: 0, canceledTurns: 0, clarificationTurns: 1,
    medianAnswerMs: 1_500, p95AnswerMs: 1_500, toolDurationMs: 500, modelDurationMs: 1_500,
    firstOutputMs: 1_000, firstOutputCount: 1, contextPercent: 4, contextCount: 1,
    medianContextPercent: 4, p95ContextPercent: 4
  }
  const model = { provider: 'openai', model: 'example-model' }
  const turn = {
    ...summary, ...model, modelCalls: 1, meteredCalls: 1, tokenReportedCalls: 1,
    inputTokens: 14_000, outputTokens: 1_000, startedAt: day, version: '2.0.0-alpha.0.10',
    outcome: 'answered',
    context: { contextUsagePercent: 40, contextUsedTokens: 14_000, contextWindowTokens: 35_000,
      contextUsageEstimated: false, contextTarget: model,
      contextTokenBreakdown: { transcript: 5_000, system: 5_000, tools: 3_000, images: 1_000, compaction: 0 } }
  }
  const ownerQuery = 'What’s the weather like in Shenzhen?'
  const repeated = { message: ownerQuery, occurrences: 2, turns: [
    { ...turn, startedAt: day + 3_600_000, inputTokens: 19_000 }, turn
  ] }
  let sharing = false
  await page.route('**/api/v1/insights?**', async (route) => {
    expect(route.request().headers()['x-leon-insights-profile']).toBe(ui.profile)
    const url = new URL(route.request().url())
    await route.fulfill({ json: {
      firstOwnerMessageAt: day, unreadableRecords: 1,
      current: summary, previous: summary, series: [
        { day: day - 86_400_000, ...summary, previous: summary },
        { day, ...summary, previous: summary, fullyMeasuredTokens: 29_000 }
      ], recentTurns: [turn],
      models: [{ ...summary, ...model }], contextModels: [model], contextPage: 0, contextPages: 1,
      repeatedQueries: url.searchParams.has('repeated') ? [repeated] : []
    } })
  })
  await page.route('**/api/v1/insights/telemetry', async (route) => {
    if (route.request().method() === 'PUT') {
      expect(route.request().headers()['x-leon-insights-profile']).toBe(ui.profile)
      sharing = Boolean(route.request().postDataJSON().enabled)
    }
    await route.fulfill({ json: { enabled: sharing } })
  })
  const requestedEvaluations: EvaluationQuery[] = []
  const measured = {
    inputTokens: 2_000, cachedInputTokens: 800, uncachedInputTokens: 1_200, peakInputTokens: 1_400,
    outputTokens: 300, modelCalls: 2, failedCalls: 0, foregroundInputTokens: 1_900,
    maintenanceInputTokens: 100, turnLatencyMs: 1_500
  }
  const evaluation: EvaluationRun = {
    id: 'test-eval', recordedAt: day, sha: 'abcdef123456', model: 'deepseek/deepseek-flash',
    reasoning: 'high', suiteRevision: 'a'.repeat(64), cases: [
      { scenario: 'selected-lookup', status: 'Passed', baseline: measured, measured, samples: 1 },
      ...Array.from({ length: 5 }, (_, index) => ({
        scenario: `fixture-${index + 1}`, status: 'Warning' as const, baseline: measured, measured, samples: 1
      }))
    ]
  }
  const archived: EvaluationRun = { ...evaluation, id: 'archived-eval', sha: '1234abcdef56', source: 'development',
    committedAt: Date.UTC(2030, 0, 29, 12) }
  const releaseRun: EvaluationRun = { ...evaluation, id: 'release-eval', sha: 'fedcba654321', source: 'release',
    committedAt: Date.UTC(2030, 0, 30, 12), suiteRevision: 'b'.repeat(64) }
  await page.route('**/api/v1/insights/evaluations**', async (route) => {
    expect(route.request().headers()['x-leon-insights-profile']).toBe(ui.profile)
    expect(route.request().method()).toBe('GET')
    const query = new URL(route.request().url()).searchParams
    const filters: EvaluationQuery = {
      source: query.get('source') === 'development' ? 'development' : undefined,
      scenario: query.get('scenario') ?? undefined
    }
    requestedEvaluations.push(filters)
    await route.fulfill({ json: projectEvaluationHistory([releaseRun, evaluation, archived], filters) })
  })

  await page.addInitScript(() => {
    localStorage.setItem('leon.web-app.theme', 'dark')
    const gradient = CanvasRenderingContext2D.prototype.createLinearGradient
    CanvasRenderingContext2D.prototype.createLinearGradient = function (...points): CanvasGradient {
      if (this.canvas.closest('.insights-chart-canvas')) {
        this.canvas.dataset['areaGradient'] = 'true'
      }
      return gradient.apply(this, points)
    }
  })
  await page.goto('')
  await page.getByRole('link', { name: 'Insights', exact: true }).click()
  const insights = page.getByRole('dialog', { name: 'Insights', exact: true })
  await expect(insights).toBeVisible()
  expect((await insights.boundingBox())!.width).toBeGreaterThan(772)
  expect(requestedEvaluations).toHaveLength(0)
  await expect(page.getByText('I first met you on', { exact: false })).toBeVisible()
  await expect(page.getByText('Some saved activity could not be read.', { exact: false })).toBeVisible()
  const tokensPerTurn = page.getByRole('figure', { name: 'Tokens per turn', exact: true })
  const reportedTokens = page.getByRole('figure', { name: 'Reported tokens', exact: true })
  const turnOutcomes = page.getByRole('figure', { name: 'Agent turn outcomes', exact: true })
  await expect(tokensPerTurn.locator('canvas')).toHaveAttribute('data-area-gradient', 'true')
  await expect(reportedTokens.locator('canvas')).toBeVisible()
  await expect(turnOutcomes.locator('canvas')).toBeVisible()
  const [firstChart, secondChart, thirdChart] = await Promise.all([
    tokensPerTurn.boundingBox(), reportedTokens.boundingBox(), turnOutcomes.boundingBox()
  ])
  expect(secondChart!.x).toBeGreaterThan(firstChart!.x)
  expect(secondChart!.y).toBeCloseTo(firstChart!.y)
  expect(thirdChart!.x).toBeCloseTo(firstChart!.x)
  expect(thirdChart!.y).toBeGreaterThan(firstChart!.y)
  await expect(page.getByRole('figure', { name: 'Answer latency', exact: true }).locator('canvas')).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Prompt cache share', exact: true }).locator('canvas')).toBeVisible()
  const providerChart = page.getByRole('figure', { name: 'Usage by provider', exact: true })
  await expect(providerChart.locator('canvas')).toBeVisible()
  await providerChart.getByText('View data').click()
  await expect(providerChart.getByRole('row', { name: 'openai 3 100%' })).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Usage by model', exact: true }).locator('canvas')).toBeVisible()
  await page.getByLabel('Chart interval').selectOption('month')
  expect(sharing).toBe(false)

  await page.getByRole('tab', { name: 'Context window' }).click()
  await expect(page.getByRole('figure', { name: 'Prepared prompt composition', exact: true }).locator('canvas')).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Context window used and available', exact: true }).locator('canvas')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Context component breakdown' }).getByRole('row', {
    name: 'Tool definitions 3,000 21.4% 8.6%'
  })).toBeVisible()

  await page.getByRole('tab', { name: 'Repeated queries' }).click()
  await page.getByLabel('Find a repeated query').fill('  SHENZHEN  ')
  await expect(page.getByLabel('Repeated wording')).toContainText(ownerQuery)
  await expect(page.getByRole('figure', { name: 'Output rate for the same query', exact: true }).locator('canvas')).toBeVisible()
  await expect(page.getByText(/baseline 15,000 tokens · \+33\.3%/u)).toBeVisible()
  await page.getByLabel('Baseline occurrence').selectOption('1')
  await expect(page.getByText(/baseline 20,000 tokens · 0%/u)).toBeVisible()

  await page.getByRole('tab', { name: 'Evaluations' }).click()
  await expect(page).toHaveURL(/\/insights\/evaluations$/)
  const tokens = page.getByRole('figure', { name: 'Evaluation token usage', exact: true })
  const evaluations = page.getByRole('table', { name: 'Evaluation runs' })
  const scenario = page.getByRole('combobox', { name: 'Scenario', exact: true })
  await expect(tokens.locator('canvas')).toBeVisible()
  await expect(scenario).toHaveValue('')
  await expect(evaluations).toContainText('abcdef123456')
  await expect(evaluations).toContainText('fedcba654321')
  await expect(page.getByRole('combobox', { name: 'Suite revision' })).toHaveValue('')
  const archivedRow = evaluations.getByRole('row').filter({ hasText: '1234abcdef56' })
  await expect(archivedRow).toContainText('Jan 29, 2030')
  await expect(archivedRow).toContainText('1 passed · 5 warning')
  await tokens.getByText('View data').click()
  await expect(tokens.getByRole('row').filter({ hasText: 'fedcba654321' }).getByRole('cell', { name: '12,000' })).toHaveCount(2)
  await expect(tokens.getByRole('row').filter({ hasText: '1234abcdef56' }).getByRole('cell', { name: '12,000' })).toHaveCount(2)
  await scenario.selectOption('selected-lookup')
  await expect(tokens.getByRole('row').filter({ hasText: '1234abcdef56' }).getByRole('cell', { name: '2,000' })).toHaveCount(2)
  await scenario.selectOption('')
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('development')
  await expect(page.getByRole('table', { name: 'Evaluation runs' }).getByRole('row')).toHaveCount(2)
  await page.getByRole('tab', { name: 'Overview' }).click()
  await page.getByRole('tab', { name: 'Evaluations' }).click()
  await expect(page.getByRole('table', { name: 'Evaluation runs' })).toContainText('1234abcdef56')
  expect(requestedEvaluations).toEqual([{}, { scenario: 'selected-lookup' }, { source: 'development' }])

  await page.keyboard.press('Escape')
  await expect(insights).toHaveCount(0)
  await page.goForward()
  await expect(insights.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Privacy and security', exact: true }).click()
  await page.getByRole('button', { name: 'Share usage', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop sharing usage' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop sharing usage' }).click()
  await expect(page.getByRole('button', { name: 'Share usage', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('insights/overview')
  await expect(page.locator('.new-session-page')).toBeVisible()
  await expect(tokensPerTurn.locator('canvas')).toBeVisible()
  await expect(reportedTokens.locator('canvas')).toBeVisible()
  const [chartBounds, nextChartBounds] = await Promise.all([
    tokensPerTurn.boundingBox(), reportedTokens.boundingBox()
  ])
  expect(chartBounds!.x + chartBounds!.width).toBeLessThanOrEqual(390)
  expect(nextChartBounds!.x).toBeCloseTo(chartBounds!.x)
  expect(nextChartBounds!.y).toBeGreaterThan(chartBounds!.y)

  expect(sharing).toBe(false)
})

test('keeps the dialog trigger tooltip closed until a fresh hover or keyboard focus', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const trigger = page.getByRole('link', { name: 'Settings', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  const search = dialog.getByRole('combobox', { name: 'Search settings' })
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Settings' })

  await trigger.hover()
  await expect(tooltip).toBeVisible()
  await trigger.click()
  await expect(search).toBeFocused()
  await expect(tooltip).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(tooltip).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Message Leon' }).hover()
  await trigger.hover()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(search).toBeFocused()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(tooltip).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(trigger).toBeFocused()
  await expect(tooltip).toBeVisible()
})

test('opens searchable Settings by keyboard and preserves the conversation draft behind routed dialogs', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this draft')
  await page.keyboard.press('Control+Comma')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  const search = settings.getByRole('combobox', { name: 'Search settings' })
  await expect(search).toBeFocused()
  await expect(settings.locator('kbd')).toHaveText('/')
  await expect(page).toHaveURL(/\/settings\/general$/)
  await expect(page.locator('.session-page textarea[name="query"]')).toHaveValue('Keep this draft')
  await expect(settings.locator('.dialog-footer')).toHaveCount(0)
  await search.fill('primary color')
  await expect(settings.getByRole('option', { name: /Accent color/ })).toBeVisible()
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/settings\/appearance\/accent-color$/)
  const accents = settings.getByRole('group', { name: 'Accent color' })
  await expect(accents).toBeVisible()
  const pink = accents.getByRole('button', { name: 'Leonie pink' })
  await pink.click()
  await expect(pink).toHaveAttribute('aria-pressed', 'true')
  const centers = await pink.evaluate((button) => {
    const swatch = button.querySelector('.workspace-color-dot')!.getBoundingClientRect()
    const ring = button.getBoundingClientRect()
    return { x: swatch.x + swatch.width / 2 - ring.x - ring.width / 2,
      y: swatch.y + swatch.height / 2 - ring.y - ring.height / 2 }
  })
  expect(centers.x).toBeCloseTo(0)
  expect(centers.y).toBeCloseTo(0)
  await settings.getByRole('heading', { name: 'Settings', exact: true }).click()
  await expect(search).not.toBeFocused()
  await page.keyboard.press('/')
  await expect(search).toBeFocused()
  await search.fill('theme')
  await settings.getByRole('option', { name: /Color mode/ }).click()
  await expect(page).toHaveURL(/\/settings\/appearance\/color-mode$/)
  await settings.getByRole('button', { name: 'Close dialog' }).click()
  await expect(settings).toHaveCount(0)
  await expect(composer).toHaveValue('Keep this draft')
  await expect(composer).toBeFocused()
  await page.goForward()
  await expect(settings.getByRole('heading', { name: 'Sounds' })).toBeVisible()
  await expect(search).toHaveValue('')

  await page.goto('settings/appearance/color-mode')
  await expect(page.locator('.new-session-page')).toBeVisible()
  await expect(search).toBeFocused()
  await page.emulateMedia({ colorScheme: 'light' })
  await settings.getByRole('button', { name: 'System', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await settings.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page).toHaveURL(/\/web-app\/$/)
  await expect(composer).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press('Meta+Comma')
  await expect(search).toBeFocused()
  const bounds = (await settings.boundingBox())!
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
})
