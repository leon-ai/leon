import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { listAgentScenarios, selectAgentScenarios } from '@@/scripts/agent-scenarios'

const CASES = [
  'agent-loop-scenarios/human-in-the-loop-scenarios/resume',
  'memory-scenarios/experience-scenarios/recovery',
  'memory-scenarios/experience-scenarios/correction',
  'memory-scenarios/persistence-scenarios/correction'
]

describe('real scenario selection', () => {
  it('selects whole categories, nested mechanisms and individual cases', () => {
    expect(selectAgentScenarios(CASES, 'agent-loop-scenarios')).toEqual([CASES[0]])
    expect(selectAgentScenarios(CASES, 'memory-scenarios')).toEqual(CASES.slice(1))
    expect(selectAgentScenarios(CASES, 'experience-scenarios')).toEqual(CASES.slice(1, 3))
    expect(selectAgentScenarios(CASES, 'experience')).toEqual(CASES.slice(1, 3))
    expect(selectAgentScenarios(CASES, CASES[2])).toEqual([CASES[2]])
    expect(selectAgentScenarios(CASES, 'recovery')).toEqual([CASES[1]])
    expect(selectAgentScenarios(CASES)).toEqual(CASES)
  })

  it('rejects ambiguous shorthand, unknown mechanisms and paths outside the catalog', () => {
    expect(() => selectAgentScenarios(CASES, 'correction')).toThrow('Ambiguous')
    expect(() => selectAgentScenarios(CASES, 'missing-scenarios')).toThrow('Unknown')
    expect(() => selectAgentScenarios(CASES, '../recovery')).toThrow('Unknown')
  })

  it('discovers nested cases without treating helpers as scenarios or following escaped sources', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-scenario-discovery-'))
    const nested = path.join(root, 'suite', 'mechanism')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'case.scenario.ts'), 'export default {}')
    fs.writeFileSync(path.join(nested, 'fixture.ts'), 'export default {}')

    try {
      expect(listAgentScenarios(root)).toEqual(['suite/mechanism/case'])
      fs.symlinkSync(path.join(root, 'suite'), path.join(nested, 'alias'))
      expect(listAgentScenarios(root)).toEqual(['suite/mechanism/case'])
      fs.symlinkSync(path.join(root, 'suite', 'mechanism', 'fixture.ts'), path.join(nested, 'linked.scenario.ts'))
      expect(listAgentScenarios(root)).toEqual(['suite/mechanism/case'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
