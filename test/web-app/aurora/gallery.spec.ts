import { test, expect } from '@playwright/test'
import { AURORA_QUERY_EXAMPLES } from '../../fixtures/aurora'

for (const theme of ['light', 'dark'] as const) {
  test(`previews Notion, Spotify and TickTick connection states without external requests (${theme})`, async ({ page }, testInfo) => {
    const external: string[] = []
    const origin = new URL(testInfo.project.use.baseURL!).origin
    page.on('request', (request) => {
      if (!request.url().startsWith('data:') && new URL(request.url()).origin !== origin) {
        external.push(request.url())
      }
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Widgets', exact: true }).click()
    for (const name of ['Notion', 'Spotify', 'TickTick']) {
      const card = page.getByRole('region', { name: `${name} connection`, exact: true })
      const logo = card.locator('.aurora-connection-icon img.package-icon')
      await logo.scrollIntoViewIfNeeded()
      await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    }
    for (const name of ['Notion', 'TickTick']) {
      const card = page.getByRole('region', { name: `${name} connection`, exact: true })
      await expect(card.getByRole('button', { name: 'OAuth', exact: true })).toHaveCount(0)
      await expect(card.getByRole('button', { name: `Connect ${name}`, exact: true })).toBeVisible()
      if (name === 'Notion') {
        await expect(card.locator('input')).toHaveCount(0)
        await card.getByRole('button', { name: 'Connect Notion', exact: true }).click()
        await expect(card.getByRole('status')).toContainText('Working on the connection')
        await card.getByRole('button', { name: 'Finish authorization', exact: true }).click()
        await expect(card.getByRole('status')).toContainText('Connected — preview only')
        continue
      }
      await expect(card.getByText('A one-time application setup', { exact: false })).toBeVisible()
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click()
      await expect(card.getByLabel('Client ID', { exact: true })).toBeVisible()
      await expect(card.getByLabel('client secret', { exact: true })).toHaveAttribute('type', 'password')
      await card.getByRole('combobox', { name: 'Preview state' }).selectOption('cancelled')
      await expect(card.getByRole('status')).toContainText('Authorization was cancelled')
      await expect(card.getByLabel('access token', { exact: true })).toHaveCount(0)
      await card.getByRole('combobox', { name: 'Preview configuration' }).selectOption('fallback')
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click()
      const token = card.getByLabel('access token', { exact: true })
      await expect(token).toHaveAttribute('type', 'password')
      await token.fill('preview-only-token')
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click()
      await expect(card.getByRole('status')).toContainText('Connected — preview only')
    }
    const spotify = page.getByRole('region', { name: 'Spotify connection', exact: true })
    await spotify.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
    await spotify.getByText('Show setup instructions', { exact: true }).click()
    await expect(spotify.getByText('Redirect URI', { exact: true })).toBeVisible()
    await expect(spotify.locator('input[type="password"]')).toHaveCount(0)
    await spotify.getByLabel('Client ID', { exact: true }).fill('sample-client')
    await spotify.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
    await expect(spotify.getByRole('status')).toContainText('Working on the connection')
    await spotify.getByRole('button', { name: 'Finish authorization', exact: true }).click()
    await expect(spotify.getByRole('status')).toContainText('Connected — preview only')
    await spotify.getByRole('combobox', { name: 'Preview configuration' }).selectOption('ready')
    await expect(spotify.locator('input')).toHaveCount(0)
    await expect(spotify.getByRole('button', { name: 'Set up manually', exact: true })).toHaveCount(0)
    await spotify.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
    await expect(spotify.getByRole('status')).toContainText('Working on the connection')
    await spotify.getByRole('button', { name: 'Cancel authorization', exact: true }).click()
    await expect(spotify.getByRole('status')).toContainText('Authorization was cancelled')
    await spotify.getByRole('combobox', { name: 'Preview state' }).selectOption('failed')
    await expect(spotify.getByRole('alert')).toContainText('I couldn’t complete this step')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`connections-${theme}.png`), fullPage: true })
    await spotify.screenshot({ path: testInfo.outputPath(`spotify-${theme}.png`) })
    expect(external).toEqual([])
    expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain('preview-only-token')
  })
}

test('previews actual generated charts, calculations and SVG explanations with local-only submissions', async ({ page }, testInfo) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Generated UI', exact: true }).click()
  const dashboard = page.frameLocator('iframe[title="A little room for reading"]')
  await expect(dashboard.locator('canvas')).toBeVisible()
  await dashboard.getByRole('slider', { name: 'Daily reading goal' }).fill('40')
  await expect(dashboard.locator('#week-total')).toContainText('280 minutes')
  await dashboard.getByRole('button', { name: 'Plan around this goal' }).click()
  await page.getByRole('button', { name: 'Send selection', exact: true }).click()
  await expect(page.getByLabel('Submitted values')).toContainText('40')
  const calculator = page.frameLocator('iframe[title="A small saving habit"]')
  await calculator.getByRole('slider', { name: 'Monthly saving' }).fill('1000')
  await expect(calculator.locator('#yearly')).toHaveText('¥12000')
  await page.screenshot({ path: testInfo.outputPath('generated-ui-light.png'), fullPage: true })
  const light = page.frameLocator('iframe[title="A little light, a little distance"]')
  await light.getByRole('slider', { name: 'Distance in metres' }).fill('2')
  await expect(light.locator('#brightness')).toContainText('25.0%')
  await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
  await expect(calculator.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(calculator.locator('#yearly')).toHaveText('¥12000')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const theme of ['dark', 'light'] as const) {
  test(`keeps a connected memory overview readable while exploring sources (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    await page.getByRole('searchbox', { name: 'Find a component or widget' }).fill('memory map')
    await page.getByRole('button', { name: 'Generated UI', exact: true }).click()
    const frame = page.frameLocator('iframe[title="A little map of memory"]')
    const element = page.locator('iframe[title="A little map of memory"]')
    await expect(frame.getByRole('button', { name: 'Memory stores', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await frame.getByRole('button', { name: 'Archives', exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'The original conversation', exact: true })).toBeVisible()
    await expect(frame.locator('.memory-context')).toBeVisible()
    await expect(frame.locator('.memory-connections')).toBeVisible()
    await element.screenshot({ path: testInfo.outputPath(`memory-map-${theme}.png`) })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(frame.getByRole('button', { name: 'Archives', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await element.screenshot({ path: testInfo.outputPath(`memory-map-${theme}-narrow.png`) })
  })
}

for (const [theme, reducedMotion] of [['light', 'reduce'], ['dark', 'no-preference']] as const) {
  test(`previews shared components in wide and narrow layouts (${theme}, ${reducedMotion})`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.emulateMedia({ reducedMotion })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByRole('heading', { name: 'Buttons', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Pin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const selection = page.getByRole('region', { name: 'Selections', exact: true })
    const checkbox = selection.getByRole('checkbox', { name: 'Leave a little room for a new idea', exact: true })
    await checkbox.check()
    await expect(checkbox.locator('..').locator('.aurora-selection-check')).toHaveCSS('opacity', '1')
    expect(await checkbox.evaluate((input) => {
      const mark = input.parentElement!.querySelector<SVGElement>('.aurora-selection-check')!
      const box = input.getBoundingClientRect()
      const svg = mark.closest('svg')!.getBoundingClientRect()
      const styles = getComputedStyle(document.documentElement)
      const probe = document.createElement('span')
      probe.style.color = styles.getPropertyValue('--color-accent-contrast')
      document.body.append(probe)
      const contrast = getComputedStyle(probe).color
      probe.remove()

      return { centered: Math.abs(box.x + box.width / 2 - svg.x - svg.width / 2) < 1 &&
        Math.abs(box.y + box.height / 2 - svg.y - svg.height / 2) < 1,
      contrasted: getComputedStyle(mark).fill === contrast, visible: getComputedStyle(mark).opacity === '1' }
    })).toEqual({ centered: true, contrasted: true, visible: true })
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    await expect(checkbox.locator('..').locator('.aurora-selection-check')).toHaveCSS('opacity', '0')
    const search = page.getByRole('searchbox', { name: 'Find a component or widget' })
    await search.fill('loaders')
    await expect(page.getByRole('heading', { name: 'Loaders', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Buttons', exact: true })).toHaveCount(0)
    await search.fill('')
    await page.getByRole('button', { name: 'Narrow preview', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`aurora-${theme}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Widgets', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible()
    const emptyCheckbox = page.getByRole('region', { name: 'Multiple choice', exact: true }).getByRole('checkbox').first()
    const emptyBackground = await emptyCheckbox.evaluate((input) => getComputedStyle(input).backgroundColor)
    const boolean = page.getByRole('region', { name: 'Boolean choice', exact: true })
    for (const radio of await boolean.getByRole('radio').all()) {
      await expect(radio).not.toBeChecked()
      await expect(radio).toHaveCSS('background-color', emptyBackground)
      expect(await radio.evaluate((input) => {
        const mark = input.parentElement!.querySelector('.aurora-selection-check')!

        return getComputedStyle(mark).opacity
      })).toBe('0')
    }
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`aurora-widgets-${theme}.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('submits explicit boolean, keyboard single and multiple selections locally', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const boolean = page.getByRole('region', { name: 'Boolean choice', exact: true })
  await expect(boolean.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await boolean.getByRole('radio', { name: 'Yes', exact: true }).check()
  await expect(boolean.getByLabel('Submitted values')).toHaveText('true')
  await expect(boolean.getByRole('radio', { name: 'Yes', exact: true })).toBeDisabled()
  const single = page.getByRole('region', { name: 'Single choice', exact: true })
  const first = single.getByRole('radio').first()
  await first.focus()
  await first.press('ArrowDown')
  await expect(single.getByRole('radio').nth(1)).toBeChecked()
  await expect(single.getByLabel('Submitted values')).toHaveCount(0)
  await expect(single.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await single.getByRole('radio').nth(1).press('Space')
  await expect(single.getByLabel('Submitted values')).toContainText('creative')
  await single.getByRole('button', { name: 'Reset example' }).click()
  await single.getByRole('radio').first().focus()
  await single.getByRole('radio').first().press('Enter')
  await expect(single.getByLabel('Submitted values')).toContainText('quiet')
  const multiple = page.getByRole('region', { name: 'Multiple choice', exact: true })
  await multiple.getByRole('checkbox').first().check()
  await multiple.getByRole('checkbox').last().check()
  await expect(multiple.getByLabel('Submitted values')).toHaveCount(0)
  await multiple.getByRole('button', { name: 'Continue' }).click()
  await expect(multiple.getByLabel('Submitted values')).toHaveText('[\n  "quiet",\n  "outside"\n]')
  expect(requests).toEqual([])
})

test('navigates composite controls with native constraints and keyboard selection', async ({ page }) => {
  await page.goto('/aurora.html')
  const toggle = page.getByRole('switch', { name: 'A little background music' })
  await expect(toggle).toBeChecked()
  await toggle.focus()
  await toggle.press('Space')
  await expect(toggle).not.toBeChecked()
  const segmented = page.getByRole('radio', { name: 'Gentle', exact: true })
  await segmented.focus()
  await segmented.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Focused', exact: true })).toBeChecked()
  await page.getByRole('tab', { name: 'Ideas', exact: true }).focus()
  await page.getByRole('tab', { name: 'Ideas', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Notes', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('Keep the useful pieces together.')
  const number = page.getByRole('spinbutton', { name: 'Reading minutes' })
  await page.getByRole('button', { name: 'Increase Reading minutes' }).click()
  await expect(number).toHaveValue('35')
  await number.fill('60')
  await expect(page.getByRole('button', { name: 'Increase Reading minutes' })).toBeDisabled()
  await page.getByRole('button', { name: 'Decrease Reading minutes' }).click()
  await expect(number).toHaveValue('55')
  const search = page.getByRole('combobox', { name: 'Choose a moment', exact: true })
  await search.fill('creative')
  await expect(page.getByRole('option', { name: 'Something creative', exact: true })).toBeVisible()
  await search.press('ArrowDown')
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    await page.getByRole('option', { name: 'Something creative', exact: true }).getAttribute('id') ?? ''
  )
  await search.press('Enter')
  await expect(search).toHaveValue('Something creative')
  const multiple = page.getByRole('combobox', { name: 'Make room for', exact: true })
  await multiple.click()
  await multiple.fill('quiet')
  await expect(page.getByRole('option', { name: 'A quiet morning', exact: true })).toBeVisible()
  await multiple.press('ArrowDown')
  await expect(multiple).toHaveAttribute(
    'aria-activedescendant',
    await page.getByRole('option', { name: 'A quiet morning', exact: true }).getAttribute('id') ?? ''
  )
  await multiple.press('Enter')
  await expect(page.getByLabel('Selected moments')).toHaveText('quiet')
  await multiple.fill('outside')
  await expect(page.getByRole('option', { name: 'Time outside', exact: true })).toBeVisible()
  await multiple.press('ArrowDown')
  await expect(multiple).toHaveAttribute(
    'aria-activedescendant',
    await page.getByRole('option', { name: 'Time outside', exact: true }).getAttribute('id') ?? ''
  )
  await multiple.press('Enter')
  await expect(page.getByLabel('Selected moments')).toHaveText('quiet, outside')
  const summary = page.getByRole('list', { name: 'Make room for selection', exact: true })
  await expect(summary.getByRole('button', { name: 'Remove A quiet morning' })).toBeVisible()
  await summary.getByRole('button', { name: 'Remove A quiet morning' }).click()
  await expect(page.getByLabel('Selected moments')).toHaveText('outside')
})

test('filters, sorts and pages native data, compares differences and exposes chart data', async ({ page }, testInfo) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const table = page.getByRole('region', { name: 'Reading notes', exact: true })
  await expect(table.getByRole('row')).toHaveCount(13)
  await table.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(5)
  await table.getByRole('button', { name: 'Sort by Minutes', exact: true }).click()
  await table.getByRole('button', { name: 'Sort by Minutes', exact: true }).click()
  await expect(table.getByRole('row').nth(1)).toContainText('80')
  await table.getByRole('searchbox').fill('Day 16')
  await expect(table.getByRole('row')).toHaveCount(2)
  const comparison = page.getByRole('region', { name: 'Comparison', exact: true })
  await expect(comparison.getByRole('cell', { name: 'Kitchen', exact: true })).toBeVisible()
  await comparison.getByRole('switch', { name: 'Only differences' }).check()
  await expect(comparison.getByRole('cell', { name: 'Kitchen', exact: true })).toHaveCount(0)
  await expect(comparison.getByRole('cell', { name: 'Garden', exact: true })).toBeVisible()
  const chart = page.getByRole('region', { name: 'A little time to read', exact: true })
  await expect(chart.locator('canvas')).toBeVisible()
  await chart.getByText('View data', { exact: true }).click()
  await expect(chart.getByRole('columnheader', { name: 'Reading (min)' })).toBeVisible()
  await expect(chart.getByRole('cell', { name: '45', exact: true })).toBeVisible()
  const example = page.getByRole('region', { name: 'Chart', exact: true })
  for (const kind of ['Line', 'Pie', 'Bar']) {
    await example.getByRole('radio', { name: kind, exact: true }).check()
    await expect(chart.locator('canvas')).toBeVisible()
    await expect(chart.getByRole('cell', { name: '45', exact: true })).toBeVisible()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('native-widgets.png'), fullPage: true })
  expect(requests).toEqual([])
})

test('copies natural owner queries without sending a request or changing an example', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string): Promise<void> => {
        document.documentElement.dataset['copiedQuery'] = text
      }
    } })
  })
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const titles = {
    boolean: 'Boolean choice', 'single-choice': 'Single choice',
    'multi-choice': 'Multiple choice', form: 'Form'
  }
  for (const id of Object.keys(titles) as (keyof typeof titles)[]) {
    const example = page.getByRole('region', { name: titles[id], exact: true })
    const query = example.getByRole('complementary', { name: 'Try in Leon', exact: true })
    await expect(query.getByText(AURORA_QUERY_EXAMPLES[id], { exact: true })).toBeVisible()
    await query.getByRole('button', { name: 'Copy query', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-copied-query', AURORA_QUERY_EXAMPLES[id])
    await expect(query.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    await expect(example.getByLabel('Submitted values')).toHaveCount(0)
  }
  expect(requests).toEqual([])
})

test('validates fields, preserves failed drafts and locks pending or accepted submissions', async ({ page }) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const form = page.getByRole('region', { name: 'Form', exact: true })
  const save = form.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  await expect(form.getByRole('textbox', { name: 'Project name' })).toBeFocused()
  await expect(form.getByLabel('Submitted values')).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Project name' }).fill('A small garden')
  await form.getByRole('combobox', { name: 'Pace', exact: true }).selectOption('gentle')
  await form.getByRole('textbox', { name: 'Anything else?' }).fill('Leave time to explore.')
  await form.getByRole('combobox', { name: 'Preview result' }).selectOption('failure')
  await save.click()
  await expect(form.getByRole('alert')).toContainText('I couldn\'t save this')
  await expect(form.getByRole('textbox', { name: 'Project name' })).toHaveValue('A small garden')
  await form.getByRole('combobox', { name: 'Preview result' }).selectOption('pending')
  await save.click()
  await expect(save).toHaveAttribute('aria-busy', 'true')
  await expect(save).toBeDisabled()
  await expect(form.getByRole('textbox', { name: 'Project name' })).toBeDisabled()
  await form.getByRole('button', { name: 'Finish save' }).click()
  await expect(form.getByRole('status', { name: '', exact: true })).toHaveText('Saved. Thank you.')
  await expect(form.getByLabel('Submitted values')).toContainText('Leave time to explore.')
  await expect(save).toBeDisabled()
  await form.getByRole('button', { name: 'Reset example' }).click()
  await expect(form.getByRole('textbox', { name: 'Project name' })).toHaveValue('')
})

test('shows measured and indeterminate preparation with cancellation and retry', async ({ page }) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const preparation = page.getByRole('region', { name: 'Tool preparation', exact: true })
  await expect(preparation.getByRole('progressbar')).toHaveAttribute('value', '36')
  await preparation.getByRole('slider', { name: 'Measured progress' }).fill('72')
  await expect(preparation.getByRole('progressbar')).toHaveAttribute('value', '72')
  await preparation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preparation.getByRole('status')).toHaveText('Download cancelled.')
  const state = preparation.getByRole('combobox', { name: 'Preview state' })
  await state.selectOption('failed')
  await expect(preparation.getByRole('alert')).toContainText('try again')
  await preparation.getByRole('button', { name: 'Try again' }).click()
  await expect(preparation.getByRole('progressbar')).toBeVisible()
  await state.selectOption('preparing')
  await expect(preparation.getByRole('progressbar')).toHaveCount(0)
  await expect(preparation.getByRole('status')).toContainText('Checking the files')
})

test('embeds artifacts in answer order with image enlargement and a local document download', async ({ page }) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Answer preview', exact: true }).click()
  const answer = page.getByRole('region', { name: 'Visual answer preview' })
  const intro = (await answer.getByText('A slow Sunday sounds lovely.', { exact: false }).boundingBox())!
  const image = answer.getByRole('img', { name: 'Sunday pancakes.jpeg', exact: true })
  expect((await image.boundingBox())!.y).toBeGreaterThan(intro.y)
  await answer.getByRole('button', { name: 'Enlarge Sunday pancakes.jpeg' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sunday pancakes.jpeg' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  const download = page.waitForEvent('download')
  await answer.locator('figure').filter({ hasText: 'Attention is all you need.pdf' }).getByRole('link', { name: 'Download', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Attention is all you need.pdf')
})
