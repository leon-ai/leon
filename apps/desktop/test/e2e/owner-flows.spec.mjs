import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createFixture, OAUTH_PROVIDERS, TOKEN } from '../fixture.mjs'

const build = JSON.parse(await readFile(new URL('../../.artifacts/diagnostics-build.json', import.meta.url), 'utf8'))
const executablePath = process.platform === 'darwin'
  ? path.join(build.output, build.bundleName + '.app', 'Contents', 'MacOS', build.executableName)
  : path.join(build.output, build.executableName + (process.platform === 'win32' ? '.exe' : ''))
const CONVERSATION = 'A space for your ideas'
const WORKER = `process.once('message', async ({ credential }) => {
  const response = await fetch(new URL('/fixture-device/ready', process.env.LEON_SATELLITE_REMOTE_URL), {
    method: 'POST', body: JSON.stringify({ credential })
  })
  if (response.ok) {
    process.send('leon:desktop-satellite:ready')
  }
})
process.on('disconnect', () => process.exit(0))
`

/**
 * Drives the packaged app with an isolated profile and a fixture at Core's API.
 */
async function withDesktop(info, options, run) {
  const backend = await createFixture({ requireLogin: true, ...options.fixture })
  let application
  let page
  let failure
  try {
    const directory = info.outputPath('desktop')
    const configuration = path.join(directory, 'configuration.json')
    await mkdir(directory, { recursive: true })
    const root = path.join(directory, 'runtime')
    if (options.managed !== undefined) {
      const satellite = path.join(root, 'server', 'dist', 'satellite.js')
      await mkdir(path.dirname(satellite), { recursive: true })
      await writeFile(satellite, WORKER)
    }
    await writeFile(configuration, JSON.stringify({
      paint_when_hidden: true,
      ...(options.managed !== undefined ? { deviceRuntime: { root, node: process.execPath, managed: options.managed } } : {})
    }))
    application = await electron.launch({
      executablePath,
      chromiumSandbox: true,
      args: process.platform === 'linux' ? ['--ozone-platform=x11'] : [],
      env: { ...process.env, LEON_HOME: path.join(directory, 'core-home'),
        LEON_DESKTOP_SERVER: backend.origin, LEON_DESKTOP_BACKGROUND: '1',
        LEON_DESKTOP_DIAGNOSTIC_CONFIG: configuration, LEON_DESKTOP_DIAGNOSTIC_DATA: directory }
    })
    await application.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    page = await application.firstWindow()
    await run({ application, page, backend })
  } catch (error) {
    failure = error
    if (page) {
      await page.screenshot({ path: info.outputPath('desktop.png'), timeout: 2_000 }).catch(() => undefined)
    }
    throw error
  } finally {
    if (application) {
      await application.context().tracing.stop(failure ? { path: info.outputPath('desktop-trace.zip') } : {})
        .catch(() => undefined)
      await application.close()
    }
    await backend.close()
  }
}

async function signIn(page) {
  await page.getByLabel('Profile token').fill(TOKEN)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeVisible()
}

test('connects native and MCP accounts from their cards in a separate browser', async ({ browser }, info) => {
  await withDesktop(info, { fixture: { connections: true } }, async ({ application, page }) => {
    // The OS owns browser selection. Capture only that boundary and navigate in
    // a separate browser process with its own cookies and BroadcastChannel.
    await application.evaluate(({ shell }) => {
      globalThis.openedOAuthURLs = []
      shell.openExternal = async (url) => {
        globalThis.openedOAuthURLs.push(url)
      }
    })
    await signIn(page)
    await page.getByRole('link', { name: CONVERSATION, exact: true }).first().click()
    await expect(page).toHaveURL(/\/session\/welcome$/)
    const external = await browser.newPage()
    let attempts = 0
    const connect = async (card, name) => {
      await card.getByRole('button', { name: `Connect ${name}` }).click()
      const expected = ++attempts
      await expect.poll(() => application.evaluate(() => globalThis.openedOAuthURLs.length)).toBe(expected)
      const url = await application.evaluate(() => globalThis.openedOAuthURLs.at(-1))
      await external.goto(url)
      expect(application.windows()).toHaveLength(1)
    }
    try {
      for (const [index, name] of Object.values(OAUTH_PROVIDERS).entries()) {
        const card = page.getByRole('region', { name, exact: true })
        await connect(card, name)
        if (index === 0) {
          await card.getByRole('button', { name: 'Cancel sign-in' }).click()
          await expect(card.getByText('Sign-in was cancelled. You can try again.')).toBeVisible()
        } else {
          await external.getByRole('link', { name: 'Deny access' }).click()
          await expect(card.getByText('Sign-in was cancelled. You can try again.')).toBeVisible()
        }
        await connect(card, name)
        await external.getByRole('link', { name: 'Authorize test account' }).click()
        await expect(external.getByText('You can return to Leon and close this tab.')).toBeVisible()
        await expect(card.getByRole('status').getByText('Connected', { exact: true })).toBeVisible()
      }
      await expect(page).toHaveURL(/\/session\/welcome$/)
    } finally {
      await external.close()
    }
  })
})

test('sends and stops a turn with an attachment and reopens the conversation', async () => {
  await withDesktop(test.info(), { fixture: { streamDelay: 10_000 } }, async ({ page, backend }) => {
    await signIn(page)
    const chooseFile = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add files', exact: true }).click()
    await (await chooseFile).setFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('A note for Leon.') })
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    await composer.fill('Read my attached note.')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page).toHaveURL(/\/session\//)
    const session = page.url()
    await page.getByRole('button', { name: 'Stop this turn' }).click()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
    expect(backend.uploads.some((upload) => upload.complete && upload.bytes === 16)).toBe(true)
    await page.getByRole('link', { name: 'New session' }).click()
    await expect(page).not.toHaveURL(session)
    await page.getByRole('link', { name: 'A fresh conversation', exact: true }).first().click()
    await expect(page).toHaveURL(session)
    await expect(page.getByText('Read my attached note.', { exact: true })).toBeVisible()
    const answer = page.getByRole('region', { name: 'Leon’s final answer' })
    await expect(answer.getByText('Stopped by you.', { exact: true })).toBeVisible()
  })
})

for (const managed of [true, false]) {
  test(`selects the local device automatically after ${managed ? 'managed' : 'remote'} Core setup`, async () => {
    await withDesktop(test.info(), { managed, fixture: { devices: true } }, async ({ application, page, backend }) => {
      await application.evaluate(({ dialog }) => {
        globalThis.devicePrompts = []
        dialog.showMessageBox = async (_window, options) => {
          globalThis.devicePrompts.push(options.message)
          return { response: 1, checkboxChecked: false }
        }
      })
      expect(backend.grants.size).toBe(0)
      if (!managed) {
        await expect(page.getByText(backend.origin, { exact: true })).toBeVisible()
        const access = page.getByRole('checkbox', { name: /allow computer use on this computer/i })
        await expect(access).not.toBeChecked()
        await access.check()
      }
      await signIn(page)
      await expect.poll(() => [...backend.grants.values()].some((grant) => grant.online)).toBe(true)
      const composer = page.getByRole('textbox', { name: 'Message Leon' })
      await composer.fill('Use Computer Use to inspect this desktop.')
      await composer.press('Enter')
      await expect(page.getByText('Hello from the fixture.')).toBeVisible()
      expect(await application.evaluate(() => globalThis.devicePrompts)).toEqual([])
      const [grant] = backend.grants.values()
      expect([...backend.grants.values()]).toHaveLength(1)
      expect(grant.tools).toEqual(['computer_use.cua'])
      expect(backend.deviceTurns).toEqual([grant.id])
      await composer.fill('Continue inspecting the same desktop.')
      await composer.press('Enter')
      await expect.poll(() => backend.deviceTurns).toEqual([grant.id, grant.id])
      expect(await application.evaluate(() => globalThis.devicePrompts.length)).toBe(0)
    })
  })
}

test('asks for remote computer-use permission from chat only after the owner clicks', async () => {
  await withDesktop(test.info(), { managed: false, fixture: { devices: true } }, async ({ application, page, backend }) => {
    await application.evaluate(({ dialog }) => {
      globalThis.devicePrompts = []
      dialog.showMessageBox = async (_window, options) => {
        globalThis.devicePrompts.push(options.message)
        return { response: globalThis.devicePrompts.length === 1 ? 1 : 0, checkboxChecked: false }
      }
    })
    await signIn(page)
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    await composer.fill('Use Computer Use to inspect this desktop.')
    await composer.press('Enter')
    const enable = page.getByRole('button', { name: 'Enable computer use' })
    await expect(enable).toBeVisible()
    expect(await application.evaluate(() => globalThis.devicePrompts)).toEqual([])
    expect(backend.grants.size).toBe(0)
    await enable.click()
    await expect(enable).toBeEnabled()
    expect(backend.grants.size).toBe(0)
    expect(await application.evaluate(() => globalThis.devicePrompts.length)).toBe(1)

    await enable.click()
    await expect(page.getByText('I can use this computer now. Send your request again.')).toBeVisible()
    const [grant] = backend.grants.values()
    expect(backend.deviceTurns).toEqual([null])
    expect(grant.online).toBe(true)
    await composer.fill('Continue inspecting the same desktop.')
    await composer.press('Enter')
    await expect.poll(() => backend.deviceTurns).toEqual([null, grant.id])
  })
})
