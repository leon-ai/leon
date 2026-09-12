import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  COMPUTER_USE_ACTION_NAMES,
  CuaRuntime,
  calculateComputerUseModelImageDimensions,
  mapComputerUsePointToSource,
  shouldUseCuaSafeX11Input
} from '@@/tools/computer_use/cua/src/nodejs/lib/cua-runtime'
import { createComputerUseSetOfMarkPlan } from '@@/tools/computer_use/cua/src/nodejs/lib/computer-use-set-of-mark'
import { createCuaBrowserAuthorizationHost } from '@@/tools/computer_use/cua/src/nodejs/lib/cua/cua-browser-authorization'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { ComputerUseSetOfMarkMode } from '@@/tools/computer_use/cua/src/nodejs/lib/types'
import { resolveComputerUseInteractionMode } from '@@/tools/computer_use/cua/src/nodejs/lib/computer-use-settings'

const PROFILE_NAME = 'computer-use-test'
const PORTABLE_INPUT_SCHEMA_UNSUPPORTED_KEYWORDS = new Set([
  'allOf',
  'anyOf',
  'const',
  'oneOf'
])

interface ComputerUseManifest {
  functions: Record<string, {
    parameters: Record<string, unknown>
  }>
}

interface FakeDriver {
  callTool: ReturnType<typeof vi.fn>
  isAvailable: ReturnType<typeof vi.fn>
  listToolsJson: ReturnType<typeof vi.fn>
  setAgentCursorEnabled: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
  uniffiDestroy: ReturnType<typeof vi.fn>
}

function createDriver(result: Record<string, unknown>): FakeDriver {
  return {
    callTool: vi.fn().mockResolvedValue(result),
    isAvailable: vi.fn().mockReturnValue(true),
    listToolsJson: vi.fn().mockResolvedValue(
      JSON.stringify({
        tools: [
          {
            name: 'get_window_state',
            inputSchema: { properties: { session: { type: 'string' } } }
          },
          {
            name: 'click',
            inputSchema: {
              properties: {
                delivery_mode: { type: 'string' },
                session: { type: 'string' }
              }
            }
          }
        ]
      })
    ),
    setAgentCursorEnabled: vi.fn().mockResolvedValue({
      text: '',
      images: [],
      structuredJson: '{}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    uniffiDestroy: vi.fn()
  }
}

function readComputerUseManifest(): ComputerUseManifest {
  const manifestPath = path.join(
    process.cwd(),
    'tools',
    'computer_use',
    'cua',
    'tool.json'
  )

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ComputerUseManifest
}

function findPortableInputSchemaIssues(
  value: unknown,
  schemaPath: string,
  isRoot = true
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findPortableInputSchemaIssues(entry, `${schemaPath}[${index}]`, false)
    )
  }
  if (!value || typeof value !== 'object') {
    return []
  }

  const schema = value as Record<string, unknown>
  const issues: string[] = []
  if (Array.isArray(schema['type'])) {
    issues.push(`${schemaPath}.type must use one portable scalar type`)
  }
  if (
    Array.isArray(schema['enum']) &&
    schema['enum'].some((entry) => typeof entry !== 'string')
  ) {
    issues.push(`${schemaPath}.enum must contain strings`)
  }

  const required = schema['required']
  const properties = schema['properties']
  if (Array.isArray(required)) {
    if (required.length === 0) {
      issues.push(`${schemaPath}.required must be omitted when empty`)
    }
    if (!isRoot) {
      issues.push(`${schemaPath}.required must remain at the function root`)
    }
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const propertyName of required) {
        if (
          typeof propertyName === 'string' &&
          !Object.hasOwn(properties, propertyName)
        ) {
          issues.push(`${schemaPath}.required references undefined property ${propertyName}`)
        }
      }
    }
  }

  for (const keyword of PORTABLE_INPUT_SCHEMA_UNSUPPORTED_KEYWORDS) {
    if (Object.hasOwn(schema, keyword)) {
      issues.push(`${schemaPath} uses non-portable ${keyword}`)
    }
  }
  for (const [propertyName, propertyValue] of Object.entries(schema)) {
    issues.push(
      ...findPortableInputSchemaIssues(
        propertyValue,
        `${schemaPath}.${propertyName}`,
        false
      )
    )
  }

  return issues
}

describe('CuaRuntime', () => {
  it.each([
    [{}, 'visible'],
    [{ interaction_mode: 'visible' }, 'visible'],
    [{ interaction_mode: 'background' }, 'background']
  ])('resolves interaction settings %j to %s', (settings, expected) => {
    expect(resolveComputerUseInteractionMode({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'click', parameters: {},
      getSettings: () => settings as Record<string, unknown>
    })).toBe(expected)
  })

  it('requires a model-facing target for keyboard actions', () => {
    const manifest = readComputerUseManifest()
    for (const action of ['type_text', 'press_key', 'hotkey']) {
      expect(manifest.functions[action]!.parameters['required']).toContain('target')
    }
  })
  it('adds SOM labels automatically only for ambiguous actionable controls', () => {
    const result = {
      window_bounds: { x: 100, y: 200, width: 800, height: 600 },
      elements: [
        {
          element_token: 'first',
          label: 'Submit',
          actions: ['click'],
          frame: { x: 120, y: 230, w: 100, h: 30 }
        },
        {
          element_token: 'second',
          label: 'Submit',
          actions: ['click'],
          frame: { x: 240, y: 230, w: 100, h: 30 }
        },
        {
          element_token: 'unique',
          label: 'Cancel',
          actions: ['click'],
          frame: { x: 360, y: 230, w: 100, h: 30 }
        }
      ]
    }
    const autoPlan = createComputerUseSetOfMarkPlan(
      result,
      ComputerUseSetOfMarkMode.Auto,
      { width: 800, height: 600 }
    )
    const alwaysPlan = createComputerUseSetOfMarkPlan(
      result,
      ComputerUseSetOfMarkMode.Always,
      { width: 800, height: 600 }
    )
    const neverPlan = createComputerUseSetOfMarkPlan(
      result,
      ComputerUseSetOfMarkMode.Never,
      { width: 800, height: 600 }
    )

    expect(autoPlan.annotations).toEqual([
      { key: 'token:first', mark: 1 },
      { key: 'token:second', mark: 2 }
    ])
    expect(autoPlan.filter).toContain('text=\'1\'')
    expect(alwaysPlan.annotations).toHaveLength(3)
    expect(neverPlan).toEqual({ annotations: [], filter: null })
  })

  it('uses Cua safe input only for local X11 sessions', () => {
    expect(
      shouldUseCuaSafeX11Input('linux', { XDG_SESSION_TYPE: 'x11' })
    ).toBe(true)
    expect(shouldUseCuaSafeX11Input('linux', { DISPLAY: ':0' })).toBe(true)
    expect(
      shouldUseCuaSafeX11Input('linux', {
        DISPLAY: ':0',
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_SESSION_TYPE: 'wayland'
      })
    ).toBe(false)
    expect(
      shouldUseCuaSafeX11Input('darwin', { XDG_SESSION_TYPE: 'x11' })
    ).toBe(false)
  })

  it.each([
    { source: { width: 1_920, height: 1_080 } },
    { source: { width: 5_120, height: 1_440 } },
    { source: { width: 2_160, height: 3_840 } }
  ])('adapts $source without assuming a screen shape', ({ source }) => {
    const model = calculateComputerUseModelImageDimensions(source)

    expect(model.width * model.height).toBeLessThanOrEqual(801_000)
    expect(model.width / model.height).toBeCloseTo(
      source.width / source.height,
      2
    )
  })

  it('maps model screenshot coordinates back to the exact source space', () => {
    const source = { width: 5_120, height: 1_440 }
    const model = calculateComputerUseModelImageDimensions(source)

    expect(
      mapComputerUsePointToSource(
        { x: model.width - 1, y: model.height - 1 },
        { source, model }
      )
    ).toEqual({ x: source.width - 1, y: source.height - 1 })
    const mappedCenter = mapComputerUsePointToSource(
      { x: model.width / 2, y: model.height / 2 },
      { source, model }
    )
    expect(Math.abs(mappedCenter.x - source.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(mappedCenter.y - source.height / 2)).toBeLessThanOrEqual(1)
  })

  it('marks Cua screenshots for high-detail model inspection', async () => {
    const driver = createDriver({
      text: 'Window captured.',
      images: [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }],
      structuredJson: '{"screenshot_width":1,"screenshot_height":1}',
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )
    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'get_window_state',
      parameters: { pid: 42, window_id: 7 },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })
    const artifacts = result.output['artifacts'] as Array<{ path: string }>

    try {
      expect(result.modelFiles).toMatchObject([
        { mediaType: 'image/png', visualDetail: 'high' }
      ])
    } finally {
      await fs.promises.rm(artifacts[0]!.path, { force: true })
    }
  })

  it.each(['insert', 'replace'])('focuses once before typing with mode=%s', async (mode) => {
    const observationResult = {
      text: 'Desktop captured.',
      images: [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }],
      structuredJson: '{"screenshot_width":1,"screenshot_height":1}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const actionResult = {
      text: '',
      images: [],
      structuredJson: '{"effect":"confirmed","route":"global_input"}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const driver = createDriver(actionResult)
    driver.callTool.mockImplementation((name) =>
      Promise.resolve(name === 'get_desktop_state'
        ? observationResult
        : actionResult)
    )
    const provider = new CuaRuntime(
      async () => driver as never
    )
    const observation = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'get_desktop_state',
      parameters: {},
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-pixel-type'
    })

    await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'type_text',
      parameters: {
        target: { kind: 'desktop', display_id: 'primary' },
        x: 0,
        y: 0,
        text: 'OpenRouter',
        mode,
        capture_after: false
      },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-pixel-type'
    })

    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
      'get_desktop_state',
      'click',
      ...(mode === 'replace' ? ['hotkey'] : []),
      'type_text'
    ])
    expect(JSON.parse(driver.callTool.mock.calls[1]![1])).toEqual({
      target: { kind: 'desktop', display_id: 'primary' },
      x: 0,
      y: 0
    })
    expect(JSON.parse(driver.callTool.mock.calls.at(-1)![1])).toEqual({
      target: { kind: 'desktop', display_id: 'primary' },
      text: 'OpenRouter'
    })

    if (mode === 'replace') {
      expect(JSON.parse(driver.callTool.mock.calls[2]![1])).toEqual({
        target: { kind: 'desktop', display_id: 'primary' },
        keys: [process.platform === 'darwin' ? 'cmd' : 'ctrl', 'a']
      })
    }

    const artifacts = observation.output['artifacts'] as Array<{ path: string }>
    await Promise.all(
      artifacts.map((artifact) =>
        fs.promises.rm(artifact.path, { force: true })
      )
    )
  })

  it('adapts a remote owner-device result to the regular Cua observation', async () => {
    const previousUrl = process.env['LEON_COMPUTER_USE_REMOTE_URL']
    process.env['LEON_COMPUTER_USE_REMOTE_URL'] = 'http://owner-device.test/execute'
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            output: {
              screenshot_width: 1,
              screenshot_height: 1,
              degraded: true,
              cybopal_model_files: [
                { data_base64: 'aW1hZ2U=', media_type: 'image/png' }
              ]
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new CuaRuntime()

    try {
      const result = await provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'get_desktop_state',
        parameters: {},
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-remote'
      })
      const artifacts = result.output['artifacts'] as Array<{ path: string }>

      expect(result.success).toBe(true)
      expect(result.output['degraded']).toBe(true)
      expect(result.modelFiles).toMatchObject([
        { mediaType: 'image/png', visualDetail: 'high' }
      ])
      expect(result.output).not.toHaveProperty('cybopal_model_files')
      const calls = fetchMock.mock.calls
      const sessionRequest = JSON.parse(calls[0]![1]?.body as string) as {
        action: string
        arguments: { session: string }
      }
      const observationRequest = JSON.parse(calls[1]![1]?.body as string) as {
        action: string
        arguments: { session: string }
      }
      expect(sessionRequest.action).toBe('start_session')
      expect(observationRequest).toMatchObject({
        action: 'get_desktop_state',
        arguments: { session: sessionRequest.arguments.session }
      })
      await fs.promises.rm(artifacts[0]!.path, { force: true })
    } finally {
      await provider.dispose()
      vi.unstubAllGlobals()
      if (previousUrl === undefined) {
        delete process.env['LEON_COMPUTER_USE_REMOTE_URL']
      } else {
        process.env['LEON_COMPUTER_USE_REMOTE_URL'] = previousUrl
      }
    }
  })

  it('captures resulting state through a remote owner-device bridge', async () => {
    const previousUrl = process.env['LEON_COMPUTER_USE_REMOTE_URL']
    process.env['LEON_COMPUTER_USE_REMOTE_URL'] = 'http://owner-device.test/execute'
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, options: { body: string }) =>
        new Response(
        JSON.stringify({
          status: 'ok',
          output: {
            effect: 'unverifiable',
            route: 'global_input',
            ...(JSON.parse(options.body).action === 'get_window_state' ? {
              cybopal_model_files: [{ data_base64: 'aW1hZ2U=', media_type: 'image/png' }]
            } : {})
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new CuaRuntime()

    try {
      const result = await provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'click',
        parameters: {
          pid: 42,
          window_id: 7,
          element_token: 'button-1',
          capture_after: true
        },
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-remote'
      })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[0]![1]?.body).toContain(
        '"action":"start_session"'
      )
      expect(fetchMock.mock.calls[1]![1]?.body).toContain('"action":"click"')
      expect(fetchMock.mock.calls[1]![1]?.body).not.toContain('capture_after')
      expect(fetchMock.mock.calls[2]![1]?.body).toContain(
        '"action":"get_window_state"'
      )
      expect(result).toMatchObject({
        success: true,
        output: {
          result: {
            effect: 'unverifiable',
            route: 'global_input'
          }
        }
      })
      expect(result.output).toHaveProperty('post_action_state')
    } finally {
      await provider.dispose()
      vi.unstubAllGlobals()
      if (previousUrl === undefined) {
        delete process.env['LEON_COMPUTER_USE_REMOTE_URL']
      } else {
        process.env['LEON_COMPUTER_USE_REMOTE_URL'] = previousUrl
      }
    }
  })

  it('keeps the manifest action inventory aligned with the tool runtime', () => {
    const manifest = readComputerUseManifest()

    expect(Object.keys(manifest.functions)).toEqual(COMPUTER_USE_ACTION_NAMES)
  })

  it('keeps model-facing Cua inputs portable across providers', () => {
    const manifest = readComputerUseManifest()
    const issues = Object.entries(manifest.functions).flatMap(
      ([functionName, definition]) =>
        findPortableInputSchemaIssues(
          definition.parameters,
          `${functionName}.parameters`
        )
    )

    expect(issues).toEqual([])
  })

  it('reuses one driver and returns structured Cua observations', async () => {
    const driver = createDriver({
      text: 'Found one window with verbose native metadata.',
      images: [],
      structuredJson: JSON.stringify({
        windows: [
          {
            window_id: 7,
            pid: 42,
            title: 'Leon',
            z_index: 1,
            internal_metadata: 'not useful to the model'
          }
        ]
      }),
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )
    const input = {
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'list_windows',
      parameters: { on_screen_only: true },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    }

    const firstResult = await provider.execute(input)
    const secondResult = await provider.execute(input)

    expect(driver.callTool).toHaveBeenCalledTimes(2)
    expect(firstResult.output['result']).toEqual({
      windows: [{ window_id: 7, pid: 42, title: 'Leon', z_index: 1 }],
      total_window_count: 1,
      returned_window_count: 1,
      omitted_window_count: 0
    })
    expect(firstResult.output['summary']).toBeUndefined()
    expect(secondResult.success).toBe(true)

    const artifacts = [firstResult, secondResult].flatMap(
      (result) => (result.output['artifacts'] || []) as Array<{ path: string }>
    )
    await Promise.all(
      artifacts.map((artifact) =>
        fs.promises.rm(artifact.path, { force: true })
      )
    )
    await provider.dispose()
    expect(driver.shutdown).toHaveBeenCalledOnce()
    expect(driver.uniffiDestroy).toHaveBeenCalledOnce()
  })

  it.each(['kill_app', 'page', 'set_agent_cursor_enabled'])(
    'rejects %s outside the curated surface before calling Cua',
    async (functionName) => {
    const driver = createDriver({})
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName,
      parameters: { pid: 42 },
      profileName: PROFILE_NAME,
      conversationSessionId: null
    })

    expect(result.success).toBe(false)
    expect(driver.callTool).not.toHaveBeenCalled()
    }
  )

  it('surfaces configured preferred applications before other installed apps', async () => {
    const driver = createDriver({
      text: 'Found two applications.',
      images: [],
      structuredJson: JSON.stringify({
        apps: [
          {
            name: 'Brave',
            bundle_id: 'brave',
            launch_path: 'brave',
            windows: []
          },
          {
            name: 'Spotify',
            bundle_id: 'spotify',
            launch_path: 'spotify',
            windows: []
          }
        ]
      }),
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never,
      () => 'background',
      () => ({ music: 'Spotify' })
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'list_apps',
      parameters: {},
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    expect(result).toMatchObject({
      success: true,
      output: {
        result: {
          apps: [
            {
              name: 'Spotify',
              preferred_for: ['music']
            },
            { name: 'Brave' }
          ],
          preferred_apps: [
            { activity: 'music', app_name: 'Spotify', available: true }
          ]
        }
      }
    })
  })

  it('queries and compacts application discovery before returning it', async () => {
    const driver = createDriver({
      text: 'Found two applications.',
      images: [],
      structuredJson: JSON.stringify({
        apps: [
          {
            name: 'Brave',
            bundle_id: 'brave',
            launch_path: 'brave',
            internal_metadata: 'not useful to the model'
          },
          {
            name: 'Spotify',
            bundle_id: 'spotify',
            launch_path: 'spotify',
            running: true,
            internal_metadata: 'not useful to the model'
          }
        ],
        unmatched_processes: [{ pid: 42, command: 'unrelated' }]
      }),
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'list_apps',
      parameters: { query: 'spotify' },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })
    const artifacts = result.output['artifacts'] as Array<{ path: string }>

    try {
      expect(driver.callTool).toHaveBeenCalledWith('list_apps', '{}')
      expect(result.output['result']).toEqual({
        apps: [
          {
            name: 'Spotify',
            bundle_id: 'spotify',
            launch_path: 'spotify',
            running: true
          }
        ],
        total_app_count: 2,
        matched_app_count: 1,
        returned_app_count: 1,
        omitted_app_count: 0
      })
      expect(result.output['summary']).toBeUndefined()
    } finally {
      await Promise.all(
        artifacts.map((artifact) =>
          fs.promises.rm(artifact.path, { force: true })
        )
      )
    }
  })

  it('reports structured Cua refusals as tool failures', async () => {
    const driver = createDriver({
      text: 'Existing-profile access requires authorization.',
      images: [],
      structuredJson: JSON.stringify({
        status: 'refused',
        refusal: {
          code: 'browser_consent_required',
          message: 'Existing-profile access requires authorization.'
        }
      }),
      rawJson: '{}',
      errorCode: 'browser_consent_required',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'browser_prepare',
      parameters: {},
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Existing-profile access requires authorization.',
      output: {
        success: false,
        error_code: 'browser_consent_required'
      }
    })
  })

  it('keeps GUI observation available after DevTools consent is refused', async () => {
    const driver = createDriver({})
    driver.callTool.mockImplementation(async (action: string) => ({
      text: '', images: [], isError: false, degraded: false, rawJson: '{}',
      structuredJson: JSON.stringify(action === 'get_browser_state'
        ? { status: 'refused', refusal: {
            code: 'browser_consent_required',
            detail: { next_action: 'browser_prepare', reason: 'consumer_profile_endpoint_requires_grant' }
          } }
        : { pid: 42, window_id: 7, elements: [] })
    }))
    const provider = new CuaRuntime(async () => driver as never)
    const input = {
      toolkitId: 'computer_use', toolId: 'cua', profileName: PROFILE_NAME,
      parameters: { pid: 42, window_id: 7, include_screenshot: false }
    }
    const refusal = await provider.execute({ ...input, functionName: 'get_browser_state' })
    expect(refusal.success).toBe(false)
    expect(refusal.output['error_code']).toBe('browser_consent_required')
    expect(refusal.output['result']).toMatchObject({ refusal: {
      detail: { reason: 'consumer_profile_endpoint_requires_grant' }
    } })
    expect(refusal.output['result']).toHaveProperty('refusal.detail.next_action', 'browser_prepare')
    expect(refusal.output['recovery']).toContain('Direct browser inspection requires owner authorization')
    expect(refusal.output['recovery']).toContain('use native accessibility and screenshots')
    expect(refusal.output['recovery']).toContain('Never change this permission yourself')
    expect(refusal.output['recovery']).toContain('use browser_prepare')
    expect(driver.callTool).toHaveBeenCalledTimes(1)

    const observation = await provider.execute({ ...input, functionName: 'get_window_state' })
    expect(observation.success).toBe(true)
    expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual([
      'get_browser_state', 'start_session', 'get_window_state'
    ])
    await provider.dispose()
    const artifacts = [...(observation.output['artifacts'] as Array<{ path: string }> || []),
      ...(refusal.output['artifacts'] as Array<{ path: string }> || [])]
    await Promise.all(artifacts.map((artifact) => fs.promises.rm(artifact.path, { force: true })))
  })

  it('reports structured Cua retry escalations as tool failures', async () => {
    const driver = createDriver({
      text: '',
      images: [],
      structuredJson: JSON.stringify({
        code: 'alternate_delivery_required',
        detail: 'The requested input route is unavailable.',
        escalation: { recommended: 'foreground' }
      }),
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'type_text',
      parameters: { text: 'Hello', pid: 42, window_id: 7 },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    expect(result).toMatchObject({
      success: false,
      message: 'The requested input route is unavailable.',
      output: {
        success: false,
        error_code: 'alternate_delivery_required'
      }
    })
  })

  it('owns Cua session parameters instead of asking the model for them', async () => {
    const driver = createDriver({
      text: 'Window captured.',
      images: [],
      structuredJson: '{}',
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'get_window_state',
      parameters: { pid: 42, window_id: 7 },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })
    await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'get_window_state',
      parameters: { pid: 42, window_id: 7 },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    const sessionInput = JSON.parse(driver.callTool.mock.calls[0]![1]) as {
      session: string
    }
    expect(driver.callTool.mock.calls[0]![0]).toBe('start_session')
    expect(sessionInput.session.startsWith('leon-')).toBe(true)
    expect(sessionInput.session).toHaveLength(17)
    expect(driver.setAgentCursorEnabled.mock.calls.map(([value]) => value.enabled))
      .toEqual([false, false, false, false])
    expect(driver.setAgentCursorEnabled).toHaveBeenCalledWith({
      session: sessionInput.session,
      enabled: false
    })
    expect(driver.callTool.mock.calls[1]).toEqual([
      'get_window_state',
      JSON.stringify({
        max_elements: 500,
        max_depth: 32,
        pid: 42,
        window_id: 7,
        session: sessionInput.session
      })
    ])
    expect(
      driver.callTool.mock.calls.filter(([name]) => name === 'start_session')
    ).toHaveLength(1)
  })

  it('hides the cursor after a native error and preserves session reuse', async () => {
    const driver = createDriver({ images: [], text: '', isError: false, structuredJson: '{}' })
    driver.callTool.mockImplementation(async (action: string) => {
      if (action === 'click') throw new Error('Native input failed')
      return { images: [], text: '', isError: false, structuredJson: '{}' }
    })
    const provider = new CuaRuntime(async () => driver as never)
    const input = {
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'click',
      parameters: { pid: 42, window_id: 7, element_token: 'button' },
      profileName: PROFILE_NAME, conversationSessionId: 'cleanup-error'
    }
    expect((await provider.execute(input)).success).toBe(false)
    expect(driver.setAgentCursorEnabled.mock.calls.map(([value]) => value.enabled)).toEqual([true, false])
    await provider.execute({ ...input, functionName: 'get_window_state', parameters: { pid: 42, window_id: 7 } })
    expect(driver.setAgentCursorEnabled.mock.calls.map(([value]) => value.enabled)).toEqual([true, false, false, false])
    expect(driver.callTool.mock.calls.filter(([name]) => name === 'start_session')).toHaveLength(1)
    await provider.dispose()
    expect(driver.shutdown).toHaveBeenCalledOnce()
  })

  it('does not fail delivered input when cursor cleanup throws and retries at disposal', async () => {
    const driver = createDriver({ images: [], text: '', isError: false, structuredJson: '{}' })
    driver.setAgentCursorEnabled.mockResolvedValueOnce({ images: [], text: '', isError: false })
      .mockRejectedValueOnce(new Error('Overlay unavailable'))
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'get_window_state',
      parameters: { pid: 42, window_id: 7 }, profileName: PROFILE_NAME, conversationSessionId: 'cleanup-retry'
    })
    expect(result.success).toBe(true)
    await provider.dispose()
    expect(driver.setAgentCursorEnabled.mock.calls.map(([value]) => value.enabled)).toEqual([false, false, false])
    expect(driver.shutdown).toHaveBeenCalledOnce()
    expect(driver.uniffiDestroy).toHaveBeenCalledOnce()
  })

  it('restores an ended hidden Cua session and retries once', async () => {
    const successfulResult = {
      text: 'Window captured.',
      images: [],
      structuredJson: '{}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const driver = createDriver(successfulResult)
    let observationCount = 0
    driver.callTool.mockImplementation((action: string) => {
      if (action === 'get_window_state' && observationCount++ === 0) {
        return Promise.resolve({
          text: 'The session ended.',
          images: [],
          structuredJson: JSON.stringify({
            status: 'refused',
            refusal: {
              code: 'session_ended',
              message: 'The session ended.'
            }
          }),
          rawJson: '{}',
          errorCode: 'session_ended',
          isError: false,
          degraded: false
        })
      }
      return Promise.resolve(successfulResult)
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'get_window_state',
      parameters: { pid: 42, window_id: 7 },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-recovery'
    })

    expect(result.success).toBe(true)
    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
      'start_session',
      'get_window_state',
      'start_session',
      'get_window_state'
    ])
  })

  it('restores an implicit session without passing a label to catalog actions', async () => {
    const success = { images: [], text: '', structuredJson: '{}', rawJson: '{}', isError: false }
    const driver = createDriver(success)
    driver.callTool.mockResolvedValueOnce({
      ...success,
      structuredJson: JSON.stringify({ status: 'refused', refusal: { code: 'session_ended' } })
    })
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'list_windows',
      parameters: { pid: 42 }, profileName: PROFILE_NAME,
      conversationSessionId: 'implicit-recovery'
    })
    expect(result.success).toBe(true)
    expect(driver.callTool.mock.calls).toEqual([
      ['list_windows', '{"pid":42}'],
      ['start_session', '{}'],
      ['list_windows', '{"pid":42}']
    ])
    expect(driver.setAgentCursorEnabled).not.toHaveBeenCalled()
  })

  it('bounds implicit recovery to one retry and reports a technical blocker', async () => {
    const driver = createDriver({ images: [], text: '', structuredJson: '{}', isError: false })
    driver.callTool.mockImplementation(async (action: string) => ({
      images: [], text: '', structuredJson: '{}',
      isError: action !== 'start_session',
      ...(action !== 'start_session' ? { errorCode: 'session_ended' } : {})
    }))
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'list_windows',
      parameters: {}, profileName: PROFILE_NAME
    })
    expect(result.success).toBe(false)
    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
      'list_windows', 'start_session', 'list_windows'
    ])
    expect(result.output['recovery']).toContain('Automatic session recovery failed')
  })

  it.each(['browser_consent_required', 'cancelled', 'permission_denied'])(
    'does not revive sessions on %s', async (code) => {
      const driver = createDriver({
        images: [], text: '', isError: true, errorCode: code,
        structuredJson: JSON.stringify({ status: 'refused', refusal: { code } })
      })
      const provider = new CuaRuntime(async () => driver as never)
      const result = await provider.execute({
        toolkitId: 'computer_use', toolId: 'cua', functionName: 'list_windows',
        parameters: {}, profileName: PROFILE_NAME
      })
      expect(result.success).toBe(false)
      expect(driver.callTool).toHaveBeenCalledTimes(1)
      expect(result.output['error_code']).toBe(code)
      if (code === 'browser_consent_required') {
        expect(result.output['recovery']).toContain('owner authorization')
      }
    }
  )

  it('does not retry the action when session restoration is refused', async () => {
    const driver = createDriver({ images: [], text: '', structuredJson: '{}', isError: false })
    driver.callTool.mockImplementation(async (action: string) => ({
      images: [], text: '', isError: false,
      structuredJson: JSON.stringify({ status: 'refused', refusal: {
        code: action === 'start_session' ? 'permission_denied' : 'session_ended'
      } })
    }))
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'list_windows',
      parameters: {}, profileName: PROFILE_NAME
    })
    expect(result.success).toBe(false)
    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual(['list_windows', 'start_session'])
  })

  it('runs a mechanical sequence with one final capture by default', async () => {
    const successfulResult = {
      text: 'Done.',
      images: [],
      structuredJson: '{"effect":"confirmed"}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const driver = createDriver(successfulResult)
    driver.callTool.mockImplementation(async (action: string) => ({
      ...successfulResult,
      images: action === 'get_window_state'
        ? [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }] : []
    }))
    driver.listToolsJson.mockResolvedValue(JSON.stringify({ tools:
      ['hotkey', 'type_text', 'press_key', 'get_window_state'].map((name) => ({
        name, inputSchema: { properties: { session: { type: 'string' } } }
      }))
    }))
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'perform_actions',
      parameters: {
        steps: [
          {
            action: 'hotkey',
            parameters: { pid: 42, window_id: 7, keys: ['ctrl', 'l'] }
          },
          {
            action: 'type_text',
            parameters: { pid: 42, window_id: 7, text: 'Leon' }
          },
          {
            action: 'press_key',
            parameters: { pid: 42, window_id: 7, key: 'return' }
          }
        ]
      },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
      'start_session',
      'hotkey',
      'type_text',
      'press_key',
      'get_window_state'
    ])
    expect(driver.setAgentCursorEnabled.mock.calls.map(([value]) => value.enabled)).toEqual([true, false])
    expect(driver.setAgentCursorEnabled.mock.invocationCallOrder[1])
      .toBeLessThan(driver.callTool.mock.invocationCallOrder.at(-1)!)
    expect(result).toMatchObject({
      success: true,
      output: {
        completed_action_count: 3,
        post_action_state: expect.any(Object),
        steps: [
          { action: 'hotkey', success: true },
          { action: 'type_text', success: true },
          { action: 'press_key', success: true }
        ]
      }
    })
  })

  it('settles between batch actions without an intermediate capture', async () => {
    const successfulResult = {
      text: 'Done.',
      images: [],
      structuredJson: '{"effect":"confirmed"}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const driver = createDriver(successfulResult)
    driver.callTool.mockImplementation(async (action: string) => ({
      ...successfulResult,
      images: action === 'get_window_state'
        ? [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }] : []
    }))
    const runtime = new CuaRuntime(async () => driver as never)

    const result = await runtime.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'perform_actions',
      parameters: {
        steps: [
          {
            action: 'press_key',
            parameters: {
              pid: 42,
              window_id: 7,
              key: 'down',
              settle_ms: 1
            }
          },
          {
            action: 'press_key',
            parameters: { pid: 42, window_id: 7, key: 'return' }
          }
        ]
      },
      profileName: PROFILE_NAME,
      conversationSessionId: 'settled-sequence'
    })

    expect(result.success).toBe(true)
    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
      'press_key',
      'press_key',
      'get_window_state'
    ])
    expect(JSON.parse(driver.callTool.mock.calls[0]![1])).not.toHaveProperty(
      'settle_ms'
    )
  })

  it.each([false, true])('reuses field focus only until a focus-changing key (tab=%s)', async (tab) => {
    const observed = { text: '', images: [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }],
      structuredJson: '{"screenshot_width":1,"screenshot_height":1}', rawJson: '{}', isError: false, degraded: false }
    const driver = createDriver({ text: '', images: [], structuredJson: '{"effect":"confirmed"}', isError: false })
    driver.callTool.mockImplementation(async (name) => name === 'get_desktop_state' ? observed :
      { text: '', images: [], structuredJson: '{"effect":"confirmed"}', isError: false })
    const runtime = new CuaRuntime(async () => driver as never)
    const context = { toolkitId: 'computer_use', toolId: 'cua', profileName: PROFILE_NAME,
      conversationSessionId: 'single-field' }
    const observation = await runtime.execute({ ...context, functionName: 'get_desktop_state', parameters: {} })
    driver.callTool.mockClear()
    const target = { kind: 'desktop', display_id: 'primary' }
    const result = await runtime.execute({ ...context, functionName: 'perform_actions', parameters: { steps: [
      { action: 'click', parameters: { target, x: 0, y: 0 } },
      tab ? { action: 'press_key', parameters: { target, key: 'tab' } } :
        { action: 'hotkey', parameters: { target, keys: [process.platform === 'darwin' ? 'cmd' : 'ctrl', 'a'] } },
      { action: 'type_text', parameters: { target, x: 0, y: 0, text: '86.94' } }
    ] } })
    expect(result.success).toBe(!tab)
    expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual(tab ? [] :
      ['start_session', 'click', 'hotkey', 'type_text', 'get_desktop_state'])
    if (!tab) expect(JSON.parse(driver.callTool.mock.calls[3]![1])).toEqual({ target, text: '86.94' })
    for (const artifact of [...observation.output['artifacts'] as Array<{ path: string }>,
      ...(result.output['artifacts'] as Array<{ path: string }> || [])]) {
      await fs.promises.rm(artifact.path, { force: true })
    }
  })

  it.each(['click', 'type_text'])('requires a fresh observation between pixel-targeted %s actions', async (action) => {
    const driver = createDriver({})
    const provider = new CuaRuntime(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'perform_actions',
      parameters: {
        steps: [
          { action, parameters: { x: 10, y: 20, ...(action === 'type_text' ? { text: 'first' } : {}) } },
          { action, parameters: { x: 30, y: 40, ...(action === 'type_text' ? { text: 'second' } : {}) } }
        ]
      },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('at most one pixel-targeted click')
    })
    expect(driver.callTool).not.toHaveBeenCalled()
  })

  it('rejects an unsupported later batch action before delivering any input', async () => {
    const driver = createDriver({})
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'perform_actions',
      profileName: PROFILE_NAME,
      parameters: { steps: [
        { action: 'type_text', parameters: { pid: 42, window_id: 7, text: 'first' } },
        { action: 'launch_app', parameters: {} }
      ] }
    })
    expect(result.success).toBe(false)
    expect(driver.callTool).not.toHaveBeenCalled()
  })

  it('preserves batch refusal diagnostics and stops before the next input', async () => {
    const driver = createDriver({ images: [], text: '', isError: false,
      structuredJson: JSON.stringify({ status: 'refused', refusal: { code: 'browser_consent_required' } }) })
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'perform_actions',
      profileName: PROFILE_NAME,
      parameters: { steps: [
        { action: 'type_text', parameters: { pid: 42, window_id: 7, text: 'first' } },
        { action: 'press_key', parameters: { pid: 42, window_id: 7, key: 'return' } }
      ] }
    })
    expect(result.output).toMatchObject({ completed_action_count: 0,
      error_code: 'browser_consent_required', recovery: expect.stringContaining('owner authorization'),
      steps: [{ action: 'type_text', success: false, error_code: 'browser_consent_required' }] })
    expect(driver.callTool).toHaveBeenCalledTimes(1)
  })

  it('returns final capture guidance and uncertain effects from a batch', async () => {
    const driver = createDriver({ images: [], text: '', isError: false,
      structuredJson: JSON.stringify({ effect: 'unverifiable' }) })
    driver.callTool.mockImplementation(async (action: string) => ({
      images: action === 'get_window_state'
        ? [{ dataBase64: 'aW1hZ2U=', mimeType: 'image/png' }] : [],
      text: '', isError: false, structuredJson: JSON.stringify({ effect: 'unverifiable' })
    }))
    const provider = new CuaRuntime(async () => driver as never)
    const result = await provider.execute({
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'perform_actions',
      profileName: PROFILE_NAME,
      parameters: { capture_after: true, steps: [
        { action: 'press_key', parameters: { pid: 42, window_id: 7, key: 'return' } }
      ] }
    })
    expect(result.output).toMatchObject({
      recovery: expect.stringContaining('does not mean failure'),
      next_step: expect.stringContaining('post-action state'),
      steps: [{ action: 'press_key', result: { effect: 'unverifiable' }, recovery: expect.any(String) }]
    })
    expect(result.output['recovery']).not.toContain('expose the target')
  })

  it.each([{ launchWindows: [] }, { launchWindows: [{ pid: 42, window_id: 1_069_285_376 }] }])('resolves launcher windows $launchWindows through the control backend', async ({ launchWindows }) => {
    vi.useFakeTimers()
    const driver = createDriver({})
    let windowObservationCount = 0
    driver.callTool.mockImplementation((action: string) => {
      if (action === 'launch_app') {
        return Promise.resolve({
          text: 'Application process started.',
          images: [],
          structuredJson: JSON.stringify({
            name: 'Example Editor',
            pid: 42,
            windows: launchWindows
          }),
          rawJson: '{}',
          isError: false,
          degraded: false
        })
      }

      windowObservationCount += 1
      return Promise.resolve({
        text: 'Windows observed.',
        images: [],
        structuredJson: JSON.stringify({
          windows:
            windowObservationCount === 1
              ? []
              : [
                  {
                    app_name: 'Example Editor',
                    pid: 42,
                    window_id: 7,
                    is_on_screen: true
                  }
                ]
        }),
        rawJson: '{}',
        isError: false,
        degraded: false
      })
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    try {
      const execution = provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'launch_app',
        parameters: { name: 'Example Editor' },
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-1'
      })
      await vi.runAllTimersAsync()
      const result = await execution

      expect(result).toMatchObject({
        success: true,
        output: {
          result: {
            window_ready: true,
            windows: [{ pid: 42, window_id: 7 }]
          }
        }
      })
      expect(driver.callTool.mock.calls.map(([name]) => name)).toEqual([
        'list_windows',
        'launch_app',
        'list_windows'
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an unrelated window reported for an application launch', async () => {
    vi.useFakeTimers()
    const driver = createDriver({})
    const terminalWindow = {
      app_name: 'Terminal',
      pid: 10,
      window_id: 1,
      title: 'Working',
      is_on_screen: true
    }
    driver.callTool.mockImplementation((action: string) =>
      Promise.resolve({
        text: action === 'launch_app'
          ? 'Application process started.'
          : 'Windows observed.',
        images: [],
        structuredJson: JSON.stringify(
          action === 'launch_app'
            ? {
                name: 'Calculator',
                pid: 42,
                windows: [{ ...terminalWindow, title: 'Still working' }]
              }
            : { windows: [terminalWindow] }
        ),
        rawJson: '{}',
        isError: false,
        degraded: false
      })
    )
    const provider = new CuaRuntime(
      async () => driver as never
    )

    try {
      const execution = provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'launch_app',
        parameters: { name: 'Calculator' },
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-1'
      })
      await vi.runAllTimersAsync()
      const result = await execution

      expect(result).toMatchObject({
        success: false,
        output: {
          result: { window_ready: false, windows: expect.any(Array) }
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { urls: ['https://example.com'] },
    { launch_path: '/usr/bin/browser-stable', additional_arguments: ['https://example.com'] }
  ])('resolves a URL launch into an existing browser: %j', async (parameters) => {
    vi.useFakeTimers()
    const driver = createDriver({})
    const beforeWindows = [
      {
        app_name: 'Terminal',
        pid: 10,
        window_id: 1,
        title: 'Working',
        z_index: 2,
        is_on_screen: true
      },
      {
        app_name: 'Web Browser',
        pid: 20,
        window_id: 2,
        title: 'Previous page',
        z_index: 3,
        is_on_screen: true
      }
    ]
    let listCount = 0
    driver.callTool.mockImplementation((action: string) => {
      if (action === 'launch_app') {
        return Promise.resolve({
          text: 'URL opened.',
          images: [],
          structuredJson: JSON.stringify({
            name: 'OS URL handler',
            pid: 99,
            windows: []
          }),
          rawJson: '{}',
          isError: false,
          degraded: false
        })
      }

      listCount += 1
      return Promise.resolve({
        text: 'Windows observed.',
        images: [],
        structuredJson: JSON.stringify({
          windows: listCount === 1
            ? beforeWindows
            : [
                { ...beforeWindows[0], title: 'Still working' },
                { ...beforeWindows[1], title: 'Requested page' }
              ]
        }),
        rawJson: '{}',
        isError: false,
        degraded: false
      })
    })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    try {
      const execution = provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'launch_app',
        parameters,
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-1'
      })
      await vi.runAllTimersAsync()
      const result = await execution

      expect(result).toMatchObject({
        success: true,
        output: {
          result: {
            window_ready: true,
            pid: 20,
            windows: [{ window_id: 2, title: 'Requested page' }]
          }
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([true, false])('respects foreground delivery with activity overlay enabled=%s', async (enabled) => {
    const driver = createDriver({
      text: 'Clicked.',
      images: [],
      structuredJson: '{}',
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new CuaRuntime(
      async () => driver as never,
      () => 'visible',
      () => ({}),
      () => enabled
    )

    await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'click',
      parameters: { pid: 42, window_id: 7, element_token: 'element-1', delivery_mode: 'background' },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    const sessionInput = JSON.parse(driver.callTool.mock.calls[0]![1]) as {
      session: string
    }
    expect(driver.callTool.mock.calls[1]).toEqual([
      'click',
      JSON.stringify({
        pid: 42,
        window_id: 7,
        element_token: 'element-1',
        delivery_mode: 'foreground',
        session: sessionInput.session
      })
    ])
    expect(driver.setAgentCursorEnabled).toHaveBeenNthCalledWith(1, {
      session: sessionInput.session,
      enabled
    })
    expect(driver.setAgentCursorEnabled).toHaveBeenLastCalledWith({ session: sessionInput.session, enabled: false })
    await provider.dispose()
  })

  it('retries a browser query while the navigated page has no nodes', async () => {
    vi.useFakeTimers()
    const driver = createDriver({})
    driver.callTool
      .mockResolvedValueOnce({
        text: 'Page is still loading.',
        images: [],
        structuredJson: JSON.stringify({
          refs: [],
          content_refs: [],
          snapshot: { total_nodes: 0 }
        }),
        rawJson: '{}',
        isError: false,
        degraded: false
      })
      .mockResolvedValueOnce({
        text: 'Found one result.',
        images: [],
        structuredJson: JSON.stringify({
          refs: [
            {
              ref: 'p1:1',
              role: 'link',
              name: 'Tony Ann',
              actions: ['click']
            }
          ],
          content_refs: [],
          snapshot: { total_nodes: 42 }
        }),
        rawJson: '{}',
        isError: false,
        degraded: false
      })
    const provider = new CuaRuntime(
      async () => driver as never
    )

    try {
      const execution = provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'get_browser_state',
        parameters: { query: 'Tony Ann' },
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-1'
      })
      await vi.advanceTimersByTimeAsync(500)
      const result = await execution

      expect(driver.callTool).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({
        success: true,
        output: {
          result: {
            refs: [{ ref: 'p1:1', name: 'Tony Ann' }]
          }
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })
})


describe('browser inspection authorization', () => {
  it('allows only the attested existing-profile boundary under an explicit owner grant', async () => {
    const packageDirectory = path.resolve('tools/computer_use/cua/src/nodejs/node_modules/@trycua/cua-driver')
    const packageDefinition = JSON.parse(await fs.promises.readFile(path.join(packageDirectory, 'package.json'), 'utf8'))
    const { DriverAuthorizationAction } = await import(pathToFileURL(path.join(packageDirectory, packageDefinition.exports['.'].import)).href)
    let allowed = false
    const host = await createCuaBrowserAuthorizationHost(() => allowed)
    const request = {
      schema: 'cua-driver-authorization-request-v1', nonce: 'test', generation: 1n,
      daemonInstance: 'test', permissionMode: 'standard', adapterId: 'browser_prepare.existing_profile',
      riskClass: 'r2', publicSession: 'test', transportSession: 'test',
      resourceJson: JSON.stringify({ pid: 42, window_id: 7, endpoint_owner_pid: 42 }),
      humanSummary: 'Inspect this browser', expiresUnixMs: BigInt(Date.now() + 60_000), requestDigest: 'digest'
    }
    expect(await host.authorize(request)).toEqual({ action: DriverAuthorizationAction.Deny, requestDigest: 'digest' })
    allowed = true
    expect(await host.authorize(request)).toEqual({ action: DriverAuthorizationAction.Allow, requestDigest: 'digest' })
    for (const override of [
      { adapterId: 'browser_unbounded_script' }, { permissionMode: 'unrestricted' },
      { schema: 'unknown' }, { riskClass: 'r3' }, { expiresUnixMs: 0n },
      { resourceJson: '{broken' },
      { resourceJson: JSON.stringify({ pid: 42, window_id: 7, endpoint_owner_pid: 99 }) }
    ]) {
      expect((await host.authorize({ ...request, ...override })).action).toBe(DriverAuthorizationAction.Deny)
    }
    allowed = false
    expect((await host.authorize(request)).action).toBe(DriverAuthorizationAction.Deny)
  })

  it('prepares an authorized exact browser once and retries inspection without another model turn', async () => {
    const settingsPath = path.join(getProfilePaths('browser-setup-test').tools, 'computer_use', 'cua', 'settings.json')
    const driver = createDriver({ images: [], text: '', structuredJson: '{}', isError: false })
    const refused = { images: [], text: '', structuredJson: JSON.stringify({
      status: 'refused', refusal: { code: 'browser_consent_required' }
    }), isError: true }
    const observed = { images: [], text: '', structuredJson: JSON.stringify({ refs: [], content_refs: [] }), isError: false }
    driver.callTool.mockResolvedValueOnce(refused).mockResolvedValueOnce(observed).mockResolvedValueOnce(observed)
    const provider = new CuaRuntime(async () => driver as never)
    try {
      await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.promises.writeFile(settingsPath, JSON.stringify({ browser_inspection: { allow_existing_profile: true } }))
      const result = await provider.execute({ toolkitId: 'computer_use', toolId: 'cua',
        profileName: 'browser-setup-test', functionName: 'get_browser_state',
        parameters: { pid: 42, window_id: 7 }, conversationSessionId: null })
      expect(result.success).toBe(true)
      expect(driver.callTool.mock.calls.map(([action]) => action)).toEqual([
        'get_browser_state', 'browser_prepare', 'get_browser_state'
      ])
      expect(JSON.parse(driver.callTool.mock.calls[1]?.[1])).toEqual({
        pid: 42, window_id: 7, strategy: { kind: 'existing_profile' }
      })
      driver.callTool.mockClear().mockResolvedValue(refused)
      const failure = await provider.execute({ toolkitId: 'computer_use', toolId: 'cua',
        profileName: 'browser-setup-test', functionName: 'get_browser_state',
        parameters: { pid: 42, window_id: 7 }, conversationSessionId: null })
      expect(failure.success).toBe(false)
      expect(driver.callTool).toHaveBeenCalledTimes(2)
    } finally {
      await provider.dispose()
      await fs.promises.rm(settingsPath, { force: true })
    }
  })

  it('revokes existing runtime grants when the owner changes the profile setting', async () => {
    const settingsPath = path.join(getProfilePaths('browser-permission-test').tools, 'computer_use', 'cua', 'settings.json')
    const driver = createDriver({ images: [], text: '', structuredJson: '{}', isError: false })
    const factory = vi.fn(async () => driver as never)
    const provider = new CuaRuntime(factory)
    const input = {
      toolkitId: 'computer_use', toolId: 'cua', profileName: 'browser-permission-test',
      functionName: 'list_windows', parameters: {}, conversationSessionId: null
    }
    try {
      await provider.execute(input)
      await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.promises.writeFile(settingsPath, JSON.stringify({ browser_inspection: { allow_existing_profile: true } }))
      await provider.execute(input)
      expect(factory).toHaveBeenCalledTimes(2)
      await fs.promises.writeFile(settingsPath, JSON.stringify({ browser_inspection: { allow_existing_profile: false } }))
      await provider.execute(input)
      expect(factory).toHaveBeenCalledTimes(3)
      expect(driver.shutdown).toHaveBeenCalledTimes(2)
      expect(driver.uniffiDestroy).toHaveBeenCalledTimes(2)
    } finally {
      await provider.dispose()
      await fs.promises.rm(settingsPath, { force: true })
    }
  })
})
