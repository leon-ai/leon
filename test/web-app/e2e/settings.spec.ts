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
