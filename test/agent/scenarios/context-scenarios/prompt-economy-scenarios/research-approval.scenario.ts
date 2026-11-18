import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const NOTES = Array.from({ length: 180 }, (_, index) =>
  `Compatibility probe ${index + 1} confirmed stable replay for completed lookup records and empty results.\n`
).join('')
const REPORT = 'release-plan.txt'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await Promise.all([
        fs.writeFile(path.join(workspace, 'index.txt'), [
          'The model availability matrix is in availability.txt. The package change is in dependencies.txt.',
          NOTES
        ].join('\n')),
        fs.writeFile(path.join(workspace, 'availability.txt'), [
          'The Astra fixture supports the API route. The Sol fixture supports both the API and subscription routes.',
          NOTES
        ].join('\n')),
        fs.writeFile(path.join(workspace, 'dependencies.txt'), [
          'Upgrade the fixture SDK from 4.2.0 to 4.3.1 after validating response replay.',
          NOTES
        ].join('\n'))
      ])

      const first = await runMaintainedTurn(context,
        'Read index.txt first. It names the two source files to read. Use both sources to report the Astra and Sol route differences and the exact SDK version change. Leave the files as they are.',
        workspace)
      assert.match(first.output, /4\.3\.1/)
      assert.match(first.output, /subscription/i)
      const second = await runMaintainedTurn(context,
        `Ask me one yes/no question for approval before creating ${REPORT} about the SDK update you just researched. Put the exact target version in the approval question itself.`,
        workspace, first.sessionId, 'clarification')
      assert.match(second.output, /4\.3\.1/)
      assert.ok(!(await fs.readdir(workspace)).includes(REPORT))

      return { first, second }
    })
  }
}

export default scenario
