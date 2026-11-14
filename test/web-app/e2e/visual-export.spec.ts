import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'
import { AURORA_CALCULATOR_SPEC, AURORA_GENERATED_SPEC, AURORA_PRESENTATION_SPEC, auroraParts } from '../../fixtures/aurora'
import { isBoundedPNG } from '../../../apps/web/src/components/visual-export/image-contract'

async function installClipboardProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as typeof window & { imageCopies: Blob[] }
    host.imageCopies = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]): Promise<void> => {
        host.imageCopies.push(await items[0]!.getType('image/png'))
      }
    } })
  })
}

async function lastImage(page: Page): Promise<{
  count: number
  width: number
  height: number
  colors: number
  digest: string
  bytes: number[]
}> {
  return page.evaluate(async () => {
    const images = (window as typeof window & { imageCopies: Blob[] }).imageCopies
    const blob = images.at(-1)!
    const image = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    const colors = new Set<number>()
    for (let index = 0; index < pixels.length; index += 16) {
      colors.add((pixels[index]! << 16) + (pixels[index + 1]! << 8) + pixels[index + 2]!)
    }
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((value) => value.toString(16).padStart(2, '0')).join('')
    const result = { count: images.length, width: image.width, height: image.height,
      colors: colors.size, digest, bytes: [...new Uint8Array(await blob.arrayBuffer()).slice(0, 24)] }
    image.close()

    return result
  })
}

test('exports complete Markdown tables and diagrams locally on demand', async ({ page, ui }, testInfo) => {
  await page.setViewportSize({ width: 560, height: 982 })
  await installClipboardProbe(page)
  const history = ui.history.get(SESSION_ID)!
  history.at(-1)!.message = `| ${Array.from({ length: 24 }, (_, index) => `Heading ${index}`).join(' | ')} |\n` +
    `| ${Array.from({ length: 24 }, () => '---').join(' | ')} |\n` +
    `| ${Array.from({ length: 24 }, (_, index) => `A little space ${index}`).join(' | ')} |\n\n` +
    '```mermaid\nflowchart LR\n A[Ideas] --> B[Craft]\n```'
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(SESSION_URL)
  const table = page.locator('.exportable-visual').filter({ has: page.getByRole('table') })
  const diagram = page.locator('.markdown-code').filter({ has: page.getByRole('button', { name: 'Enlarge diagram' }) })
  await expect(diagram.locator('.markdown-diagram > svg')).toBeVisible()
  expect(requests.some((url) => url.includes('/capture-image-'))).toBe(false)
  const width = (await table.getByRole('table').boundingBox())!.width
  expect(width).toBeGreaterThan(560)
  await table.getByRole('button', { name: 'Copy image', exact: true }).click()
  await expect(table.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  await expect(page.getByRole('tooltip', { name: 'Copied', exact: true })).toBeVisible()
  const image = await lastImage(page)
  expect(image.width).toBe(Math.ceil(width) * 2)
  expect(image.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(image.colors).toBeGreaterThan(5)
  expect(requests.some((url) => url.includes('/capture-image-'))).toBe(true)
  const downloading = page.waitForEvent('download')
  await diagram.getByRole('button', { name: 'Download image', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('leon-visual.png')
  const bytes = await fs.readFile((await download.path())!)
  expect(isBoundedPNG(bytes)).toBe(true)
  await fs.copyFile((await download.path())!, testInfo.outputPath('diagram-image.png'))
  await testInfo.attach('diagram-image', { body: bytes, contentType: 'image/png' })
  expect(requests.filter((url) => url.startsWith('http') && new URL(url).hostname !== '127.0.0.1')).toEqual([])
})

test('exports chart pixels and keeps downloading available after clipboard denial', async ({ page, ui }, testInfo) => {
  const history = ui.history.get(SESSION_ID)!
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, AURORA_PRESENTATION_SPEC)
  await page.goto(SESSION_URL)
  const chart = page.locator('.exportable-visual').filter({ has: page.getByRole('region', { name: 'A little time to read', exact: true }) })
  await expect(chart.locator('canvas')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: (): Promise<void> => Promise.reject(new DOMException('Denied', 'NotAllowedError'))
    } })
  })
  await chart.getByRole('button', { name: 'Copy image', exact: true }).click()
  await expect(page.getByText('I couldn’t copy this image', { exact: true })).toBeVisible()
  await expect(chart.getByRole('button', { name: 'Download image', exact: true })).toBeEnabled()
  const downloading = page.waitForEvent('download')
  await chart.getByRole('button', { name: 'Download image', exact: true }).click()
  const download = await downloading
  const bytes = await fs.readFile((await download.path())!)
  expect(isBoundedPNG(bytes)).toBe(true)
  await fs.copyFile((await download.path())!, testInfo.outputPath('chart-image.png'))
  await testInfo.attach('chart-image', { body: bytes, contentType: 'image/png' })
})

test('exports generated charts through their existing isolated renderer', async ({ page, ui }) => {
  await installClipboardProbe(page)
  const history = ui.history.get(SESSION_ID)!
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, AURORA_GENERATED_SPEC)
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A little room for reading"]')
  await expect(frame.locator('canvas')).toBeVisible()
  await frame.getByRole('slider', { name: 'Daily reading goal' }).fill('45')
  const surface = page.getByRole('region', { name: 'A little room for reading', exact: true })
  await surface.getByRole('button', { name: 'Copy image', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const image = await lastImage(page)
  expect(image.colors).toBeGreaterThan(5)
  expect(image.height).toBeGreaterThan(560)
  await expect(frame.getByRole('slider', { name: 'Daily reading goal' })).toHaveValue('45')
  await expect(surface.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts')
})

for (const theme of ['dark', 'light'] as const) {
  test(`captures live generated state without relaxing isolation or sending commands (${theme})`, async ({ page, ui }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('leon.web-app.theme', value), theme)
    await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' })
    await installClipboardProbe(page)
    const spec = structuredClone(AURORA_CALCULATOR_SPEC)
    const node = spec.elements['savings']!
    if (node.type !== 'Generated') {
      throw new Error('The fixture needs an isolated surface.')
    }
    node.props.html = '<label>Current note<input id="note" aria-label="Current note" value="A quiet morning"></label><output id="value">A quiet morning</output>'
    node.props.css = 'label,output{display:block;padding:var(--space-md)}'
    node.props.javascript = 'document.getElementById("note").addEventListener("input", event => {document.getElementById("value").textContent = event.target.value})'
    const history = ui.history.get(SESSION_ID)!
    history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
    const commands: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST') {
        commands.push(request.url())
      }
    })
    await page.goto(SESSION_URL)
    const surface = page.getByRole('region', { name: node.props.title, exact: true })
    const frame = page.frameLocator(`iframe[title="${node.props.title}"]`)
    const copy = surface.getByRole('button', { name: 'Copy image', exact: true })
    await expect(frame.getByRole('textbox', { name: 'Current note' })).toBeVisible()
    const controls = surface.locator('.generated-toolbar button')
    const actionColor = await page.locator('.message-metadata .button').last()
      .evaluate((button) => getComputedStyle(button).color)
    for (const button of await controls.all()) {
      await expect(button).toHaveCSS('width', '32px')
      await expect(button).toHaveCSS('height', '32px')
      await expect(button).toHaveCSS('border-radius', '999px')
      await expect(button.locator('.app-icon')).toHaveCSS('width', '16px')
      await expect(button.locator('.app-icon')).toHaveCSS('height', '16px')
      await expect(button).toHaveCSS('color', actionColor)
    }
    await expect(surface.locator('.generated-toolbar > .aurora-actions')).toHaveCSS('gap', '0px')
    await expect(surface.locator('.visual-export-actions')).toHaveCSS('gap', '0px')
    await expect(copy.locator('svg')).toHaveAttribute('data-icon', 'multi-image')
    await surface.locator('.generated-toolbar').screenshot({ path: testInfo.outputPath(`visual-toolbar-${theme}.png`) })
    await copy.click()
    await expect(surface.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    await expect(surface.getByRole('button', { name: 'Copied', exact: true })
      .locator('[data-icon-state]')).toHaveAttribute('data-icon-state', 'copied')
    const first = await lastImage(page)
    expect(first.width).toBeGreaterThan(100)
    expect(first.colors).toBeGreaterThan(5)
    await frame.getByRole('textbox', { name: 'Current note' }).fill('A warm afternoon with room to create')
    const downloading = page.waitForEvent('download')
    await surface.getByRole('button', { name: 'Download image', exact: true }).click()
    const download = await downloading
    await expect(surface.getByRole('button', { name: 'Download started', exact: true })
      .locator('[data-icon-state]')).toHaveAttribute('data-icon-state', 'confirmed')
    const bytes = await fs.readFile((await download.path())!)
    expect(isBoundedPNG(bytes)).toBe(true)
    expect(createHash('sha256').update(bytes).digest('hex')).not.toBe(first.digest)
    await fs.copyFile((await download.path())!, testInfo.outputPath(`generated-image-${theme}.png`))
    await testInfo.attach(`generated-image-${theme}`, { body: bytes, contentType: 'image/png' })
    const exported = await page.evaluate(async (base64) => {
      const response = await fetch(`data:image/png;base64,${base64}`)
      const image = await createImageBitmap(await response.blob())
      const size = { width: image.width, height: image.height }
      image.close()

      return size
    }, bytes.toString('base64'))
    expect(exported.width).toBe(first.width)
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(frame.getByRole('textbox', { name: 'Current note' })).toHaveValue('A warm afternoon with room to create')
    await expect(surface.getByRole('button', { name: 'Stop interface', exact: true })).toHaveCount(0)
    expect(commands).toEqual([])
  })
}

test('keeps fullscreen actions synchronized through expansion and external exits', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, AURORA_CALCULATOR_SPEC)
  await page.goto(SESSION_URL)
  const surface = page.getByRole('region', { name: 'A small saving habit', exact: true })
  const expand = surface.getByRole('button', { name: 'Expand', exact: true })
  await expand.click()
  const collapse = surface.getByRole('button', { name: 'Collapse', exact: true })
  await expect(collapse).toHaveAttribute('aria-pressed', 'true')
  await expect(collapse.locator('[data-icon-state]')).toHaveAttribute('data-icon-state', 'expanded')
  await collapse.hover()
  await expect(page.getByRole('tooltip', { name: 'Collapse', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('aria-label'))).toBe('A small saving habit')
  await collapse.click()
  await expect(expand).toHaveAttribute('aria-pressed', 'false')
  await expand.click()
  await expect(collapse).toBeVisible()
  // Browser UI and Escape exit outside the button's own click handler.
  await page.evaluate(() => document.exitFullscreen())
  await expect(expand).toHaveAttribute('aria-pressed', 'false')
  await expect(expand.locator('[data-icon-state]')).toHaveAttribute('data-icon-state', 'idle')
})

for (const failure of ['oversized', 'malformed'] as const) {
  test(`reports ${failure} capture failures without pausing a generated interface`, async ({ page, ui }) => {
    const spec = structuredClone(AURORA_CALCULATOR_SPEC)
    const node = spec.elements['savings']!
    if (node.type !== 'Generated') {
      throw new Error('The fixture needs an isolated surface.')
    }
    node.props.html = '<div class="room">Plenty of room to create.</div>'
    node.props.css = failure === 'oversized' ? '.room { height: 9000px }' : ''
    node.props.javascript = failure === 'malformed' ? `const send = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function(value, ...args) {
  if (value.type === 'export') {
    return send.call(this, { ...value, bytes: new ArrayBuffer(0) });
  }
  return send.call(this, value, ...args);
};` : ''
    const history = ui.history.get(SESSION_ID)!
    history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
    await page.goto(SESSION_URL)
    const surface = page.getByRole('region', { name: node.props.title, exact: true })
    const frame = page.frameLocator(`iframe[title="${node.props.title}"]`)
    await expect(frame.getByText('Plenty of room to create.')).toBeVisible()
    await surface.getByRole('button', { name: 'Download image', exact: true }).click()
    await expect(page.getByText('I couldn’t download this image', { exact: true })).toBeVisible()
    await expect(surface.locator('iframe')).toBeVisible()
    await expect(surface.getByRole('button', { name: 'Download image', exact: true })).toBeEnabled()
  })
}
