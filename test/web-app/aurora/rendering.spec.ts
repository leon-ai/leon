import { test, expect, type Locator, type Page } from '@playwright/test'
import { finishFiniteAnimations } from '../e2e/fixtures'
import { createMarkdownPreviewExamples } from '../../fixtures/markdown-preview'

function observePreviewRequests(page: Page, baseURL: string, favicons = false): { unexpected: string[], paths: string[], errors: string[] } {
  const origin = new URL(baseURL).origin
  const unexpected: string[] = []
  const paths: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().startsWith('blob:') || request.url().startsWith('data:')) {
      return
    }
    const url = new URL(request.url())
    paths.push(url.pathname)
    const fixture = favicons && url.pathname === '/api/v1/favicons' &&
      url.searchParams.get('origin') === 'https://getleon.ai' && request.method() === 'GET'
    if (url.origin !== origin || url.pathname.startsWith('/api/') && !fixture) {
      unexpected.push(request.url())
    }
  })

  return { unexpected, paths, errors }
}

test('keeps file artwork and download actions available when a document icon cannot load', async ({ page }) => {
  await page.route('**/img/file-icons/*/pdf.svg', (route) => route.fulfill({ status: 404 }))
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
  const document = page.getByRole('region', { name: 'Artifacts preview', exact: true })
    .locator('figure').filter({ hasText: 'Attention is all you need.pdf' })
  await document.scrollIntoViewIfNeeded()
  await expect(document.locator('svg.app-icon')).toBeVisible()
  await expect(document.locator('img[data-file-icon]')).toHaveCount(0)
  await expect(document.getByRole('link', { name: 'Open', exact: true })).toBeVisible()
  await expect(document.getByRole('link', { name: 'Download', exact: true })).toBeVisible()
})

for (const [theme, reducedMotion] of [['light', 'reduce'], ['dark', 'no-preference']] as const) {
  test(`previews real local artifact formats with manual media playback and downloads (${theme})`, async ({ page }, testInfo) => {
    const observed = observePreviewRequests(page, testInfo.project.use.baseURL!)
    await page.emulateMedia({ reducedMotion })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    expect(observed.paths.some((url) => url.includes('/artifacts-preview-'))).toBe(false)
    await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
    const artifacts = page.getByRole('region', { name: 'Artifacts preview', exact: true })
    await expect(artifacts.locator('figure')).toHaveCount(11)
    const fileIcons = artifacts.getByRole('region', { name: 'File icons', exact: true })
    for (const [filename, asset] of [['README.md', 'readme'], ['package.json', 'npm'], ['Dockerfile', 'docker'], ['.gitignore', 'gitignore'], ['main.rs', 'rust'], ['Program.cs', 'csharp'], ['main.kt', 'kotlin'], ['Main.java', 'java']] as const) {
      const icon = fileIcons.getByRole('img', { name: filename, exact: true })
      await icon.scrollIntoViewIfNeeded()
      await expect(icon).toHaveAttribute('data-file-icon', asset)
      await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    }
    const readme = fileIcons.getByRole('img', { name: 'README.md', exact: true })
    await expect(readme).toHaveAttribute('src', new RegExp(`/img/file-icons/[a-f0-9]{64}/readme${theme === 'dark' ? '_dark' : ''}\\.svg$`))
    await page.getByRole('button', { name: `Apply ${theme === 'dark' ? 'light' : 'dark'} theme`, exact: true }).click()
    await expect(readme).toHaveAttribute('src', new RegExp(`/img/file-icons/[a-f0-9]{64}/readme${theme === 'dark' ? '' : '_dark'}\\.svg$`))
    await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
    await expect(readme).toHaveAttribute('src', new RegExp(`/img/file-icons/[a-f0-9]{64}/readme${theme === 'dark' ? '_dark' : ''}\\.svg$`))
    const video = artifacts.locator('video')
    const audio = artifacts.locator('audio')
    for (const media of [video, audio]) {
      await expect(media).toHaveAttribute('preload', 'none')
      await expect(media).toHaveAttribute('controls', '')
      await expect(media).not.toHaveAttribute('autoplay')
      const source = await media.getAttribute('src')
      expect(observed.paths).not.toContain(source)
    }
    const photo = artifacts.getByRole('img', { name: 'Sunday pancakes.jpeg', exact: true })
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await artifacts.getByRole('button', { name: 'Enlarge Sunday pancakes.jpeg', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Sunday pancakes.jpeg', exact: true })
    await expect(dialog.getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    for (const media of [video, audio]) {
      await media.evaluate(async (element: HTMLMediaElement) => {
        element.muted = true
        await element.play()
      })
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.duration)).toBeGreaterThan(0)
      await media.evaluate((element: HTMLMediaElement) => element.pause())
    }
    for (const filename of ['Attention is all you need.pdf', 'Field notes.docx', 'Notes.txt', 'Moments.csv', 'Moments.json', 'Greeting.py', 'Project notes.zip', 'Sample.leon']) {
      const file = artifacts.locator('figure').filter({ hasText: filename })
      await expect(file.getByRole('link', { name: 'Open', exact: true })).toBeVisible()
      await expect(file.locator('.app-icon')).toBeVisible()
      if (filename.endsWith('.pdf') || filename.endsWith('.docx') || filename.endsWith('.txt') || filename.endsWith('.csv')) {
        const artwork = file.locator('img[data-file-icon]')
        await artwork.scrollIntoViewIfNeeded()
        await expect.poll(() => artwork.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
      }
      const downloadEvent = page.waitForEvent('download')
      await file.getByRole('link', { name: 'Download', exact: true }).click()
      const download = await downloadEvent
      expect(download.suggestedFilename()).toBe(filename)
      expect(await download.failure()).toBeNull()
    }
    await artifacts.screenshot({ path: testInfo.outputPath(`artifacts-${theme}.png`) })
    await page.getByRole('button', { name: 'Narrow preview', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await artifacts.screenshot({ path: testInfo.outputPath(`artifacts-${theme}-narrow.png`) })
    await page.getByRole('button', { name: 'Components', exact: true }).click()
    await expect(artifacts).toHaveCount(0)
    expect(observed.unexpected).toEqual([])
    expect(observed.errors).toEqual([])
  })

  test(`renders supported Markdown, honest fallbacks and cancellable streaming with local assets (${theme})`, async ({ page }, testInfo) => {
    const observed = observePreviewRequests(page, testInfo.project.use.baseURL!, true)
    await page.emulateMedia({ reducedMotion })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    expect(observed.paths.some((url) => url.includes('/markdown-preview-'))).toBe(false)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    const preview = page.getByRole('region', { name: 'Markdown preview', exact: true })
    const examples = createMarkdownPreviewExamples('/local-image.jpeg')
    const example = (id: string): Locator => preview.getByRole('region', { name: examples.find((item) => item.id === id)!.title, exact: true })
    const rendered = (id: string): Locator => example(id).getByRole('region', { name: 'Rendered Markdown', exact: true })
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('combobox')).toHaveCount(0)
    for (const item of examples) {
      await expect(preview.getByRole('region', { name: item.title, exact: true })).toBeVisible()
    }
    for (let level = 1; level <= 6; level++) {
      await expect(rendered('typography').getByRole('heading', { level })).toHaveCount(1)
    }
    await expect(rendered('typography').locator('del')).toHaveText('strikethrough')
    await expect(rendered('lists').getByRole('checkbox')).toHaveCount(4)
    await expect(rendered('lists').getByRole('checkbox', { name: 'Completed task', exact: true }).first()).toBeChecked()
    await expect(rendered('lists').locator('ol[start="7"]')).toBeVisible()
    const link = rendered('links').getByRole('link', { name: 'Leon website', exact: true })
    await link.scrollIntoViewIfNeeded()
    await expect(link.locator('img')).toHaveAttribute('data-loaded', 'true')
    await link.hover()
    await expect(page.locator('.tooltip-content-open')).toHaveText('https://getleon.ai/')
    await rendered('links').getByRole('button', { name: /Open .* on Leon’s host/ }).click()
    await expect(page.getByText('Host files cannot be opened here. You can still copy the path.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close notification', exact: true }).click()
    const details = rendered('details').locator('details')
    await expect(details).toHaveCount(2)
    await expect(details.first()).not.toHaveAttribute('open')
    await expect(details.last()).toHaveAttribute('open', '')
    await details.first().locator('summary').click()
    await expect(details.first().locator('strong')).toHaveText('formatted content')
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      await expect(rendered('alerts').locator(`.markdown-alert-${kind}`)).toBeVisible()
    }
    const reference = rendered('footnotes').getByRole('link', { name: '1', exact: true }).first()
    await reference.click()
    const target = (await reference.getAttribute('href'))!.slice(1)
    await expect(rendered('footnotes').locator(`[id="${target}"]`)).toBeVisible()
    await expect(rendered('math').locator('.katex')).toHaveCount(5)
    const diagrams = rendered('diagrams')
    await expect(diagrams.locator('.markdown-diagram > svg')).toHaveCount(3)
    await expect(diagrams.locator('.markdown-diagram-notice')).toHaveCount(0)
    for (const block of await diagrams.locator('.markdown-code').all()) {
      const header = block.locator('.markdown-code-header')
      await expect(header.getByRole('button')).toHaveCount(4)
      const spread = await header.getByRole('button').evaluateAll((buttons) => {
        const centers = buttons.map((button) => {
          const bounds = button.getBoundingClientRect()

          return bounds.y + bounds.height / 2
        })

        return Math.max(...centers) - Math.min(...centers)
      })
      expect(spread).toBeLessThan(1)
      await expect(block.locator('.exportable-visual > .visual-export-actions')).toHaveCount(0)
    }
    const firstDiagram = diagrams.locator('.markdown-code').first()
    await firstDiagram.getByRole('button', { name: 'View diagram code', exact: true }).click()
    await expect(firstDiagram.getByRole('region', { name: 'Code block', exact: true })).toContainText('flowchart LR')
    await expect(firstDiagram.getByRole('button', { name: 'Copy image', exact: true })).toBeDisabled()
    await firstDiagram.getByRole('button', { name: 'View diagram', exact: true }).click()
    await expect(firstDiagram.getByRole('button', { name: 'Copy image', exact: true })).toBeEnabled()
    await diagrams.getByRole('button', { name: 'Enlarge diagram', exact: true }).first().click()
    const diagram = page.getByRole('dialog', { name: 'Diagram', exact: true })
    await expect(diagram.getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(diagram).toHaveCount(0)
    await finishFiniteAnimations(diagrams)
    await example('diagrams').screenshot({ path: testInfo.outputPath(`markdown-diagrams-${theme}.png`) })
    const photo = rendered('images').getByRole('img', { name: 'Sunday pancakes', exact: true })
    await photo.scrollIntoViewIfNeeded()
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect(rendered('images').getByText('External image blocked for privacy', { exact: true })).toBeVisible()
    const codeExample = example('code')
    await codeExample.getByRole('button', { name: 'Replay streaming', exact: true }).click()
    await expect(codeExample.getByRole('button', { name: 'Show complete', exact: true })).toBeVisible()
    await expect(rendered('code')).toContainText('type Moment')
    await codeExample.getByRole('button', { name: 'Show complete', exact: true }).click()
    await expect(rendered('code').getByText('unknown-language', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Narrow preview', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    for (const id of ['tables', 'long-code', 'diagrams']) {
      if (id === 'long-code') {
        const code = rendered(id).getByRole('region', { name: 'Code block', exact: true })
        expect(await code.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
        expect(await code.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
      }
      if (id === 'diagrams') {
        await expect(rendered(id).locator('.markdown-diagram > svg')).toHaveCount(3)
      }
      await finishFiniteAnimations(example(id))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await example(id).screenshot({ path: testInfo.outputPath(`markdown-${id}-${theme}-narrow.png`) })
    }
    await codeExample.getByRole('button', { name: 'Replay streaming', exact: true }).click()
    await page.getByRole('button', { name: 'Components', exact: true }).click()
    await expect(preview).toHaveCount(0)
    await expect.poll(() => page.workers().length).toBe(0)
    expect(observed.unexpected).toEqual([])
    expect(observed.errors).toEqual([])
  })
}
