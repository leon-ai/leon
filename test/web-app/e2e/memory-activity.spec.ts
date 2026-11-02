import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'
import { MemoryActivityAction } from '../../../server/src/core/llm-manager/memory-activity-contract'

// Automatic context loading is Core work; an additional lookup is an ordinary tool.
test('separates automatic temporary context from a requested memory tool lookup', async ({ page, ui }) => {
  const startedAt = Date.now() - 2_000
  await page.goto(SESSION_URL)
  const entries = [{ id: 'location', content: 'I am visiting Lyon.', expiresAt: '2026-11-10T00:00:00Z' }]
  const events = [
    { type: 'owner_message' as const, data: { message: {
      who: 'owner', messageId: 'temporary-owner', message: 'What is the weather where I am?', sentAt: startedAt, isAddedToHistory: true
    } } },
    { type: 'progress_message' as const, data: { message: {
      id: 'automatic-context', content: 'Loaded temporary context', created_at: startedAt,
      icon_name: 'brain-2-line', memory: { action: MemoryActivityAction.TemporaryLoaded, entries, durationMs: 2 }
    } } },
    { type: 'tool_call' as const, data: { tool_call: {
      id: 'temporary-lookup', name: 'structured_knowledge.memory.read', toolkit_name: 'Structured Knowledge',
      tool_name: 'Memory', tool_icon_name: 'brain-2-line', tool_call_title: 'Read current temporary context',
      status: 'success', duration_ms: 12, started_at: startedAt + 2,
      input: { query: 'current location', options: { scope: 'temporary' } }, output: { hits: entries }
    } } },
    { type: 'final_answer' as const, data: {
      content: 'It is clear in Lyon.', response_trace: { metrics: { durationMs: 1_000 } }
    } }
  ]
  await ui.emit(events.map((event, index) => ({
    ...event, sequence: index + 1, session_id: SESSION_ID, turn_id: 'temporary-owner',
    response_id: 'temporary-owner:leon', created_at: startedAt + index
  })))
  const reply = page.locator('.leon-message').filter({ hasText: 'It is clear in Lyon.' })
  await reply.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
  await expect(reply.getByRole('button', { name: 'Loaded temporary context in 2ms', exact: true })).toBeVisible()
  const tools = reply.getByRole('region', { name: 'Leon’s tool usage', exact: true })
  await expect(tools).not.toContainText('Loaded temporary context')
  await tools.getByRole('button', { name: 'Used 1 tool for 12ms', exact: true }).click()
  await expect(tools.getByRole('button', { name: /Read current temporary context/ })).toBeVisible()
  await expect(tools.locator('.ri-brain-2-line')).toBeVisible()
})
