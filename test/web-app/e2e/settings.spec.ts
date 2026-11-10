import { test, expect } from './fixtures'
import type { ToolCatalogEntry } from '../../../server/src/core/tool-manager/tool-source'
import { SETTINGS_SECTIONS } from '../../../apps/web/src/data/settings-sections'
import { CONNECTION_PREVIEWS, connectionPreviewView } from '../../fixtures/connections'
import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step } from '../../../aurora/src/contracts/connection-setup'
import { renderOAuthCompletion } from '../../../server/src/core/connections/oauth-completion'
import { CatalogMaintenance, CatalogDistribution } from '../../../server/src/schemas/catalog-metadata-schemas'

const notion: ToolCatalogEntry = { id: 'productivity_collaboration.notion', catalogId: 'productivity_collaboration.notion',
  name: 'Notion', description: 'Work with Notion pages through its official MCP server.', iconName: 'plug-line',
  kind: 'mcp', installed: false, enabled: false, connected: false, canConnect: true }

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
  await expect(page.getByRole('heading', { name: 'Tools and connections', exact: true })).toBeVisible()
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
  await expect(page.getByText('This section is being prepared.', { exact: false })).toBeVisible()
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
