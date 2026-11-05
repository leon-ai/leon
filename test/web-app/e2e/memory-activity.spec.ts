import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'
import type { ConversationRecord } from '../../../apps/web/src/data/conversation'
import { MemoryActivityAction } from '../../../server/src/core/llm-manager/memory-activity-contract'

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`keeps late memory outcomes in completed work and restores their details (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    const createdAt = Date.now() - 10_000
    const responseId = 'memory-response'
    const saved: ConversationRecord = {
      who: 'leon', messageId: responseId, message: 'Your contact is updated.',
      sentAt: createdAt + 6_000, isAddedToHistory: true,
      agentResponseTrace: { id: responseId, planSteps: [], toolCalls: [], metrics: { durationMs: 6_000 } }
    }
    ui.history.set(SESSION_ID, [
      { who: 'owner', messageId: 'memory-owner', message: 'Nora is the new contact.', sentAt: createdAt, isAddedToHistory: true },
      saved
    ])
    await page.goto(SESSION_URL)
    await expect(page.getByText(saved.message, { exact: true })).toBeVisible()
    const memory = { action: MemoryActivityAction.Saved, durationMs: 32, entries: [
      { id: 'contact', content: 'Caldera contact is Nora.', sourceRef: 'session:owner:turn:one' },
      { id: 'billing', content: 'Borealis invoices are paid every Friday.', sourceRef: 'session:owner:turn:one' }
    ] }
    const progress = { id: 'saved-memories', content: 'Saved 2 memories', createdAt: createdAt + 6_001,
      iconName: 'brain-2-line', memory, planStepId: null }
    let sequence = 0
    const emit = (): Promise<void> => ui.emit([{
      type: 'progress_message', sequence: ++sequence, session_id: SESSION_ID,
      turn_id: 'memory-owner', response_id: responseId, created_at: Date.now(),
      data: { background: true, message: {
        id: progress.id, content: progress.content, created_at: progress.createdAt,
        icon_name: progress.iconName, memory, plan_step_id: null
      } }
    }])
    await emit()
    await emit()
    await expect(page.getByText(saved.message, { exact: true })).toBeVisible()
    const reply = page.locator('.leon-message').filter({ hasText: saved.message })
    const work = reply.getByRole('region', { name: 'Leon’s completed work', exact: true })
    await work.getByRole('button', { name: 'Worked for 6s', exact: true }).click()
    const outcome = work.getByRole('region', { name: 'Leon’s activity', exact: true })
    await expect(outcome).toHaveCount(1)
    await expect(outcome.locator('[data-icon="brain-2"]')).toBeVisible()
    await outcome.getByRole('button', { name: 'Saved 2 memories in 32ms', exact: true }).click()
    await outcome.getByRole('button', { name: 'View details', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Saved 2 memories', exact: true })
    await expect(dialog).toContainText('Caldera contact is Nora.')
    await expect(dialog).toContainText('Borealis invoices are paid every Friday.')
    await expect(dialog).toContainText('session:owner:turn:one')
    await page.keyboard.press('Escape')

    // A subsequent owner turn must not inherit the older turn's late activity.
    await ui.emit([
      { type: 'owner_message', sequence: ++sequence, session_id: SESSION_ID,
        turn_id: 'next-owner', response_id: null, created_at: Date.now(), data: { message: {
          who: 'owner', messageId: 'next-owner', message: 'Another question.', sentAt: Date.now(), isAddedToHistory: true
        } } },
      { type: 'turn_status', sequence: ++sequence, session_id: SESSION_ID,
        turn_id: 'next-owner', response_id: 'next-owner:leon', created_at: Date.now(), data: { status: 'accepted' } },
      { type: 'final_answer', sequence: ++sequence, session_id: SESSION_ID,
        turn_id: 'next-owner', response_id: 'next-owner:leon', created_at: Date.now(), data: { content: 'A separate reply.' } }
    ])
    await emit()
    await expect(work.getByRole('button', { name: 'Worked for 6s', exact: true })).toBeVisible()
    await expect(outcome).toHaveCount(1)
    await expect(page.locator('.leon-message').filter({ hasText: 'A separate reply.' })).not.toContainText('Saved 2 memories')
    await expect(page.getByText(saved.message, { exact: true })).toBeVisible()

    saved.agentResponseTrace!.progressMessages = [progress]
    await page.reload()
    await expect(page.getByText(saved.message, { exact: true })).toBeVisible()
    const restored = page.getByRole('region', { name: 'Leon’s completed work', exact: true })
    await restored.getByRole('button', { name: 'Worked for 6s', exact: true }).click()
    await expect(restored.getByRole('button', { name: 'Saved 2 memories in 32ms', exact: true })).toHaveCount(1)
  })
}

// Automatic context loading is Core work; an additional lookup is an ordinary tool.
for (const durationMs of [0, 0.125]) {
  test(`separates automatic temporary context from a requested memory tool lookup (${durationMs}ms)`, async ({ page, ui }) => {
    const startedAt = Date.now() - 2_000
    await page.goto(SESSION_URL)
    const entries = [{ id: 'location', content: 'I am visiting Lyon.', expiresAt: '2026-11-10T00:00:00Z' }]
    const events = [
      { type: 'owner_message' as const, data: { message: {
        who: 'owner', messageId: 'temporary-owner', message: 'What is the weather where I am?', sentAt: startedAt, isAddedToHistory: true
      } } },
      { type: 'progress_message' as const, data: { message: {
        id: 'automatic-context', content: 'Loaded temporary context', created_at: startedAt,
        icon_name: 'brain-2-line', memory: { action: MemoryActivityAction.TemporaryLoaded, entries, durationMs }
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
    await expect(reply.getByRole('button', { name: 'Loaded temporary context in <1ms', exact: true })).toBeVisible()
    const tools = reply.getByRole('region', { name: 'Leon’s tool usage', exact: true })
    await expect(tools).not.toContainText('Loaded temporary context')
    await tools.getByRole('button', { name: 'Used 1 tool for 12ms', exact: true }).click()
    await expect(tools.getByRole('button', { name: /Read current temporary context/ })).toBeVisible()
    await expect(tools.locator('[data-icon="brain-2"]')).toBeVisible()
  })

}
