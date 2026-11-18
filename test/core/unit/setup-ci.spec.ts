import { expect, it } from 'vitest'

import {
  getFullInstallEnvironment,
  shouldUseCIRuntimes
} from '@@/scripts/setup/setup-ci.js'

const RUNTIMES = {
  LEON_NODE_PATH: '/ci/node',
  LEON_PNPM_PATH: '/ci/pnpm',
  LEON_PYTHON_PATH: '/ci/python',
  LEON_UV_PATH: '/ci/uv'
}

it.each([{}, { GITHUB_ACTIONS: 'true' }, { GITLAB_CI: 'true' }])(
  'reuses a complete runtime set through the common CI marker (%j)',
  (provider) => {
    expect(shouldUseCIRuntimes({ ...RUNTIMES, ...provider, CI: 'true' })).toBe(true)
    expect(shouldUseCIRuntimes({ ...RUNTIMES, ...provider, CI: 'false' })).toBe(false)

    for (const key of Object.keys(RUNTIMES)) {
      expect(shouldUseCIRuntimes({ ...RUNTIMES, ...provider, CI: 'true', [key]: '' })).toBe(false)
    }
  }
)

it('provisions managed runtimes for cold installs while retaining CI and network policy', () => {
  const parent = {
    ...RUNTIMES,
    CI: 'true',
    GITLAB_CI: 'true',
    LEON_HOME: '/ci/isolated-home',
    LEON_DOWNLOAD_REGION: 'cn',
    HTTPS_PROXY: 'http://proxy.example'
  }
  const environment = getFullInstallEnvironment(parent)

  expect(shouldUseCIRuntimes(environment)).toBe(false)
  expect(environment).toEqual({
    CI: 'true',
    GITLAB_CI: 'true',
    LEON_HOME: parent.LEON_HOME,
    LEON_DOWNLOAD_REGION: 'cn',
    HTTPS_PROXY: parent.HTTPS_PROXY
  })
  expect(parent.LEON_UV_PATH).toBe(RUNTIMES.LEON_UV_PATH)
})
