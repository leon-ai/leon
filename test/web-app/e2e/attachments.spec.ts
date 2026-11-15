import type { Page, JSHandle } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

import { test, expect, SESSION_URL, finishFiniteAnimations } from './fixtures'

const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const TEXT = { name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('A quiet afternoon.') }

async function pasteFiles(page: Page, files: { name: string, type: string, size?: number }[]): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Leon' }).evaluate((element, entries) => {
    const clipboard = new DataTransfer()
    for (const entry of entries) {
      const file = new File(['notes'], entry.name, { type: entry.type })
      if (entry.size !== undefined) {
        Object.defineProperty(file, 'size', { value: entry.size })
      }
      clipboard.items.add(file)
    }
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  }, files)
}

async function fileTransfer(page: Page, name: string): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle((filename) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['notes'], filename, { type: 'text/plain' }))
    return transfer
  }, name)
}

async function folderTransfer(page: Page, options: { files?: number, rejected?: number, delayed?: boolean, directories?: number } = {}): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle((settings) => {
    const file = (name: string): object => ({
      isFile: true, isDirectory: false,
      file: (resolve: (value: File) => void): void => {
        const finish = (): void => resolve(new File(['notes'], name, { type: 'text/plain' }))
        if (settings.delayed) {
          Reflect.set(window, 'finishFolderRead', finish)
        } else {
          queueMicrotask(finish)
        }
      }
    })
    const directory = (pages: object[][]): object => ({
      isDirectory: true, isFile: false,
      createReader: (): { readEntries: (resolve: (entries: object[]) => void) => void } => {
        let pageIndex = 0
        return { readEntries: (resolve: (entries: object[]) => void): void => {
          queueMicrotask(() => resolve(pages[pageIndex++] ?? []))
        } }
      }
    })
    const root = directory([
      Array.from({ length: settings.rejected ?? 0 }, (_, index) => file(`Rejected-${index}.png`)),
      [directory([[
        ...Array.from({ length: settings.directories ?? 0 }, () => directory([])),
        ...Array.from({ length: settings.files ?? 2 }, (_, index) => file(`Nested-${index}.txt`))
      ]])]
    ].filter((entries) => entries.length))
    const transfer = new DataTransfer()
    transfer.items.add(new File([''], 'Folder'))
    Object.defineProperty(transfer, 'items', { value: [
      { kind: 'file', webkitGetAsEntry: (): object => root }
    ] })
    return transfer
  }, options)
}

for (const theme of ['light', 'dark']) {
  test(`selects multiple files, keeps square previews and sends binary uploads (${theme})`, async ({ page, ui }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('leon.web-app.theme', value), theme)
    await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' })
    await page.goto(SESSION_URL)
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add files', exact: true }).click()
    const chooser = await chooserPromise
    expect(chooser.isMultiple()).toBe(true)
    await chooser.setFiles([{ name: 'Photo.png', mimeType: 'image/png', buffer: IMAGE }, TEXT])
    const files = page.getByRole('form', { name: 'Send a message to Leon' }).getByRole('list', { name: 'Attached files' })
    await expect(files.getByRole('listitem')).toHaveCount(2)
    await expect(files.getByRole('link', { name: 'Open', exact: true })).toHaveCount(0)
    await expect(files.getByRole('link')).toHaveCount(0)
    await expect(files.getByRole('button', { name: /^Copy/ })).toHaveCount(0)
    await expect(files.getByText('Notes.txt', { exact: true })).toBeVisible()
    await expect(page.getByRole('menu', { name: 'Add attachments', exact: true })).toHaveCount(0)
    await expect(page.locator('input[type=file]')).toHaveCount(1)
    await expect(files.locator('[title]')).toHaveCount(0)
    const badge = files.getByRole('listitem').first().locator('.aurora-artifact-icon')
    await expect(badge).toBeVisible()
    await expect(files.getByRole('img', { name: 'Photo.png' })).toBeVisible()
    await finishFiniteAnimations(page.getByRole('form', { name: 'Send a message to Leon' }))
    const geometry = await files.getByRole('listitem').first().boundingBox()
    expect(geometry!.width).toBe(geometry!.height)
    expect(geometry!.width).toBe(128)
    const badgeBounds = await badge.boundingBox()
    expect(badgeBounds!.x - geometry!.x).toBeLessThan(16)
    expect(geometry!.y + geometry!.height - badgeBounds!.y - badgeBounds!.height).toBeLessThan(16)
    const field = await page.getByRole('textbox', { name: 'Message Leon' }).boundingBox()
    expect(field!.y).toBeGreaterThanOrEqual(geometry!.y + geometry!.height)
    await page.screenshot({ path: testInfo.outputPath(`attachments-${theme}.png`) })
    await files.getByRole('button', { name: 'Enlarge Photo.png', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Photo.png', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Photo.png', exact: true })).toHaveCount(0)
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    await composer.fill('Read these files.')
    const delivered = page.waitForRequest((request) => request.url().endsWith('/messages') && request.method() === 'POST')
    await composer.press('Enter')
    const body = (await delivered).postDataJSON() as { attachments: string[], query: string }
    expect(body.query).toBe('Read these files.')
    expect(body.attachments).toEqual(ui.uploads.map((file) => file.id))
    expect(ui.uploads.map((file) => file.size_bytes)).toEqual([IMAGE.length, TEXT.buffer.length])
    await expect(files).toHaveCount(0)
    await expect(composer).toHaveValue('')
    await page.reload()
    await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('listitem')).toHaveCount(2)
    const owner = page.getByRole('article').filter({ has: page.getByText('Read these files.', { exact: true }) })
    const savedFiles = owner.getByRole('list', { name: 'Attached files' })
    const text = owner.getByText('Read these files.', { exact: true })
    const fileBounds = await savedFiles.boundingBox()
    const textBounds = await text.boundingBox()
    expect(fileBounds!.y + fileBounds!.height).toBeLessThanOrEqual(textBounds!.y)
    expect(Math.abs(fileBounds!.x + fileBounds!.width - textBounds!.x - textBounds!.width)).toBeLessThan(1)
    const toolbar = owner.getByRole('group', { name: 'Owner message actions' })
    await savedFiles.getByRole('img', { name: 'Photo.png', exact: true }).hover()
    await expect(savedFiles.getByRole('link')).toHaveCount(0)
    await expect(savedFiles.getByRole('button', { name: /^Copy/ })).toHaveCount(0)
    await expect(savedFiles.getByText('Notes.txt', { exact: true })).toBeVisible()
    await expect(savedFiles.locator('.aurora-artifact-icon')).toHaveCount(2)
    await expect(toolbar).toHaveCSS('opacity', '1')
    await expect(toolbar.locator('time')).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Copy message' })).toBeVisible()
    await text.hover()
    await expect(toolbar).toHaveCSS('opacity', '1')
    await page.screenshot({ path: testInfo.outputPath(`owner-attachments-${theme}.png`) })
    await savedFiles.getByRole('button', { name: 'Enlarge Photo.png', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Photo.png', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Photo.png', exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(composer).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
}

test('selects, pastes and drops source and configuration files as text previews', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files', exact: true }).click()
  const chooser = await chooserPromise
  await expect(page.getByLabel('Choose attachments', { exact: true })).not.toHaveAttribute('accept')
  const sources = [
    { name: 'index.mjs', mimeType: 'application/javascript', text: 'export const greeting = "Hello"' },
    { name: 'main.rs', mimeType: 'text/x-rust', text: 'fn main() {}' },
    { name: 'main.ts', mimeType: 'video/mp2t', text: 'const answer: number = 42' },
    { name: 'Dockerfile', mimeType: '', text: 'FROM scratch' },
    { name: '.env.local', mimeType: 'text/plain', text: 'EXAMPLE=value' },
    { name: 'Page.html', mimeType: 'text/html', text: '<script>globalThis.attachmentExecuted = true</script>' }
  ]
  await chooser.setFiles(sources.map(({ text, ...file }) => ({ ...file, buffer: Buffer.from(text) })))
  const files = page.getByRole('form', { name: 'Send a message to Leon' }).getByRole('list', { name: 'Attached files' })
  for (const file of sources) {
    const preview = files.getByRole('figure', { name: file.name, exact: true })
    await expect(preview).toBeVisible()
    await expect(preview).toContainText(file.text)
  }
  await pasteFiles(page, [{ name: 'Notes.custom-format', type: 'application/octet-stream' }])
  const transfer = await fileTransfer(page, 'Makefile')
  await page.getByRole('main').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(files.getByRole('listitem')).toHaveCount(8)
  expect(await page.evaluate(() => Reflect.get(window, 'attachmentExecuted'))).toBeUndefined()
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(files).toHaveCount(0)
  expect(ui.uploads.map((file) => file.filename)).toEqual([...sources.map((file) => file.name), 'Notes.custom-format', 'Makefile'])
  expect(ui.uploads.every((file) => file.mime_type === 'text/plain')).toBe(true)
  await transfer.dispose()
})

test('shares video first-frame previews and native media dialogs with artifacts', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles([
    'test/fixtures/artifacts/a-quiet-moment.webm',
    'test/fixtures/artifacts/a-soft-note.wav'
  ])
  const files = page.getByRole('list', { name: 'Attached files' })
  const video = files.locator('video')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused && element.currentTime > 0 && element.videoWidth > 0)).toBe(true)
  for (const name of ['a-quiet-moment.webm', 'a-soft-note.wav']) {
    await files.getByRole('button', { name: `Play ${name}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name, exact: true })
    await expect(dialog).toBeVisible()
    const player = dialog.locator('video, audio')
    await expect(player).toHaveJSProperty('controls', true)
    await expect(player).toHaveAttribute('controlslist', 'nodownload')
    await player.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  expect(ui.uploads).toHaveLength(0)
})

test('uploads selected disk files without exposing their source paths', async ({ page, ui }, testInfo) => {
  const directory = testInfo.outputPath('Selected folder')
  await fs.mkdir(path.join(directory, 'Nested'), { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(directory, 'Notes.txt'), 'Top-level notes'),
    fs.writeFile(path.join(directory, 'Nested', 'Notes.txt'), 'Nested notes')
  ])
  await page.goto(SESSION_URL)
  const trigger = page.getByRole('button', { name: 'Add files', exact: true })
  const chooserPromise = page.waitForEvent('filechooser')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await (await chooserPromise).setFiles([
    path.join(directory, 'Notes.txt'), path.join(directory, 'Nested', 'Notes.txt')
  ])
  await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  expect(ui.uploads).toHaveLength(0)
  // Disk-backed browser files are sent to the real HTTP sink: DevTools does not
  // expose their body bytes to Playwright's intercepted-request fixtures.
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  let uploadIndex = 0
  await page.route('**/sessions/*/attachments?**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('filename')).toBe('Notes.txt')
    url.searchParams.set('session_id', ui.sessions[0]!.id)
    url.pathname = `/__ui/uploads/${ids[uploadIndex++]}`
    await route.continue({ url: url.toString() })
  })
  await page.route('**/sessions/*/messages', async (route) => {
    expect(route.request().postDataJSON().attachments).toEqual(ids)
    const body = route.request().postDataJSON() as { id: string }
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ command: { id: body.id, status: 'accepted' } }) })
  })
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const sizes: number[] = []
  for (const id of ids) {
    await expect.poll(async () => (await (await page.request.get(`/__ui/uploads/${id}`)).json()).ready).toBe(true)
    sizes.push((await (await page.request.get(`/__ui/uploads/${id}`)).json()).received)
    expect((await page.request.post(`/__ui/uploads/${id}/complete`)).status()).toBe(204)
  }
  expect(sizes.sort((a, b) => a - b)).toEqual([12, 15])
  await expect(page.getByRole('form', { name: 'Send a message to Leon' }).getByRole('list', { name: 'Attached files' })).toHaveCount(0)
})

test('drains folder pages and subfolders, reports skipped files once and respects the remaining attachment slots', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles(TEXT)
  const transfer = await folderTransfer(page, { rejected: 100, files: 30 })
  const main = page.getByRole('main')
  await main.dispatchEvent('dragenter', { dataTransfer: transfer })
  await main.dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('listitem')).toHaveCount(20)
  await expect(page.getByRole('button', { name: 'Remove Nested-18.txt', exact: true })).toBeVisible()
  await expect(page.locator('.toast-warning')).toHaveCount(1)
  await expect(page.locator('.toast-warning')).toContainText('up to 20 files')
  await expect(page.getByRole('status').filter({ hasText: 'I’m reading the folder' })).toHaveCount(0)
  expect(ui.uploads).toHaveLength(0)
  await transfer.dispose()
})

test('bounds folder traversal and discards pending reads when leaving the session', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const main = page.getByRole('main')
  const large = await folderTransfer(page, { directories: 2_001 })
  await main.dispatchEvent('drop', { dataTransfer: large })
  await expect(page.locator('.toast-warning')).toContainText('Please choose a smaller folder')
  await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0)
  const delayed = await folderTransfer(page, { files: 1, delayed: true })
  await main.dispatchEvent('drop', { dataTransfer: delayed })
  await expect(page.getByRole('status').filter({ hasText: 'I’m reading the folder' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message Leon' }).fill('Keep drafting while reading')
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
  await page.getByRole('link', { name: 'New session', exact: true }).click()
  await page.evaluate(() => Reflect.get(window, 'finishFolderRead')())
  await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'I’m reading the folder' })).toHaveCount(0)
  expect(ui.uploads).toHaveLength(0)
  await large.dispose()
  await delayed.dispose()
})

test('pastes files without interrupting text input and can remove and reselect a file', async ({ page, ui }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    const urls = new Set<string>()
    Reflect.set(window, 'attachmentPreviewUrls', urls)
    URL.createObjectURL = (blob): string => {
      const url = create(blob)
      urls.add(url)
      return url
    }
    URL.revokeObjectURL = (url): void => {
      urls.delete(url)
      revoke(url)
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this text')
  await pasteFiles(page, [{ name: 'Notes.txt', type: 'text/plain' }])
  await expect(composer).toHaveValue('Keep this text')
  await expect(page.getByRole('button', { name: 'Remove Notes.txt' })).toBeVisible()
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles({ name: 'Image.png', mimeType: 'image/png', buffer: IMAGE })
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'attachmentPreviewUrls') as Set<string>).size)).toBe(2)
  await page.getByRole('button', { name: 'Remove Image.png' }).click()
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'attachmentPreviewUrls') as Set<string>).size)).toBe(1)
  await page.getByRole('button', { name: 'Remove Notes.txt' }).click()
  await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0)
  expect(ui.uploads).toHaveLength(0)
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles(TEXT)
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles({ name: 'Image.png', mimeType: 'image/png', buffer: IMAGE })
  await expect(page.getByRole('button', { name: 'Remove Notes.txt' })).toBeVisible()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'attachmentPreviewUrls') as Set<string>).size)).toBe(0)
})

test('shows a stable drop zone throughout the main body and excludes the sidebar and text drags', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['notes'], 'Dropped.txt', { type: 'text/plain' }))
    return transfer
  })
  const main = page.getByRole('main')
  await main.dispatchEvent('dragenter', { dataTransfer: data })
  const zone = page.getByRole('status').filter({ hasText: 'Drop files to attach' })
  await expect(zone).toBeVisible()
  const nested = page.getByRole('textbox', { name: 'Message Leon' })
  await nested.dispatchEvent('dragenter', { dataTransfer: data })
  await nested.dispatchEvent('dragleave', { dataTransfer: data })
  await expect(zone).toBeVisible()
  await main.dispatchEvent('drop', { dataTransfer: data })
  await expect(zone).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove Dropped.txt' })).toBeVisible()
  await page.locator('.sidebar').dispatchEvent('dragenter', { dataTransfer: data })
  await page.locator('.sidebar').dispatchEvent('drop', { dataTransfer: data })
  await expect(zone).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('listitem')).toHaveCount(1)
  await main.dispatchEvent('dragenter', { dataTransfer: data })
  await main.dispatchEvent('dragleave', { dataTransfer: data })
  await expect(zone).toHaveCount(0)
  const text = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'A selected paragraph')
    return transfer
  })
  await main.dispatchEvent('dragenter', { dataTransfer: text })
  await expect(zone).toHaveCount(0)
  await data.dispose()
  await text.dispose()
  expect(ui.uploads).toHaveLength(0)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`blurs the feed, accepts files immediately and releases interrupted drop feedback (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem('leon.web-app.theme', theme), reducedMotion === 'reduce' ? 'light' : 'dark')
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const main = page.getByRole('main')
    const transfer = await fileTransfer(page, 'First.txt')
    const next = await fileTransfer(page, 'Second.txt')
    const zone = page.getByRole('status').filter({ hasText: 'Drop files to attach' })
    const feedback = page.getByRole('status').filter({ hasText: 'I’ve attached 1 file' })
    await main.dispatchEvent('dragenter', { dataTransfer: transfer })
    await expect(zone).toBeVisible()
    await finishFiniteAnimations(zone)
    const backdrop = await zone.evaluate((element) => {
      const style = getComputedStyle(element)
      return { blur: style.backdropFilter, background: style.backgroundColor }
    })
    expect(backdrop.blur).toContain('blur(')
    expect(backdrop.background).toMatch(/rgba\(.+, 0\.\d+\)/)
    await page.screenshot({ path: testInfo.outputPath(`drop-hover-${reducedMotion}.png`) })
    await main.dispatchEvent('drop', { dataTransfer: transfer })
    await expect(page.getByRole('button', { name: 'Remove First.txt', exact: true })).toBeVisible()
    if (reducedMotion === 'no-preference') {
      await expect(feedback).toBeVisible()
      await page.evaluate(() => window.dispatchEvent(new DragEvent('dragend')))
      await expect(feedback).toBeVisible()
      // Reopening must invalidate the preceding close rather than let its
      // animation completion remove the new drag's overlay.
      await main.dispatchEvent('dragenter', { dataTransfer: next })
      await expect(zone).toBeVisible()
      await finishFiniteAnimations(zone)
      await expect(zone).toBeVisible()
    } else {
      await expect(feedback).toHaveCount(0)
      await main.dispatchEvent('dragenter', { dataTransfer: next })
      await expect(zone).toBeVisible()
      expect(await zone.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
    }
    await main.dispatchEvent('drop', { dataTransfer: next })
    await expect(page.getByRole('button', { name: 'Remove Second.txt', exact: true })).toBeVisible()
    await expect(feedback).toHaveCount(0)
    await expect(zone).toHaveCount(0)
    const rejected = await fileTransfer(page, 'Rejected.png')
    await main.dispatchEvent('dragenter', { dataTransfer: rejected })
    await expect(zone).toBeVisible()
    await main.dispatchEvent('drop', { dataTransfer: rejected })
    await expect(feedback).toHaveCount(0)
    await expect(zone).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('listitem')).toHaveCount(2)
    await transfer.dispose()
    await next.dispose()
    await rejected.dispose()
    expect(ui.uploads).toHaveLength(0)
  })
}

test('bounds attachments at twenty and rejects unsafe filenames, mismatched types, empty and oversized files before uploading', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await pasteFiles(page, [
    { name: 'Unsafe:stream.txt', type: 'text/plain' },
    { name: 'Fake.png', type: 'application/pdf' },
    { name: 'Empty.txt', type: 'text/plain', size: 0 },
    { name: 'Large.png', type: 'image/png', size: 20 * 1_024 * 1_024 + 1 },
    { name: 'Large.csv', type: 'text/csv', size: 50 * 1_024 * 1_024 + 1 },
    { name: 'Large.pdf', type: 'application/pdf', size: 512 * 1_024 * 1_024 + 1 }
  ])
  await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0)
  await expect(page.getByText('Some files could not be attached', { exact: true })).toBeVisible()
  await pasteFiles(page, Array.from({ length: 21 }, (_, index) => ({ name: `Notes ${index}.txt`, type: 'text/plain' })))
  const files = page.getByRole('list', { name: 'Attached files' })
  await expect(files.getByRole('listitem')).toHaveCount(20)
  await page.getByRole('button', { name: 'Remove Notes 0.txt', exact: true }).click()
  await pasteFiles(page, [{ name: 'Replacement.txt', type: 'text/plain' }])
  await expect(files.getByRole('listitem')).toHaveCount(20)
  expect(ui.uploads).toHaveLength(0)
})

test('retains the draft on upload failure and reuses uploaded receipts and message identity on retry', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles(TEXT)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Read my notes.')
  ui.failure = { path: `/api/v1/sessions/${ui.sessions[0]!.id}/messages`, status: 503, message: 'Please retry.' }
  const first = page.waitForRequest((request) => request.url().endsWith('/messages'))
  await composer.press('Enter')
  const firstBody = (await first).postDataJSON() as { id: string, attachments: string[] }
  await expect(page.getByRole('button', { name: 'Retry sending message' })).toBeVisible()
  await expect(composer).toHaveValue('Read my notes.')
  await expect(page.getByRole('button', { name: 'Remove Notes.txt' })).toBeVisible()
  ui.failure = undefined
  const retry = page.waitForRequest((request) => request.url().endsWith('/messages'))
  await page.getByRole('button', { name: 'Retry sending message' }).click()
  expect((await retry).postDataJSON()).toMatchObject(firstBody)
  expect(ui.uploads).toHaveLength(1)
})

test('marks a failed upload per file and retries without uploading completed files again', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles([TEXT, { ...TEXT, name: 'Second.txt' }])
  let reject = true
  await page.route('**/sessions/*/attachments?**', async (route) => {
    if (reject && new URL(route.request().url()).searchParams.get('filename') === 'Second.txt') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Please retry this upload.' }) })
      return
    }
    await route.fallback()
  })
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Read these notes.')
  await composer.press('Enter')
  const files = page.getByRole('form', { name: 'Send a message to Leon' }).getByRole('list', { name: 'Attached files' })
  await expect(files.getByText('Upload failed', { exact: true })).toBeVisible()
  await expect(files.getByText('Uploaded', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Read these notes.')
  await expect(page.locator('.toast-error')).toHaveCount(1)
  expect(ui.uploads.map((file) => file.filename)).toEqual(['Notes.txt'])
  reject = false
  await page.getByRole('button', { name: 'Retry sending message', exact: true }).click()
  await expect(files).toHaveCount(0)
  expect(ui.uploads.map((file) => file.filename)).toEqual(['Notes.txt', 'Second.txt'])
})

test('measures per-file progress over a slow connection and waits for server acceptance', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  let uploadIndex = 0
  let commands = 0
  await page.route('**/sessions/*/attachments?**', async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('session_id', ui.sessions[0]!.id)
    url.pathname = `/__ui/uploads/${ids[uploadIndex++]}`
    await route.continue({ url: url.toString() })
  })
  await page.route('**/sessions/*/messages', async (route) => {
    commands += 1
    const body = route.request().postDataJSON() as { id: string }
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ command: { id: body.id, status: 'accepted' } }) })
  })
  const file = { name: 'Remote.txt', mimeType: 'text/plain', buffer: Buffer.alloc(256 * 1_024, 'a') }
  await page.getByLabel('Choose attachments', { exact: true }).setInputFiles([file, { ...TEXT, name: 'Second.txt' }])
  const network = await page.context().newCDPSession(page)
  await network.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: 10 * 1_024 * 1_024, uploadThroughput: 32 * 1_024
  })
  try {
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const first = page.getByRole('listitem').filter({ has: page.getByRole('progressbar', { name: 'Uploading', exact: true }) })
    const progress = page.getByRole('progressbar', { name: 'Uploading', exact: true })
    await expect(progress).toBeVisible()
    await expect(page.getByRole('group', { name: `Upload status for ${file.name}`, exact: true })).toHaveText(/^\d+%$/)
    await expect(page.getByRole('button', { name: 'Stop this turn', exact: true })).toHaveCount(0)
    await expect.poll(async () => {
      const value = await progress.getAttribute('value')
      return Number(value) > 0 && Number(value) < file.buffer.length
    }).toBe(true)
    await page.screenshot({ path: test.info().outputPath('upload-progress.png') })
    await expect(page.getByRole('status').filter({ hasText: /^Queued$/ })).toHaveCount(1)
    expect(commands).toBe(0)
    await expect(page.getByText('Processing', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await (await page.request.get(`/__ui/uploads/${ids[0]}`)).json())).toMatchObject({ received: file.buffer.length, ready: true })
    expect(commands).toBe(0)
    await page.screenshot({ path: test.info().outputPath('upload-processing.png') })
    expect((await page.request.post(`/__ui/uploads/${ids[0]}/complete`)).status()).toBe(204)
    await expect(page.getByText('Uploaded', { exact: true })).toBeVisible()
    await expect(page.getByText('Processing', { exact: true })).toBeVisible()
    await expect.poll(async () => (await (await page.request.get(`/__ui/uploads/${ids[1]}`)).json()).ready).toBe(true)
    expect((await page.request.post(`/__ui/uploads/${ids[1]}/complete`)).status()).toBe(204)
    await expect(page.getByRole('form', { name: 'Send a message to Leon' }).getByRole('list', { name: 'Attached files' })).toHaveCount(0)
    expect(commands).toBe(1)
    await expect(first).toHaveCount(0)
  } finally {
    await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await network.detach()
  }
})

for (const query of ['', 'Read my notes.']) {
  test(`creates a session before uploading and clears the submitted draft (query: ${Boolean(query)})`, async ({ page, ui }) => {
    await page.goto('./')
    await page.getByRole('textbox', { name: 'Message Leon' }).fill(query)
    await page.getByLabel('Choose attachments', { exact: true }).setInputFiles(TEXT)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page).toHaveURL(/session\//)
    expect(ui.uploads).toHaveLength(1)
    expect(ui.uploads[0]!.session_id).toBe(ui.sessions.at(-1)!.id)
    await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('listitem')).toHaveCount(1)
    await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'New session', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveValue('')
    await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0)
  })
}
