import assert from 'node:assert/strict'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

let outputDirectory = ''
let recording = false
const calls: string[] = []
const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    outputDirectory = path.join(profilePath, 'tutorial-fixture')
  },
  toolResult(input) {
    if (input.toolkitId !== 'computer_use') {
      return undefined
    }
    const name = input.functionName || ''
    calls.push(name)
    let result: Record<string, unknown>
    if (name === 'start_recording') {
      recording = true
      result = { success: true, recording: true, output_dir: outputDirectory }
    } else if (name === 'stop_recording') {
      recording = false
      result = { success: true, recording: false, output_dir: outputDirectory }
    } else if (name === 'list_windows') {
      result = { windows: [{ pid: 731, window_id: 42, title: 'Caldera Preferences', app_name: 'Fixture Editor', z_index: 1 }] }
    } else if (name === 'list_apps') {
      result = { apps: [{ name: 'Fixture Editor', pid: 731 }] }
    } else {
      result = { success: false, status: 'capture_failed', input_delivery: 'not_sent',
        message: 'The device capture service stopped. No valid screenshots are available. Stop any active recording; the workflow cannot be demonstrated until the device reconnects.' }
    }

    return { status: 'success', message: 'Tutorial device observation.',
      data: { tool_id: input.toolId, toolkit_id: input.toolkitId, function_name: name,
        input: input.toolInput || null, parsed_input: input.parsedInput || null, output: { result } } }
  },
  async run(context) {
    const turn = await context.runTurn('Use the live-tutorial agent skill to create an annotated MP4 showing how to open Preferences in Fixture Editor. Start from its existing Caldera Preferences window; do not change settings. Start a screenshot-only recording before trying to capture the route. If capture fails, stop the recording and explain the blocker; never manufacture a tutorial from invented frames.')
    assert.ok(calls.includes('start_recording'), 'Exercise cleanup after recording has actually started.')
    assert.ok(calls.includes('stop_recording'))
    assert.equal(recording, false)
    assert.equal(turn.artifacts.filter((artifact) => artifact.mime_type === 'video/mp4').length, 0)
    assert.notEqual(turn.finalIntent, 'answer', turn.output)

    return { turn, calls, externalFixture: 'Device capture disconnects; no live desktop or recording is used.' }
  }
}

export default scenario
