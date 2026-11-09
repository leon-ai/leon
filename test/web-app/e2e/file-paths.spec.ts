import type { Route } from '@playwright/test'
import { test, expect, finishFiniteAnimations, SESSION_ID, SESSION_URL } from './fixtures'

const PATH = '/workspace/My notes & ideas/config.json'
const WINDOWS_PATH = String.raw`C:\Work\my_project\notes.txt`
const MARKDOWN_PATH = '/workspace/_draft_/plan [final].md'
const OTHER_MARKDOWN_PATH = '/workspace/_notes_/summary.txt'

for (const [theme, reducedMotion] of [['dark', 'no-preference'], ['light', 'reduce']] as const) {
  test(`renders saved path references with explicit host actions and literal code examples (${theme})`, async ({ page, ui }, testInfo) => {
    const requests: string[] = []
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string): Promise<void> => {
          document.documentElement.dataset['copiedPath'] = text
        }
      } })
    })
    await page.route('**/api/v1/open-path', async (route) => {
      requests.push((route.request().postDataJSON() as { path: string }).path)
      await route.fulfill({ json: { success: true } })
    })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.message = `Read [FILE_PATH]${PATH}[/FILE_PATH].\n\nAlso check \`[FILE_PATH]${WINDOWS_PATH}[/FILE_PATH]\`.\n\nDraft: [FILE_PATH]${MARKDOWN_PATH}[/FILE_PATH] and [FILE_PATH]${OTHER_MARKDOWN_PATH}[/FILE_PATH].\n\n\`\`\`text\n[FILE_PATH]/example/literal.txt[/FILE_PATH]\n\`\`\``
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    const body = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
    const open = body.getByRole('button', { name: `Open ${PATH} on Leon’s host`, exact: true })
    await expect(open).toBeVisible()
    await expect(body.getByRole('button', { name: `Open ${WINDOWS_PATH} on Leon’s host`, exact: true })).toBeVisible()
    await expect(body.getByRole('button', { name: `Open ${MARKDOWN_PATH} on Leon’s host`, exact: true })).toBeVisible()
    await expect(body.getByRole('button', { name: `Open ${OTHER_MARKDOWN_PATH} on Leon’s host`, exact: true })).toBeVisible()
    await expect(body.getByRole('button', { name: 'Copy path', exact: true })).toHaveCount(4)
    await expect(body.getByText('[FILE_PATH]/example/literal.txt[/FILE_PATH]', { exact: true })).toBeVisible()
    expect(requests).toEqual([])
    await open.hover()
    await expect(page.getByRole('tooltip').filter({ hasText: PATH })).toContainText('Open on Leon’s host')
    await body.getByRole('button', { name: 'Copy path', exact: true }).first().click()
    await expect(page.locator('html')).toHaveAttribute('data-copied-path', PATH)
    expect(requests).toEqual([])
    await open.click()
    await expect(page.getByText('I opened the path on my host', { exact: true })).toBeVisible()
    expect(requests).toEqual([PATH])
    await page.reload()
    await expect(open).toBeVisible()
    expect(requests).toEqual([PATH])
    await page.setViewportSize({ width: 390, height: 844 })
    await finishFiniteAnimations(page.locator('body'))
    await expect(open).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`file-paths-${theme}.png`), fullPage: true })
  })
}

test('keeps streamed path fragments inert until their closing delimiter arrives', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  const event = { session_id: SESSION_ID, turn_id: null, response_id: answer.messageId, created_at: Date.now() }
  answer.message = ''
  answer.isAddedToHistory = false
  await page.reload()
  const body = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await ui.emit([{ ...event, sequence: 1, type: 'text_stream', data: {
    kind: 'answer', generationId: 'paths', token: 'Here it is: [FILE_' } }])
  await expect(body).not.toContainText('[FILE_')
  await ui.emit([{ ...event, sequence: 2, type: 'text_stream', data: {
    kind: 'answer', generationId: 'paths', token: `PATH]${PATH}[/FI` } }])
  await expect(body).toContainText(PATH)
  await expect(body).not.toContainText('[/FI')
  await expect(body.getByRole('button', { name: 'Copy path', exact: true })).toHaveCount(0)
  await ui.emit([{ ...event, sequence: 3, type: 'text_stream', data: {
    kind: 'answer', generationId: 'paths', token: 'LE_PATH]. Ready.' } }])
  await expect(body.getByRole('button', { name: `Open ${PATH} on Leon’s host`, exact: true })).toBeVisible()
  await expect(body).toContainText('Ready.')
})

test('reports a rejected host open once without automatically replaying it', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = `[FILE_PATH]${PATH}[/FILE_PATH]`
  const pending = Promise.withResolvers<Route>()
  let requests = 0
  await page.route('**/api/v1/open-path', async (route) => {
    requests += 1
    pending.resolve(route)
  })
  await page.goto(SESSION_URL)
  const open = page.getByRole('button', { name: `Open ${PATH} on Leon’s host`, exact: true })
  await open.click()
  const route = await pending.promise
  await expect(open).toBeDisabled()
  await route.fulfill({ status: 404, json: { success: false, error: 'Path does not exist' } })
  await expect(page.locator('.toast-error')).toHaveCount(1)
  await expect(page.getByText('This path is no longer available on my host. You can still copy it.', { exact: true })).toBeVisible()
  await expect(open).toBeEnabled()
  expect(requests).toBe(1)
})
