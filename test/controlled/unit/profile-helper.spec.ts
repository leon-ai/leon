import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const profilePaths = {
  configPath: '',
  dotEnvPath: ''
}

async function loadProfileHelper(): Promise<
  typeof import('@/helpers/profile-helper').ProfileHelper
> {
  vi.doMock('@/leon-roots', () => ({
    PROFILE_CONFIG_PATH: profilePaths.configPath,
    PROFILE_DOT_ENV_PATH: profilePaths.dotEnvPath
  }))

  const module = await import('@/helpers/profile-helper')

  return module.ProfileHelper
}

function writeAvailabilityConfig(availability: unknown): void {
  fs.writeFileSync(
    profilePaths.configPath,
    YAML.stringify({
      availability
    })
  )
}

function readAvailabilityConfig(): unknown {
  return YAML.parse(fs.readFileSync(profilePaths.configPath, 'utf8')).availability
}

describe('ProfileHelper', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-profile-helper-'))
    profilePaths.configPath = path.join(tmpDir, 'config.yml')
    profilePaths.dotEnvPath = path.join(tmpDir, '.env')
    vi.resetModules()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true
    })
  })

  it('allows everything by default when policy files are missing', async () => {
    const ProfileHelper = await loadProfileHelper()

    expect(ProfileHelper.isSkillDisabled('date_time_skill')).toBe(false)
    expect(
      ProfileHelper.isToolDisabled('codex', 'coding_development')
    ).toBe(false)
  })

  it('treats empty allowed lists as unrestricted', async () => {
    writeAvailabilityConfig({
      skills: {
        allowed: [],
        disabled: ['date_time_skill']
      },
      tools: {
        allowed: [],
        disabled: ['coding_development.codex']
      }
    })

    const ProfileHelper = await loadProfileHelper()

    expect(ProfileHelper.isSkillDisabled('weather_forecast_skill')).toBe(false)
    expect(ProfileHelper.isSkillDisabled('date_time_skill')).toBe(true)
    expect(
      ProfileHelper.isToolDisabled('opencode', 'coding_development')
    ).toBe(false)
    expect(
      ProfileHelper.isToolDisabled('codex', 'coding_development')
    ).toBe(true)
  })

  it('restricts access when allowed lists contain ids', async () => {
    writeAvailabilityConfig({
      skills: {
        allowed: ['coding_agent_router_skill'],
        disabled: []
      },
      tools: {
        allowed: ['coding_development.codex'],
        disabled: []
      }
    })

    const ProfileHelper = await loadProfileHelper()

    expect(
      ProfileHelper.isSkillDisabled('coding_agent_router_skill')
    ).toBe(false)
    expect(ProfileHelper.isSkillDisabled('date_time_skill')).toBe(true)
    expect(
      ProfileHelper.isToolDisabled('codex', 'coding_development')
    ).toBe(false)
    expect(
      ProfileHelper.isToolDisabled('codex', 'other_toolkit')
    ).toBe(true)
  })

  it('ignores disabled ids while allow-only lists are active', async () => {
    writeAvailabilityConfig({
      skills: {
        allowed: ['coding_agent_router_skill'],
        disabled: ['coding_agent_router_skill']
      },
      tools: {
        allowed: ['coding_development.codex'],
        disabled: ['coding_development.codex']
      }
    })

    const ProfileHelper = await loadProfileHelper()

    expect(
      ProfileHelper.isSkillDisabled('coding_agent_router_skill')
    ).toBe(false)
    expect(
      ProfileHelper.isToolDisabled('codex', 'coding_development')
    ).toBe(false)
  })

  it('keeps enable commands scoped to disabled lists', async () => {
    writeAvailabilityConfig({
      skills: {
        allowed: ['existing_skill'],
        disabled: ['coding_agent_router_skill']
      },
      tools: {
        allowed: ['coding_development.opencode'],
        disabled: ['coding_development.codex']
      }
    })

    const ProfileHelper = await loadProfileHelper()

    await ProfileHelper.enableSkill('coding_agent_router_skill')
    await ProfileHelper.enableTool('coding_development.codex')

    expect(readAvailabilityConfig()).toEqual({
      skills: {
        allowed: ['existing_skill'],
        disabled: []
      },
      tools: {
        allowed: ['coding_development.opencode'],
        disabled: []
      }
    })
  })

  it('keeps disable commands scoped to disabled lists', async () => {
    writeAvailabilityConfig({
      skills: {
        allowed: ['coding_agent_router_skill'],
        disabled: []
      },
      tools: {
        allowed: ['coding_development.codex'],
        disabled: []
      }
    })

    const ProfileHelper = await loadProfileHelper()

    await ProfileHelper.disableSkill('coding_agent_router_skill')
    await ProfileHelper.disableTool('coding_development.codex')

    expect(readAvailabilityConfig()).toEqual({
      skills: {
        allowed: ['coding_agent_router_skill'],
        disabled: ['coding_agent_router_skill']
      },
      tools: {
        allowed: ['coding_development.codex'],
        disabled: ['coding_development.codex']
      }
    })
  })

  it('adds and removes items from allow-only lists', async () => {
    writeAvailabilityConfig({
      skills: {
        allowed: ['existing_skill'],
        disabled: ['coding_agent_router_skill']
      },
      tools: {
        allowed: ['coding_development.opencode'],
        disabled: ['coding_development.codex']
      }
    })

    const ProfileHelper = await loadProfileHelper()

    await ProfileHelper.allowOnlySkill('coding_agent_router_skill')
    await ProfileHelper.allowOnlyTool('coding_development.codex')

    expect(readAvailabilityConfig()).toEqual({
      skills: {
        allowed: ['coding_agent_router_skill', 'existing_skill'],
        disabled: ['coding_agent_router_skill']
      },
      tools: {
        allowed: ['coding_development.codex', 'coding_development.opencode'],
        disabled: ['coding_development.codex']
      }
    })

    await ProfileHelper.removeAllowOnlySkill('existing_skill')
    await ProfileHelper.removeAllowOnlyTool('coding_development.opencode')

    expect(readAvailabilityConfig()).toEqual({
      skills: {
        allowed: ['coding_agent_router_skill'],
        disabled: ['coding_agent_router_skill']
      },
      tools: {
        allowed: ['coding_development.codex'],
        disabled: ['coding_development.codex']
      }
    })
  })
})
