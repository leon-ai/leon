import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  COMPUTER_USE_ACTION_NAMES,
  ComputerUseToolProvider,
  calculateComputerUseModelImageDimensions,
  mapComputerUsePointToSource,
  shouldUseCuaSafeX11Input
} from '@/core/computer-use/computer-use-tool-provider'

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

describe('ComputerUseToolProvider', () => {
  it('keeps preferred_apps last in the default computer-use settings', () => {
    const settings = JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          'tools',
          'computer_use',
          'cua',
          'settings.sample.json'
        ),
        'utf8'
      )
    ) as Record<string, unknown>

    expect(settings).toEqual({
      interaction_mode: 'background',
      activity_overlay: { enabled: true },
      set_of_mark: { mode: 'auto' },
      preferred_apps: {}
    })
    expect(Object.keys(settings).at(-1)).toBe('preferred_apps')
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
    const provider = new ComputerUseToolProvider(
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
    const provider = new ComputerUseToolProvider()

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

  it('does not nest post-action capture through a remote owner-device bridge', async () => {
    const previousUrl = process.env['LEON_COMPUTER_USE_REMOTE_URL']
    process.env['LEON_COMPUTER_USE_REMOTE_URL'] = 'http://owner-device.test/execute'
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
        JSON.stringify({
          status: 'ok',
          output: {
            effect: 'unverifiable',
            route: 'global_input'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ComputerUseToolProvider()

    try {
      const result = await provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'click',
        parameters: {
          pid: 42,
          window_id: 7,
          x: 10,
          y: 20,
          capture_after: true
        },
        profileName: PROFILE_NAME,
        conversationSessionId: 'session-remote'
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0]![1]?.body).toContain(
        '"action":"start_session"'
      )
      expect(fetchMock.mock.calls[1]![1]?.body).toContain('"action":"click"')
      expect(result).toMatchObject({
        success: true,
        output: {
          result: {
            effect: 'unverifiable',
            route: 'global_input'
          }
        }
      })
      expect(result.output).not.toHaveProperty('post_action_state')
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

  it('keeps the manifest action inventory aligned with the provider', () => {
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
    const provider = new ComputerUseToolProvider(
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

  it.each(['kill_app', 'zoom', 'set_agent_cursor_enabled'])(
    'rejects %s outside the curated surface before calling Cua',
    async (functionName) => {
    const driver = createDriver({})
    const provider = new ComputerUseToolProvider(
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
    const provider = new ComputerUseToolProvider(
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
    const provider = new ComputerUseToolProvider(
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
    const provider = new ComputerUseToolProvider(
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
    const provider = new ComputerUseToolProvider(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'type_text',
      parameters: { text: 'Hello' },
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
    const provider = new ComputerUseToolProvider(
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
    expect(driver.setAgentCursorEnabled).toHaveBeenCalledOnce()
    expect(driver.setAgentCursorEnabled).toHaveBeenCalledWith({
      session: sessionInput.session,
      enabled: true
    })
    expect(driver.callTool.mock.calls[1]).toEqual([
      'get_window_state',
      JSON.stringify({
        max_elements: 200,
        max_depth: 6,
        pid: 42,
        window_id: 7,
        session: sessionInput.session
      })
    ])
    expect(
      driver.callTool.mock.calls.filter(([name]) => name === 'start_session')
    ).toHaveLength(1)
  })

  it('can disable the owner-visible Cua activity overlay', async () => {
    const driver = createDriver({
      text: 'Window captured.',
      images: [],
      structuredJson: '{}',
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new ComputerUseToolProvider(
      async () => driver as never,
      () => 'background',
      () => ({}),
      () => false
    )

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
    expect(driver.setAgentCursorEnabled).toHaveBeenCalledWith({
      session: sessionInput.session,
      enabled: false
    })
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
    const provider = new ComputerUseToolProvider(
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

  it('runs a grounded mechanical sequence without intermediate model turns', async () => {
    const successfulResult = {
      text: 'Done.',
      images: [],
      structuredJson: '{"effect":"confirmed"}',
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const driver = createDriver(successfulResult)
    const provider = new ComputerUseToolProvider(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'perform_actions',
      parameters: {
        capture_after: true,
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
      'hotkey',
      'type_text',
      'press_key',
      'get_window_state'
    ])
    expect(result).toMatchObject({
      success: true,
      output: {
        completed_action_count: 3,
        steps: [
          { action: 'hotkey', success: true },
          { action: 'type_text', success: true },
          { action: 'press_key', success: true }
        ]
      }
    })
  })

  it('requires a fresh observation between multiple pixel-targeted clicks', async () => {
    const driver = createDriver({})
    const provider = new ComputerUseToolProvider(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'perform_actions',
      parameters: {
        steps: [
          { action: 'click', parameters: { x: 10, y: 20 } },
          { action: 'click', parameters: { x: 30, y: 40 } }
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

  it('waits for a launched application to expose a usable window', async () => {
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
            windows: []
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
    const provider = new ComputerUseToolProvider(
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
    const provider = new ComputerUseToolProvider(
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

  it('resolves a URL launch when the frontmost existing window changes', async () => {
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
    const provider = new ComputerUseToolProvider(
      async () => driver as never
    )

    try {
      const execution = provider.execute({
        toolkitId: 'computer_use',
        toolId: 'cua',
        functionName: 'launch_app',
        parameters: { urls: ['https://example.com'] },
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
            windows: [{ window_id: 2, title: 'Requested page' }]
          }
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses foreground delivery while independently enabling the activity overlay', async () => {
    const driver = createDriver({
      text: 'Clicked.',
      images: [],
      structuredJson: '{}',
      rawJson: '{}',
      isError: false,
      degraded: false
    })
    const provider = new ComputerUseToolProvider(
      async () => driver as never,
      () => 'visible'
    )

    await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'click',
      parameters: { pid: 42, window_id: 7, element_token: 'element-1' },
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
    expect(driver.setAgentCursorEnabled).toHaveBeenCalledWith({
      session: sessionInput.session,
      enabled: true
    })
  })

  it('can return the resulting visual state with the action', async () => {
    const driver = createDriver({})
    driver.callTool
      .mockResolvedValueOnce({
        text: 'Session ready.',
        images: [],
        structuredJson: '{}',
        rawJson: '{}',
        isError: false,
        degraded: false
      })
      .mockResolvedValueOnce({
        text: 'Clicked.',
        images: [],
        structuredJson: '{"effect":"confirmed"}',
        rawJson: '{}',
        isError: false,
        degraded: false
      })
      .mockResolvedValueOnce({
        text: 'Window captured.',
        images: [],
        structuredJson: '{"title":"Leon"}',
        rawJson: '{}',
        isError: false,
        degraded: false
      })
    const provider = new ComputerUseToolProvider(
      async () => driver as never
    )

    const result = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'click',
      parameters: {
        pid: 42,
        window_id: 7,
        x: 10,
        y: 20,
        capture_after: true
      },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })

    expect(driver.callTool.mock.calls[1]).toEqual([
      'click',
      expect.not.stringContaining('capture_after')
    ])
    expect(driver.callTool.mock.calls[2]).toEqual([
      'get_window_state',
      expect.stringContaining('"window_id":7')
    ])
    expect(result).toMatchObject({
      success: true,
      output: {
        result: { effect: 'confirmed' },
        post_action_state: { title: 'Leon' }
      }
    })
  })

  it('marks an unchanged captured action as a suspected no-op', async () => {
    const screenshot = Buffer.from('same screenshot').toString('base64')
    const successfulResult = {
      images: [],
      rawJson: '{}',
      isError: false,
      degraded: false
    }
    const driver = createDriver({})
    driver.callTool
      .mockResolvedValueOnce({
        ...successfulResult,
        text: 'Session ready.',
        structuredJson: '{}'
      })
      .mockResolvedValueOnce({
        ...successfulResult,
        text: 'Window captured.',
        images: [{ dataBase64: screenshot, mimeType: 'image/png' }],
        structuredJson: '{"screenshot_width":1,"screenshot_height":1}'
      })
      .mockResolvedValueOnce({
        ...successfulResult,
        text: 'Clicked.',
        structuredJson: '{"effect":"unverifiable","route":"global_input"}'
      })
      .mockResolvedValueOnce({
        ...successfulResult,
        text: 'Window captured.',
        images: [{ dataBase64: screenshot, mimeType: 'image/png' }],
        structuredJson: '{"screenshot_width":1,"screenshot_height":1}'
      })
    const provider = new ComputerUseToolProvider(
      async () => driver as never
    )

    const observation = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'get_window_state',
      parameters: { pid: 42, window_id: 7 },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })
    const action = await provider.execute({
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'click',
      parameters: {
        pid: 42,
        window_id: 7,
        x: 10,
        y: 20,
        capture_after: true
      },
      profileName: PROFILE_NAME,
      conversationSessionId: 'session-1'
    })
    const artifacts = [observation, action].flatMap(
      (result) =>
        (result.output['artifacts'] as Array<{ path: string }> | undefined) || []
    )

    try {
      expect(action).toMatchObject({
        success: true,
        message:
          'Computer input was delivered, but the captured interface did not change. Treat the intended effect as unverified.',
        output: {
          result: { effect: 'suspected_noop', route: 'global_input' },
          visual_change: {
            status: 'unchanged',
            comparison: 'exact_capture'
          }
        }
      })
    } finally {
      await Promise.all(
        artifacts.map((artifact) =>
          fs.promises.rm(artifact.path, { force: true })
        )
      )
    }
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
    const provider = new ComputerUseToolProvider(
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
