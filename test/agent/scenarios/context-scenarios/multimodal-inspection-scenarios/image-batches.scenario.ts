import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

/**
 * Produce an unlabelled colour image so the answer must come from visual input.
 */
function colourPng(red: number, green: number, blue: number): string {
  const chunk = (name: string, data: Buffer): Buffer => {
    const type = Buffer.from(name)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))

    return Buffer.concat([header, type, data, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64, 0)
  header.writeUInt32BE(64, 4)
  header[8] = 8
  header[9] = 2
  const scanline = Buffer.from([0, ...Array.from({ length: 64 }, () => [red, green, blue]).flat()])

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array(64).fill(scanline)))), chunk('IEND', Buffer.alloc(0))
  ]).toString('base64')
}

const scenario: RealAgentScenario = {
  async run(context) {
    const colours = [
      [255, 0, 0], [0, 0, 255], [255, 255, 0], [0, 128, 0],
      [0, 0, 0], [255, 255, 255], [255, 165, 0], [128, 0, 128], [0, 255, 255]
    ]
    const files = colours.map(([red, green, blue], index) => ({
      filename: `sample-${index + 1}.png`, mediaType: 'image/png',
      dataBase64: colourPng(red!, green!, blue!)
    }))
    const turn = await context.runTurn('Inspect every attached image. Each is a solid colour. List its filename and observed colour, in input order. Do not use tools or omit the last image.', undefined, { files })
    assert.equal(turn.finalIntent, 'answer', turn.output)
    for (let index = 1; index <= files.length; index += 1) {
      assert.ok(turn.output.includes(`sample-${index}.png`), turn.output)
    }
    for (const colour of ['red', 'blue', 'yellow', 'green', 'black', 'white', 'orange', 'purple', 'cyan']) {
      assert.ok(turn.output.toLowerCase().includes(colour), turn.output)
    }
    assert.equal(turn.executionHistory.length, 0)
    const state = JSON.parse(await fs.readFile(path.join(context.profilePath, 'sessions', turn.sessionId, '.agent-conversation-state.json'), 'utf8')) as { transcript: AgentToolTranscriptMessage[] }
    const batches = state.transcript.filter((message) => message.role === 'user' && message.runtimeContext?.['visualInspectionBatch'])
    assert.ok(batches.length > 1, 'Oversized image collections must preserve findings across bounded inspection batches.')
    const findings = batches.flatMap((message) => JSON.parse(message.content).visual_inspection_findings) as Array<{ id: string }>
    assert.equal(findings.length, files.length)
    assert.equal(new Set(findings.map((finding) => finding.id)).size, files.length)
    assert.ok(!state.transcript.some((message) => message.role !== 'assistant' && message.files?.some((file) => file.inspectionPending)))

    return { turn, imageCount: files.length }
  }
}

export default scenario
