import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpeg from 'ffmpeg-static'
import { afterEach, describe, expect, it } from 'vitest'

import { collectSatelliteArtifacts, receiveSatelliteArtifacts } from '@/core/satellite/satellite-artifacts'
import type { ToolExecutionResult } from '@/core/tool-executor'
import { ComputerUseArtifactStore } from '@@/tools/computer_use/cua/src/nodejs/lib/computer-use-artifact-store'
import type { PersistedComputerUseImages } from '@@/tools/computer_use/cua/src/nodejs/lib/types'

const execute = promisify(execFile)
const temporaryRoots: string[] = []
const result = (output: Record<string, unknown>): ToolExecutionResult => ({
  status: 'success', message: 'done', data: {
    tool_id: 'cua', toolkit_id: 'computer_use', function_name: 'capture',
    input: null, parsed_input: null, output
  }
})

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-satellite-artifacts-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Satellite session artifact integration', () => {
  it('renders from transferred PNGs and capture metadata after the device files are removed', async () => {
    const temporary = await temporaryRoot()
    const device = path.join(temporary, 'device', 'artifacts')
    const serverHome = path.join(temporary, 'server')
    const server = path.join(serverHome, 'profiles', 'test', 'sessions', 'session', 'artifacts')
    const recording = path.join(device, 'computer-use', 'recordings', 'recording')
    await fs.mkdir(recording, { recursive: true })
    const startup = result({ output_dir: recording })
    const transferredStartup = await receiveSatelliteArtifacts(server, startup, (await collectSatelliteArtifacts(device, startup))!)
    const steps = []
    for (const color of ['blue', 'green']) {
      const screenshot = path.join(device, 'computer-use', `${color}.png`)
      await execute(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`, '-frames:v', '1', screenshot])
      const images: PersistedComputerUseImages = {
        artifacts: [{ path: screenshot, mime_type: 'image/png' }], modelFiles: [], setOfMark: [], visualStateId: null,
        transform: { source: { width: 640, height: 360 }, model: { width: 640, height: 360 } }
      }
      await new ComputerUseArtifactStore().persistCaptureMetadata(images, {
        elements: [{ element_token: color, label: color, pixel_center: { x: 100, y: 100 }, pixel_bounds: { x: 80, y: 80, width: 40, height: 40 } }]
      })
      const observation = result({ artifacts: images.artifacts })
      const bundle = (await collectSatelliteArtifacts(device, observation))!
      const transferred = await receiveSatelliteArtifacts(server, observation, bundle)
      // Repeated evidence is idempotent, but never overwrites different bytes.
      await receiveSatelliteArtifacts(server, observation, bundle)
      const artifacts = transferred.data.output['artifacts'] as Array<{ path: string }>
      expect(artifacts).toHaveLength(2)
      const screenshotPath = artifacts[0]!.path
      expect(await fs.readFile(screenshotPath)).toEqual(await fs.readFile(screenshot))
      expect(await fs.readFile(`${screenshotPath}.json`)).toEqual(await fs.readFile(`${screenshot}.json`))
      steps.push({ screenshotPath, targetToken: color, instruction: `Show the ${color} control.` })
    }
    // Separate machines cannot rely on a shared filesystem or a device path fallback.
    await fs.rm(device, { recursive: true })
    const manifest = path.join(temporary, 'manifest.json')
    await fs.writeFile(manifest, JSON.stringify({ outputDir: transferredStartup.data.output['output_dir'], steps }))
    const rendered = await execute(process.execPath, ['skills/agent/live-tutorial/scripts/render-tutorial.mjs', '--manifest', manifest], {
      env: { ...process.env, LEON_HOME: serverHome, LEON_PROFILE: 'test', LEON_SESSION_ID: 'session', LEON_CODEBASE_PATH: process.cwd() },
      timeout: 60_000
    })
    const video = JSON.parse(rendered.stdout)
    expect(video.success).toBe(true)
    expect(video.stepCount).toBe(2)
    expect(video.resolvedTargets).toEqual(['blue', 'green'])
    expect(video.sizeBytes).toBeGreaterThan(0)
    await execute(ffmpeg!, ['-v', 'error', '-xerror', '-i', video.filePath, '-f', 'null', '-'])
  })

  it('rejects traversal, symlinks, overwrites and oversized transfers; maps Windows paths on a Unix server', async () => {
    const temporary = await temporaryRoot()
    const root = path.join(temporary, 'artifacts')
    const foreignRoot = 'C:\\Leon\\profiles\\owner\\sessions\\session\\artifacts'
    const observation = result({ path: `${foreignRoot}\\computer-use\\frame.png` })
    for (const filename of ['../secret', '/absolute', 'a/../../secret', 'C:/secret', 'a\\..\\secret']) {
      await expect(receiveSatelliteArtifacts(root, observation, { root: foreignRoot, entries: [{ path: filename }] })).rejects.toThrow('path')
    }
    const bundle = { root: foreignRoot, entries: [{ path: 'computer-use/frame.png', dataBase64: Buffer.from('original').toString('base64') }] }
    expect((await receiveSatelliteArtifacts(root, observation, bundle)).data.output['path']).toBe(path.join(root, 'computer-use/frame.png'))
    await expect(receiveSatelliteArtifacts(root, observation, { ...bundle, entries: [{ ...bundle.entries[0]!, dataBase64: Buffer.from('changed').toString('base64') }] })).rejects.toThrow('conflicts')
    const external = path.join(temporary, 'other-session')
    await fs.mkdir(external)
    await fs.symlink(external, path.join(root, 'escape'), 'dir')
    await expect(receiveSatelliteArtifacts(root, observation, { root: foreignRoot, entries: [{ path: 'escape/secret', dataBase64: 'eA==' }] })).rejects.toThrow('symlinks')
    await fs.writeFile(path.join(external, 'secret'), 'private')
    await expect(collectSatelliteArtifacts(root, result({ path: path.join(root, 'escape/secret') }))).rejects.toThrow('escapes')
    await expect(receiveSatelliteArtifacts(root, observation, { root: foreignRoot, entries: [{ path: 'huge', dataBase64: Buffer.alloc(8 * 1_024 * 1_024 + 1).toString('base64') }] })).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'computer-use/frame.png'), 'utf8')).toBe('original')
  })
})
