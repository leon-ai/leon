import { test, expect, SESSION_ID, SESSION_URL, OTHER_SESSION_ID } from './fixtures'
import { CONNECTION_PREVIEWS, connectionPreviewView } from '../../fixtures/connections'
import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step } from '../../../aurora/src/contracts/connection-setup'
import { renderOAuthCompletion } from '../../../server/src/core/connections/oauth-completion'
import type { SessionStatus } from '../../../apps/web/src/data/sessions'

test('keeps connection credentials inside explicit setup requests and clears failed fields', async ({ page, ui }) => {
  const preview = CONNECTION_PREVIEWS['connection-ticktick']!
  ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: 'connection-ticktick', message: 'Connect TickTick to continue.',
    sentAt: Date.now(), isAddedToHistory: false, widget: { widget: 'ConnectionWidget',
      componentTree: { component: 'WidgetWrapper', props: { children: [
        { component: 'ConnectionSetup', props: { provider: preview.provider, sessionId: OTHER_SESSION_ID } }
      ] } } } })
  let view = connectionPreviewView(preview, 'api_key', Step.Choice)
  const attempts: Record<string, unknown>[] = []
  const otherBodies: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && !request.url().includes('/connections/')) {
      otherBodies.push(request.postData() ?? '')
    }
  })
  await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
    const body = route.request().postDataJSON()
    expect(body.session_id).toBe(SESSION_ID)
    if (body.action === Action.Credentials) {
      view = connectionPreviewView(preview, 'api_key', Step.Credentials)
    }
    if (body.action === Action.Connect) {
      attempts.push(body.credentials)
      if (attempts.length === 1) {
        await route.fulfill({ status: 400, json: { message: 'Rejected sample-token-one' } })
        return
      }
      view = connectionPreviewView(preview, 'api_key', Step.Connected)
    }
    await route.fulfill({ json: { view } })
  })
  await page.goto(SESSION_URL)
  const card = page.getByRole('region', { name: 'Set up TickTick', exact: true })
  await card.getByRole('button', { name: 'Connect TickTick', exact: true }).click()
  const token = card.getByLabel('access token', { exact: true })
  await expect(token).toHaveAttribute('type', 'password')
  await card.getByRole('button', { name: 'Connect TickTick', exact: true }).click()
  expect(attempts).toHaveLength(0)
  await token.fill('sample-token-one')
  await token.press('Enter')
  await expect(card.getByRole('alert')).toContainText('I couldn’t complete this step')
  await expect(token).toHaveValue('')
  await expect(page.locator('.toast-error')).toHaveCount(1)
  expect(attempts).toEqual([{ access_token: 'sample-token-one' }])
  expect(await page.locator('body').textContent()).not.toContain('sample-token-one')
  expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain('sample-token-one')
  await token.fill('sample-token-two')
  await card.getByRole('button', { name: 'Connect TickTick', exact: true }).click()
  await expect(page.getByRole('region', { name: 'TickTick', exact: true }).getByRole('status')).toContainText('Connected')
  expect(attempts).toHaveLength(2)
  expect(otherBodies.join(' ')).not.toContain('sample-token')
  await page.reload()
  await expect(page.getByRole('region', { name: 'TickTick', exact: true }).getByRole('status')).toContainText('Connected')
  expect(attempts).toHaveLength(2)
})

test('sends guided setup through ordinary owner commands and retains retry identity', async ({ page, ui }) => {
  const preview = CONNECTION_PREVIEWS['connection-ticktick']!
  ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: 'connection-ticktick', message: '', sentAt: Date.now(),
    isAddedToHistory: false, widget: { widget: 'ConnectionWidget', connection: preview } })
  let view = connectionPreviewView(preview, 'oauth', Step.Choice)
  const commands: Array<{ id: string, query: string }> = []
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
    const body = route.request().postDataJSON()
    commands.push(body)
    if (commands.length === 1) {
      await route.fulfill({ status: 503, json: { message: 'Delivery not confirmed.' } })
      return
    }
    view = connectionPreviewView(preview, 'oauth', Step.Assisted)
    await route.fulfill({ json: { command: { id: body.id, query: body.query, status: 'accepted' } } })
  })
  await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
    const body = route.request().postDataJSON()
    expect(body.state?.method ?? 'oauth').toBe('oauth')
    if (body.action === Action.Credentials) {
      view = connectionPreviewView(preview, 'oauth', Step.Credentials)
    }
    await route.fulfill({ json: { view: body.action === Action.StartSetup ? connectionPreviewView(preview, 'oauth', Step.Assisted) : view,
      ...(body.action === Action.StartSetup ? { event: { methodName: 'send_utterance', session_id: SESSION_ID,
        methodParams: { from: 'owner', utterance: 'Help me connect TickTick using my browser, then continue my request.' } } } : {}) } })
  })
  await page.goto(SESSION_URL)
  const card = page.getByRole('region', { name: 'Set up TickTick', exact: true })
  await card.getByRole('button', { name: 'Connect TickTick', exact: true }).click()
  await expect(card.getByLabel('Client ID', { exact: true })).toBeVisible()
  expect(commands).toHaveLength(0)
  await card.getByRole('button', { name: 'Set it up for me', exact: true }).click()
  await expect(card.getByRole('alert')).toBeVisible()
  await card.getByRole('button', { name: 'Set it up for me', exact: true }).click()
  await expect(card.getByText('You can follow setup progress in the conversation.', { exact: true })).toBeVisible()
  expect(commands).toHaveLength(2)
  expect(commands[0]!.id).toBe(commands[1]!.id)
  await page.reload()
  await expect(card.getByText('You can follow setup progress in the conversation.', { exact: true })).toBeVisible()
  expect(commands).toHaveLength(2)
})

for (const name of ['notion', 'spotify']) {
  for (const result of ['connected', 'failed'] as const) {
    test(`returns from ${name} authorization with ${result} status without leaving the conversation`, async ({ page, ui, context }) => {
      const preview = CONNECTION_PREVIEWS[`connection-${name}`]!
      const configured = name === 'notion'
      ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: `connection-${name}`, message: '', sentAt: Date.now(),
        isAddedToHistory: false, widget: { widget: 'ConnectionWidget', connection: preview } })
      let view = connectionPreviewView(preview, 'oauth', configured ? Step.Choice : Step.Credentials, configured)
      let callback = ''
      let returned = false
      let cancelled = false
      await context.route('**/oauth-fixture', async (route) => {
        await route.fulfill({ contentType: 'text/html', headers: { 'Cross-Origin-Opener-Policy': 'same-origin' },
          body: `<a href="${callback}">Authorize test account</a>` })
      })
      await context.route('**/api/v1/connections/complete?**', async (route) => {
        const completion = renderOAuthCompletion(Object.fromEntries(new URL(route.request().url()).searchParams))!
        await route.fulfill({ contentType: 'text/html', body: completion.html,
          headers: { 'Content-Security-Policy': completion.contentSecurityPolicy } })
      })
      await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
        const body = route.request().postDataJSON()
        if (body.action === Action.Connect) {
          expect(body.credentials).toEqual(configured ? {} : { client_id: 'sample-client' })
          const destination = new URL(body.return_url)
          destination.searchParams.set('provider', preview.provider)
          destination.searchParams.set('connection_result', result)
          callback = destination.toString()
          returned = true
          // The provider origin differs from the conversation, as in real OAuth.
          await route.fulfill({ json: { view, authorization_url: `${destination.origin.replace('127.0.0.1', 'localhost')}/oauth-fixture` } })
          return
        }
        if (returned) {
          cancelled = body.authorization_failed
          view = connectionPreviewView(preview, 'oauth', result === 'connected' ? Step.Connected : 'cancelled', configured)
        }
        await route.fulfill({ json: { view } })
      })
      await page.goto(SESSION_URL)
      const card = page.getByRole('region', { name: `Set up ${preview.name}`, exact: true })
      await expect(card.locator('input[type="password"]')).toHaveCount(0)
      if (configured) {
        await expect(card.locator('input')).toHaveCount(0)
      } else {
        await card.getByLabel('Client ID', { exact: true }).fill('sample-client')
      }
      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        card.getByRole('button', { name: `Connect ${preview.name}`, exact: true }).click()
      ])
      await expect(popup).toHaveURL(/\/oauth-fixture$/)
      await expect(page).toHaveURL(new RegExp(`${SESSION_ID}$`))
      expect(await popup.evaluate(() => window.opener)).toBeNull()
      if (!configured) {
        await expect(card.getByLabel('Client ID', { exact: true })).toHaveValue('')
      }
      await popup.getByRole('link', { name: 'Authorize test account', exact: true }).click()
      await expect.poll(() => popup.isClosed()).toBe(true)
      if (result === 'connected') {
        await expect(page.getByRole('region', { name: preview.name, exact: true }).getByRole('status')).toContainText('Connected')
      } else {
        await expect(card.getByRole('status')).toContainText('Authorization was cancelled')
      }
      await expect.poll(() => new URL(page.url()).searchParams.has('connection_result')).toBe(false)
      expect(cancelled).toBe(result === 'failed')
      expect(new URL(page.url()).searchParams.has('connection_method')).toBe(false)
      await expect(page.locator('.toast-success')).toHaveCount(result === 'connected' ? 1 : 0)
    })
  }
}

for (const explicit of [false, true]) {
  test(`keeps connection cards in their final answer through streaming and replay (explicit ownership: ${explicit})`, async ({ page, ui }) => {
    const preview = CONNECTION_PREVIEWS['connection-notion']!
    const responseId = 'connection-owner:leon'
    const startedAt = Date.now()
    const owner = { who: 'owner' as const, messageId: 'connection-owner', message: 'Read my Notion pages.',
      sentAt: startedAt, isAddedToHistory: true }
    const answer = { who: 'leon' as const, messageId: responseId, message: '', sentAt: startedAt + 1,
      isAddedToHistory: false, agentResponseTrace: { id: responseId, planSteps: [], toolCalls: [],
        reasoning: [{ id: 'connection-thought', text: 'Check account access.', phase: 'reasoning', startedAt }],
        metrics: { durationMs: 1_500 } } }
    const widget = { widget: 'ConnectionWidget', connection: preview,
      ...(explicit ? { responseId } : {}) }
    const connection = { who: 'leon' as const, messageId: 'connection-card', message: 'Connect Notion.',
      sentAt: startedAt + 2, isAddedToHistory: false, widget }
    ui.history.set(SESSION_ID, [owner, answer, connection])
    ui.sessions[0]!.status = 'wip' as SessionStatus
    await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
      await route.fulfill({ json: { view: connectionPreviewView(preview, 'oauth', Step.Choice, true) } })
    })
    await page.goto(SESSION_URL)
    const body = page.getByRole('region', { name: 'Leon’s final answer', exact: true })
    await expect(body.getByRole('region', { name: 'Set up Notion', exact: true })).toBeVisible()
    answer.message = 'Connect Notion below, then I can read the pages you share.'
    answer.isAddedToHistory = true
    ui.sessions[0]!.status = 'idle' as SessionStatus
    await ui.emit([
      { type: 'final_answer', sequence: 1, session_id: SESSION_ID, turn_id: owner.messageId,
        response_id: responseId, created_at: startedAt + 3, data: { content: answer.message } },
      { type: 'turn_status', sequence: 2, session_id: SESSION_ID, turn_id: owner.messageId,
        response_id: responseId, created_at: startedAt + 4, data: { status: 'completed' } }
    ])
    await expect(page.getByRole('button', { name: /Worked for/ })).toBeVisible()
    await expect(body).toContainText(answer.message)
    await expect(body.getByRole('region', { name: 'Set up Notion', exact: true })).toBeVisible()
    await expect(page.locator('.aurora-connection')).toHaveCount(1)
    await page.reload()
    await expect(body.getByRole('region', { name: 'Set up Notion', exact: true })).toBeVisible()
    await expect(page.locator('.aurora-connection')).toHaveCount(1)
  })
}

test('keeps late connection cards with their originating answer rather than the newer turn', async ({ page, ui }) => {
  const preview = CONNECTION_PREVIEWS['connection-notion']!
  const time = Date.now()
  ui.history.set(SESSION_ID, [
    { who: 'owner', messageId: 'first', message: 'Read Notion.', sentAt: time, isAddedToHistory: true },
    { who: 'leon', messageId: 'first:leon', message: 'First answer.', sentAt: time + 1, isAddedToHistory: true },
    { who: 'owner', messageId: 'second', message: 'Something else.', sentAt: time + 2, isAddedToHistory: true },
    { who: 'leon', messageId: 'second:leon', message: 'Second answer.', sentAt: time + 3, isAddedToHistory: true },
    { who: 'leon', messageId: 'late-card', message: '', sentAt: time + 4, isAddedToHistory: false,
      widget: { widget: 'ConnectionWidget', responseId: 'first:leon', connection: preview } }
  ])
  await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
    await route.fulfill({ json: { view: connectionPreviewView(preview, 'oauth', Step.Choice, true) } })
  })
  await page.goto(SESSION_URL)
  const answers = page.getByRole('region', { name: 'Leon’s final answer', exact: true })
  await expect(answers.first()).toContainText('First answer.')
  await expect(answers.first().locator('.aurora-connection')).toHaveCount(1)
  await expect(answers.last().locator('.aurora-connection')).toHaveCount(0)
})

test('reports blocked authorization windows without sending credentials or leaving the conversation', async ({ page, ui }) => {
  const preview = CONNECTION_PREVIEWS['connection-notion']!
  ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: 'blocked-card', message: '', sentAt: Date.now(),
    isAddedToHistory: false, widget: { widget: 'ConnectionWidget', connection: preview } })
  let submissions = 0
  await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
    if (route.request().postDataJSON().action === Action.Connect) {
      submissions++
    }
    await route.fulfill({ json: { view: connectionPreviewView(preview, 'oauth', Step.Choice, true) } })
  })
  await page.goto(SESSION_URL)
  await page.evaluate(() => {
    window.open = (): null => null
  })
  const card = page.getByRole('region', { name: 'Set up Notion', exact: true })
  await card.getByRole('button', { name: 'Connect Notion', exact: true }).click()
  await expect(card.getByRole('alert')).toContainText('Allow pop-ups')
  await expect(page.locator('.toast-error')).toHaveCount(1)
  expect(submissions).toBe(0)
  await expect(page).toHaveURL(new RegExp(`${SESSION_ID}$`))
})

for (const action of ['close', 'navigate'] as const) {
  test(`cleans up authorization when the owner chooses to ${action}`, async ({ page, ui, context }) => {
    const preview = CONNECTION_PREVIEWS['connection-notion']!
    ui.history.get(SESSION_ID)!.push({ who: 'leon', messageId: 'pending-card', message: '', sentAt: Date.now(),
      isAddedToHistory: false, widget: { widget: 'ConnectionWidget', connection: preview } })
    let started = false
    await context.route('**/oauth-fixture', async (route) => {
      await route.fulfill({ contentType: 'text/html', body: 'Authorize your account.' })
    })
    await page.route(`**/api/v1/connections/${preview.provider}/setup`, async (route) => {
      const body = route.request().postDataJSON()
      if (body.action === Action.Connect) {
        started = true
        await route.fulfill({ json: { view: connectionPreviewView(preview, 'oauth', Step.Choice, true),
          authorization_url: `${new URL(body.return_url).origin}/oauth-fixture` } })
        return
      }
      await route.fulfill({ json: { view: connectionPreviewView(preview, 'oauth', started ? 'cancelled' : Step.Choice, true) } })
    })
    await page.goto(SESSION_URL)
    const card = page.getByRole('region', { name: 'Set up Notion', exact: true })
    const [popup] = await Promise.all([page.waitForEvent('popup'), card.getByRole('button', { name: 'Connect Notion', exact: true }).click()])
    await expect(popup).toHaveURL(/\/oauth-fixture$/)
    if (action === 'close') {
      await popup.close()
      await page.bringToFront()
      await expect(card.getByRole('status')).toContainText('Authorization was cancelled')
      await expect(card.getByRole('button', { name: 'Connect Notion', exact: true })).toBeEnabled()
    } else {
      await page.goto(`session/${OTHER_SESSION_ID}`)
      await expect.poll(() => popup.isClosed()).toBe(true)
    }
    await expect(page.locator('.toast-success')).toHaveCount(0)
    await expect(page.locator('.toast-error')).toHaveCount(0)
  })
}
