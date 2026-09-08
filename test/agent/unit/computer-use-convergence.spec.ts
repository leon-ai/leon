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
  it('blocks nearby clicks only after repeated uncertain unchanged results', () => {
    const next = JSON.stringify({ ...INPUT, x: 503 })
    expect(getComputerUseRetryBlocker([click()], CLICK, next)).toBeNull()
    expect(getComputerUseRetryBlocker([click(), click()], CLICK, next)).toContain('retry blocked')
    expect(getComputerUseRetryBlocker([click(), click('changed')], CLICK, next)).toBeNull()
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

  it('requires successful fresh evidence on the affected target to reset', () => {
    const observation = {
      ...click(), function: 'computer_use.cua.get_desktop_state',
      requestedToolInput: '{}'
    }
    expect(getComputerUseRetryBlocker([click(), click(), observation], CLICK, JSON.stringify(INPUT))).toBeNull()
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
})
