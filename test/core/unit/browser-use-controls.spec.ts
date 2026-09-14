import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { expect, it } from 'vitest'

import { RuntimeHelper } from '@/helpers/runtime-helper'

it('verifies Browser Use form-control behavior without launching a browser', () => {
  const root = process.cwd()
  expect(() => execFileSync(RuntimeHelper.getPythonBinPath(), [
    path.join(root, 'test/core/unit/fixtures/browser-use-controls.py'),
    path.join(root, 'tools/browser_use/src/nodejs/lib/browser-use-runtime.py')
  ], { encoding: 'utf8', timeout: 10_000 })).not.toThrow()
})
