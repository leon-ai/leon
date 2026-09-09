import { describe, expect, it } from 'vitest'

import {
  buildComputerUseConvergenceHint,
  getComputerUseRetryBlocker
} from '@/core/llm-manager/llm-duties/react-llm-duty/computer-use-convergence'
import type { ExecutionRecord } from '@/core/llm-manager/llm-duties/react-llm-duty/types'

const CLICK = 'computer_use.cua.click'
const BATCH = 'computer_use.cua.perform_actions'
const TARGET = { kind: 'desktop', display_id: 'primary' }
const INPUT = { target: TARGET, x: 500, y: 300 }

function click(visualStateId = 'unchanged'): ExecutionRecord {
  return {
    function: CLICK,
    status: 'success',
    requestedToolInput: JSON.stringify(INPUT),
    observation: JSON.stringify({ data: { output: {
      result: { effect: 'unverifiable' },
      post_action_state: { visual_state_id: visualStateId }
    } } })
  }
}

function batch(): ExecutionRecord {
  return {
    ...click(),
    function: BATCH,
    requestedToolInput: JSON.stringify({ steps: [
      { action: 'click', parameters: INPUT },
      { action: 'press_key', parameters: { target: TARGET, key: 'space' } }
    ] }),
    observation: JSON.stringify({ data: { output: {
      steps: [
        { action: 'click', success: true, result: { effect: 'unverifiable' } },
        { action: 'press_key', success: true, result: { effect: 'unverifiable' } }
      ],
      post_action_state: { visual_state_id: 'unchanged' }
    } } })
  }
}

describe('computer-use retry guard', () => {
  it('uses CLI batch outcomes in the shared guard even when scripts catch failures', () => {
    const target = { selector: '#download', text: 'Download' }
    const action = { action: 'download', target, tab_id: 'tab-a', success: false,
      effect: 'unverifiable', state_id: 'same', error_code: 'outcome_timeout' }
    const input = JSON.stringify({ tab_id: 'tab-a', action: 'download', target })
    const batch: ExecutionRecord = {
      function: 'browser_use.cli.run', status: 'success', requestedToolInput: '{"code":"caught_error()"}',
      observation: JSON.stringify({ output: { result: { success: false, browser_actions: [action, action, action] } } })
    }
    expect(buildComputerUseConvergenceHint([batch])).toContain('multiple uncertain actions')
    expect(getComputerUseRetryBlocker([batch], 'browser_use.cli.act', input)).toContain('retry blocked')
    const inspect: ExecutionRecord = { function: 'browser_use.cli.inspect', status: 'success',
      requestedToolInput: '{"tab_id":"tab-a"}', observation: '{"observation":{"state_id":"changed"}}' }
    expect(getComputerUseRetryBlocker([batch, inspect], 'browser_use.cli.act', input)).toBeNull()
    expect(getComputerUseRetryBlocker([batch], 'browser_use.cli.act', JSON.stringify({
      tab_id: 'tab-b', action: 'download', target
    }))).toBeNull()
  })

  it('shares browser DOM retry detection and resets it only when the observed state changes', () => {
    const name = 'browser_use.playwright.act'
    const input = JSON.stringify({ tab_id: 'tab-a', action: 'click', ref: 'e1' })
    const action: ExecutionRecord = {
      function: name, requestedToolInput: input, status: 'success',
      observation: JSON.stringify({ output: { state_id: 'same', effect: 'unverifiable' } })
    }
    const inspection = { ...action, function: 'browser_use.playwright.inspect',
      observation: JSON.stringify({ output: { state_id: 'same' } }) }
    expect(getComputerUseRetryBlocker([action, action, inspection], name, input)).toContain('retry blocked')
    const changed = { ...inspection, observation: JSON.stringify({ output: { state_id: 'changed' } }) }
    expect(getComputerUseRetryBlocker([action, action, changed], name, input)).toBeNull()
    expect(getComputerUseRetryBlocker([action, action], name, JSON.stringify({ tab_id: 'tab-b', action: 'click', ref: 'e1' }))).toBeNull()
  })

  it('blocks nearby clicks only after repeated uncertain unchanged results', () => {
    const next = JSON.stringify({ ...INPUT, x: 503 })
    expect(getComputerUseRetryBlocker([click()], CLICK, next)).toBeNull()
    expect(getComputerUseRetryBlocker([click(), click()], CLICK, next)).toContain('retry blocked')
    expect(getComputerUseRetryBlocker([click(), click('changed')], CLICK, next)).toBeNull()
  })

  it('blocks repeated structured failures without inventing a visual outcome', () => {
    const failed = { ...click(), status: 'error', observation: JSON.stringify({
      data: { output: { error_code: 'foreground_unavailable' } }
    }) }
    expect(getComputerUseRetryBlocker([failed], CLICK, JSON.stringify(INPUT))).toBeNull()
    expect(getComputerUseRetryBlocker([failed, failed], CLICK, JSON.stringify(INPUT)))
      .toContain('foreground_unavailable')
    expect(getComputerUseRetryBlocker([failed, failed], CLICK,
      JSON.stringify({ ...INPUT, delivery_mode: 'background' }))).toBeNull()
    expect(getComputerUseRetryBlocker([failed, failed, click('recovered')], CLICK, JSON.stringify(INPUT))).toBeNull()
    const differentFailure = { ...failed, observation: JSON.stringify({ error_code: 'stale_element' }) }
    expect(getComputerUseRetryBlocker([failed, differentFailure], CLICK, JSON.stringify(INPUT))).toBeNull()
  })

  it('allows a retry after successful focus recovery on the same window', () => {
    const input = JSON.stringify({ pid: 42, window_id: 7, x: 100, y: 100 })
    const failed = { ...click(), requestedToolInput: input, status: 'error',
      observation: JSON.stringify({ error_code: 'foreground_unavailable' }) }
    const focus = { ...failed, function: 'computer_use.cua.bring_to_front',
      status: 'success', observation: '{}' }
    expect(getComputerUseRetryBlocker([failed, failed, focus], CLICK, input)).toBeNull()
    expect(getComputerUseRetryBlocker([failed, failed, { ...focus, status: 'error' }], CLICK, input))
      .toContain('foreground_unavailable')
    expect(getComputerUseRetryBlocker([failed, failed, {
      ...focus, requestedToolInput: JSON.stringify({ pid: 42, window_id: 8 })
    }], CLICK, input)).toContain('foreground_unavailable')
  })

  it('includes the attempted failed batch step but ignores unexecuted steps', () => {
    const failed = { ...batch(), status: 'error', observation: JSON.stringify({ steps: [
      { action: 'click', success: false, error_code: 'foreground_unavailable' }
    ] }) }
    expect(getComputerUseRetryBlocker([failed, failed], CLICK, JSON.stringify(INPUT)))
      .toContain('foreground_unavailable')
    expect(getComputerUseRetryBlocker([failed, failed], 'computer_use.cua.press_key',
      JSON.stringify({ target: TARGET, key: 'space' }))).toBeNull()
  })

  it('does not attach desktop fallback evidence to a window input', () => {
    const action = { ...click(), requestedToolInput: JSON.stringify({ pid: 42, window_id: 7, x: 500, y: 300 }),
      observation: JSON.stringify({ result: { effect: 'unverifiable' }, post_action_state: {
        visual_state_id: 'desktop', capture_target: { kind: 'desktop' }
      } }) }
    expect(getComputerUseRetryBlocker([action, action], CLICK, action.requestedToolInput)).toBeNull()
  })

  it('allows different points, targets, and tools', () => {
    const history = [click(), click()]
    for (const input of [
      { ...INPUT, x: 900 },
      { x: 500, y: 300, pid: 42, window_id: 7 }
    ]) {
      expect(getComputerUseRetryBlocker(history, CLICK, JSON.stringify(input))).toBeNull()
    }
    expect(getComputerUseRetryBlocker(history, 'other.tool.click', JSON.stringify(INPUT))).toBeNull()
  })

  it('requires changed evidence on the affected target to reset', () => {
    const observation = {
      ...click(), function: 'computer_use.cua.get_desktop_state',
      requestedToolInput: '{}'
    }
    expect(getComputerUseRetryBlocker([click(), click(), observation], CLICK, JSON.stringify(INPUT))).toContain('retry blocked')
    expect(getComputerUseRetryBlocker([click(), click(), {
      ...observation, observation: JSON.stringify({ result: { visual_state_id: 'changed' } })
    }], CLICK, JSON.stringify(INPUT))).toBeNull()
    for (const invalid of [
      { ...observation, status: 'error' },
      { ...observation, observation: '{}' },
      { ...observation, requestedToolInput: JSON.stringify({ target: { kind: 'desktop', display_id: 'other' } }) }
    ]) {
      expect(getComputerUseRetryBlocker([click(), click(), invalid], CLICK, JSON.stringify(INPUT))).toContain('retry blocked')
    }
  })

  it('does not treat missing captures or confirmed effects as no progress', () => {
    for (const observation of [
      JSON.stringify({ result: { effect: 'unverifiable' } }),
      JSON.stringify({ result: { effect: 'confirmed' }, visual_state_id: 'unchanged' })
    ]) {
      const action = { ...click(), observation }
      expect(getComputerUseRetryBlocker([action, action], CLICK, JSON.stringify(INPUT))).toBeNull()
    }
  })

  it('includes clicks inside executed and proposed batches', () => {
    expect(getComputerUseRetryBlocker([batch(), batch()], BATCH, batch().requestedToolInput!)).toContain('retry blocked')
    expect(buildComputerUseConvergenceHint([batch(), batch(), batch()])).toContain('same visual state')
  })

  it('does not attribute a batch capture to an earlier, different target', () => {
    const action = batch()
    action.requestedToolInput = JSON.stringify({ steps: [
      { action: 'click', parameters: INPUT },
      { action: 'press_key', parameters: { pid: 42, window_id: 7, key: 'space' } }
    ] })
    expect(getComputerUseRetryBlocker([action, action], CLICK, JSON.stringify(INPUT))).toBeNull()
  })

  it('does not attribute an uncertain key effect to a confirmed batch click', () => {
    const action = batch()
    action.observation = JSON.stringify({
      steps: [
        { action: 'click', success: true, result: { effect: 'confirmed' } },
        { action: 'press_key', success: true, result: { effect: 'unverifiable' } }
      ],
      post_action_state: { visual_state_id: 'unchanged' }
    })
    expect(getComputerUseRetryBlocker([action, action], CLICK, JSON.stringify(INPUT))).toBeNull()
  })

  it('ignores unexecuted steps in a stopped batch', () => {
    const stopped = { ...batch(), status: 'error', observation: JSON.stringify({
      steps: [], post_action_state: { visual_state_id: 'unchanged' }
    }) }
    expect(getComputerUseRetryBlocker([stopped, stopped], CLICK, JSON.stringify(INPUT))).toBeNull()
  })

  it('uses final evidence instead of an intermediate batch capture', () => {
    const action = batch()
    action.observation = JSON.stringify({ steps: [
      { action: 'click', success: true, result: { effect: 'unverifiable', visual_state_id: 'old' } },
      { action: 'press_key', success: true, result: { effect: 'unverifiable' } }
    ], post_action_state: { visual_state_id: 'changed' } })
    expect(getComputerUseRetryBlocker([click('old'), action], CLICK, JSON.stringify(INPUT))).toBeNull()
  })

  it.each(['scroll', 'hotkey', 'press_key', 'type_text'])(
    'also guards repeated ineffective %s input', (action) => {
      const input = JSON.stringify({ ...INPUT, direction: 'down', key: 'space', keys: ['ctrl', 'l'], text: 'example' })
      const execution = { ...click(), function: `computer_use.cua.${action}`, requestedToolInput: input }
      expect(getComputerUseRetryBlocker([execution, execution], execution.function, input)).toContain('retry blocked')
    }
  )

  it('allows a different delivery route and confirmed effects to end a streak', () => {
    const history = [click(), click()]
    expect(getComputerUseRetryBlocker(history, CLICK, JSON.stringify({ ...INPUT, delivery_mode: 'foreground' }))).toBeNull()
    const confirmed = { ...click(), observation: JSON.stringify({
      result: { effect: 'confirmed' }, post_action_state: { visual_state_id: 'unchanged' }
    }) }
    expect(getComputerUseRetryBlocker([...history, confirmed], CLICK, JSON.stringify(INPUT))).toBeNull()
  })
})

describe('computer-use convergence hints', () => {
  it('does not classify a long successful inspection as ineffective', () => {
    const executions = Array.from({ length: 8 }, (_, index) => ({
      function: 'computer_use.cua.scroll',
      status: 'success',
      observation: `Captured viewport ${index + 1}.`,
      requestedToolInput: JSON.stringify({
        pid: 42,
        window_id: 7,
        direction: 'down',
        by: 'page',
        amount: 1
      })
    }))

    expect(buildComputerUseConvergenceHint(executions)).toBeNull()
  })

  it('detects recent scroll oscillation', () => {
    const executions = ['down', 'up', 'down'].map((direction) => ({
      function: 'computer_use.cua.scroll',
      status: 'success',
      observation: 'Captured viewport.',
      requestedToolInput: JSON.stringify({
        pid: 42,
        window_id: 7,
        direction
      })
    }))

    expect(buildComputerUseConvergenceHint(executions)).toContain(
      'scrolled back and forth repeatedly'
    )
  })

  it('requests verification after several uncertain inputs on the same target', () => {
    const executions = [
      [560, 160],
      [563, 163],
      [568, 167]
    ].map(([x, y]) => ({
      function: 'computer_use.cua.click',
      status: 'success',
      observation: JSON.stringify({ result: { effect: 'unverifiable' } }),
      requestedToolInput: JSON.stringify({
        pid: 42,
        window_id: 7,
        x,
        y
      })
    }))

    expect(buildComputerUseConvergenceHint(executions)).toContain(
      'several recent inputs lack driver verification'
    )
  })

  it('detects uncertain actions that leave the same visual state', () => {
    const executions = [120, 360].map((y) => ({
      function: 'computer_use.cua.click',
      status: 'success' as const,
      observation: JSON.stringify({
        data: {
          output: {
            result: { effect: 'unverifiable' },
            post_action_state: { visual_state_id: 'same-screen' }
          }
        }
      }),
      requestedToolInput: JSON.stringify({
        target: { kind: 'desktop', display_id: 'primary' },
        x: 500,
        y
      })
    }))

    expect(buildComputerUseConvergenceHint(executions)).toContain(
      'multiple uncertain actions produced the same visual state'
    )
    expect(buildComputerUseConvergenceHint(executions)).toContain(
      'not routine internal recovery'
    )
  })

  it('remembers unavailable background delivery for the target', () => {
    const executions = [
      {
        function: 'computer_use.cua.click',
        status: 'error',
        observation: JSON.stringify({
          data: { output: { code: 'background_unavailable' } }
        }),
        requestedToolInput: JSON.stringify({
          pid: 42,
          window_id: 7,
          delivery_mode: 'background',
          x: 100,
          y: 100
        })
      }
    ]

    expect(buildComputerUseConvergenceHint(executions)).toContain(
      'background delivery is unavailable for this target'
    )
  })

  it('stops retrying accessibility when only the app frame is exposed', () => {
    const executions = Array.from({ length: 2 }, () => ({
      function: 'computer_use.cua.get_window_state',
      status: 'success',
      observation: JSON.stringify({
        data: {
          output: {
            result: {
              total_element_count: 1,
              elements: [{ role: 'frame', label: 'Feishu' }]
            }
          }
        }
      }),
      requestedToolInput: JSON.stringify({ pid: 42, window_id: 7 })
    }))

    expect(buildComputerUseConvergenceHint(executions)).toContain(
      'accessibility snapshots exposed only the outer application frame'
    )
  })

})
