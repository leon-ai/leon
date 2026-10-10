import { ToolConcurrency } from '@/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

import { ToolWorkerManager } from '@/core/tool-manager/tool-worker-manager'
import type { ToolRuntimeResult } from '@sdk/tool-runtime-types'
import { extractArchive } from '@sdk/utils'
import { runRipgrep } from '@@/tools/file_system/ripgrep/src/nodejs/lib/run-ripgrep'
import { DocumentReader } from '@@/tools/file_system/file/src/nodejs/lib/document-reader'

const LARGE_RESULT_BYTES = 4 * 1_024 * 1_024

it.each(['recordLimit', 'timeout', 'canceled'])(
  'preserves the %s guard while awaiting an asynchronous ripgrep sink',
  async (reason) => {
    const controller = new AbortController()
    const program = reason === 'timeout'
      ? 'setInterval(() => {}, 1000)'
      : 'process.stdout.write(Buffer.from([97, 0, 98, 0]))'
    const consume = vi.fn(async () => {
      if (reason === 'canceled') {
        controller.abort()
        return true
      }

      return false
    })
    expect(await runRipgrep(
      process.execPath, ['-e', program], reason === 'timeout' ? 100 : 5_000,
      0, consume, controller.signal
    )).toEqual({ truncated: true, reason })
    expect(consume).toHaveBeenCalledTimes(reason === 'timeout' ? 0 : 1)
  }
)

let home = ''
let manager: ToolWorkerManager

it('keeps scaffold slides readable while evidence handoffs animate without click steps', async () => {
  await fixture(false)

  const project = path.join(home, 'presentation')
  const context = {
    toolkitId: 'document', toolId: 'slidev',
    profileName: 'a', conversationSessionId: 'presentation', parameters: {}
  }
  const run = async (functionName: string, args: unknown[]): Promise<Record<string, unknown>> => {
    const result = await manager.execute(
      { ...context, functionName }, args, () => {},
      { concurrency: ToolConcurrency.Serial }
    )

    expect(result.success, JSON.stringify(result)).toBe(true)

    return result.output['result'] as Record<string, unknown>
  }

  await run('create', [project, 'Evidence handoffs'])
  const checked = await run('check', [project])

  expect(checked, JSON.stringify(checked)).toMatchObject({
    ok: true, scope: 'full', complete: true, checkedStates: 5, findingCount: 0,
    durationMs: expect.any(Number)
  })
  expect(await run('check', [project, { slides: [3] }])).toMatchObject({
    ok: true, scope: 'targeted', complete: false, checkedStates: 1, findingCount: 0
  })

  const live = await run('present', [project, { openBrowser: false }])
  const require = createRequire(path.resolve('tools/document/slidev/src/nodejs/package.json'))
  const { chromium } = require('playwright-chromium') as typeof import('../../../tools/document/slidev/src/nodejs/node_modules/playwright-chromium')
  const browser = await chromium.launch()

  try {
    const page = await browser.newPage()

    await page.addInitScript(() => localStorage.setItem('slidev-wake-lock', 'false'))
    await page.goto(live['audienceUrl'] as string, { waitUntil: 'networkidle' })

    for (let slide = 1; slide <= 5; slide += 1) {
      await expect.poll(() => page.evaluate('window.__slidev__.nav.currentSlideNo')).toBe(slide)
      expect(await page.evaluate('window.__slidev__.nav.clicksTotal')).toBe(0)

      if (slide === 3) {
        const cards = page.locator('.slidev-page-3 .card')
        const packet = page.locator('.slidev-page-3 .handoff-packet')
        const position = await packet.evaluate((element) => getComputedStyle(element).left)

        expect(await cards.count()).toBe(3)
        expect(await cards.evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === '1'))).toBe(true)
        await expect.poll(() => packet.evaluate((element) => getComputedStyle(element).left)).not.toBe(position)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        expect(await packet.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
        expect(await cards.first().isVisible()).toBe(true)
      }

      await page.keyboard.press('ArrowRight')
    }
  } finally {
    await browser.close()
  }
}, 60_000)

it('delivers animated browser presentations, static exports and editable sources through profile workers', async () => {
  await fixture(false)

  const project = path.join(home, 'presentation')
  const context = {
    toolkitId: 'document', toolId: 'slidev',
    profileName: 'a', conversationSessionId: 'presentation', parameters: {}
  }
  const run = async (functionName: string, args: unknown[]): Promise<Record<string, unknown>> => {
    const result = await manager.execute(
      { ...context, functionName }, args, () => {},
      { concurrency: ['present', 'stop'].includes(functionName) ? ToolConcurrency.Serial : ToolConcurrency.Parallel }
    )

    expect(result.success, JSON.stringify(result)).toBe(true)

    return { ...result.output['result'] as Record<string, unknown>, modelFiles: result.modelFiles }
  }
  const created = await run('create', [project, 'Leon mechanisms'])
  await expect(fs.stat(path.join(project, 'pnpm-workspace.yaml'))).rejects.toThrow()
  const source = created['entryPath'] as string
  const markdown = `---
theme: default
title: Leon mechanisms
fonts:
  provider: none
monaco: false
twoslash: false
mcp: false
canvasWidth: 1280
aspectRatio: 16/9
---

# Ground, act, verify

<lucide-shield-check />

<div v-click id="reveal">Tools return inspectable evidence.</div>

<!-- Private speaker note for the presenter. -->

---

# Profile isolation

Every profile owns its settings, sessions and artifacts.
`

  await fs.writeFile(source, markdown)
  await fs.writeFile(path.join(project, '.env'), 'PRIVATE_FIXTURE=secret')

  const duplicate = await manager.execute({ ...context, functionName: 'create' }, [project, 'Duplicate'], () => {})

  expect(duplicate.success).toBe(false)
  expect(await fs.readFile(source, 'utf8')).toBe(markdown)

  const inspected = await run('inspect', [project])

  expect(inspected).toMatchObject({ title: 'Leon mechanisms', slideCount: 2 })

  const preview = await run('preview', [project, [{ slide: 1, click: 0 }, { slide: 1, click: 1 }]])

  expect(preview, JSON.stringify(preview)).toMatchObject({ ok: true, modelPreviewCount: 2, checkedStates: 2 })
  expect(preview['modelFiles']).toHaveLength(2)
  expect(preview['states']).toMatchObject([{ totalClicks: 1 }, { totalClicks: 1 }])

  const previews = preview['artifacts'] as Array<{ path: string }>

  expect((await fs.readFile(previews[0]!.path)).equals(await fs.readFile(previews[1]!.path))).toBe(false)

  const checked = await run('check', [project])

  expect(checked).toMatchObject({ ok: true, checkedStates: 3, findingCount: 0 })

  for (const format of ['pdf', 'png', 'pptx', 'pptx-editable']) {
    const exported = await run('export', [project, { format, withClicks: true }])
    const artifacts = exported['artifacts'] as Array<{ path: string, filename: string }>
    const primary = await fs.readFile(artifacts[0]!.path)

    expect(exported['animated']).toBe(false)
    expect(primary.length).toBeGreaterThan(100)
    expect(artifacts.some((artifact) => artifact.filename === 'presentation-source.zip')).toBe(false)

    if (format === 'pdf') {
      expect(primary.subarray(0, 4).toString()).toBe('%PDF')
    } else if (format === 'png') {
      expect(primary.subarray(1, 4).toString()).toBe('PNG')
      expect(artifacts).toHaveLength(3)
    } else {
      const unpacked = path.join(home, format)
      const archive = path.join(home, `${format}.zip`)

      await fs.copyFile(artifacts[0]!.path, archive)
      await extractArchive(archive, unpacked)
      expect(await fs.readdir(path.join(unpacked, 'ppt', 'slides'))).toContain('slide3.xml')

      if (format === 'pptx-editable') {
        expect(await fs.readFile(path.join(unpacked, 'ppt', 'slides', 'slide1.xml'), 'utf8')).toContain('Ground, act, verify')
      }
    }
  }

  const web = await run('export', [project, { includeSource: true }])
  const artifacts = web['artifacts'] as Array<{ path: string, filename: string }>
  const viewer = path.join(home, 'viewer')
  const editable = path.join(home, 'editable')

  expect(web['animated']).toBe(true)
  expect(web).not.toHaveProperty('presentationUrl')
  expect(artifacts[0]!.path).toContain(path.join(home, 'profiles', 'a', 'sessions', 'presentation'))
  await extractArchive(artifacts[0]!.path, viewer)
  await extractArchive(artifacts[1]!.path, editable)
  expect(await fs.readFile(path.join(editable, 'slides.md'), 'utf8')).toBe(markdown)
  expect(await fs.readFile(path.join(editable, '.pnpmfile.mjs'), 'utf8')).toBe(
    await fs.readFile(path.join(project, '.pnpmfile.mjs'), 'utf8')
  )
  expect(await fs.stat(path.join(editable, '.env')).catch(() => null)).toBeNull()

  const require = createRequire(path.resolve('tools/document/slidev/src/nodejs/package.json'))
  const { chromium } = require('playwright-chromium') as typeof import('../../../tools/document/slidev/src/nodejs/node_modules/playwright-chromium')
  const browser = await chromium.launch()
  const server = spawn(process.execPath, [path.join(viewer, 'serve.mjs'), '0'], { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    const url = await new Promise<string>((resolve, reject) => {
      server.once('error', reject)
      server.once('exit', (code) => reject(new Error(`Viewer exited with ${code}`)))
      server.stdout.once('data', (data: Buffer) => resolve(data.toString().trim().replace('Present at ', '')))
    })
    const page = await browser.newPage()

    await page.addInitScript(() => localStorage.setItem('slidev-wake-lock', 'false'))
    await page.goto(url, { waitUntil: 'networkidle' })
    await expect.poll(() => page.locator('#reveal').evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
    expect(await page.locator('.slidev-page-1 .slidev-layout svg').count()).toBeGreaterThan(0)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.locator('#reveal').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.locator('.slidev-page-2').isVisible()).toBe(true)

    // Observe OS opening requests without launching an application in the test.
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const bin = path.join(home, 'bin')
      const opener = path.join(bin, process.platform === 'darwin' ? 'open' : 'xdg-open')

      await fs.mkdir(bin)
      await fs.writeFile(opener, `#!/usr/bin/env node
require('node:fs').appendFileSync(require('node:path').join(process.env.LEON_HOME, 'opened-urls'), process.argv[2] + '\\n')
`, { mode: 0o755 })
      vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env['PATH']}`)
      vi.stubEnv('DISPLAY', ':fixture')
    }

    const live = await run('present', [project, { openBrowser: false }])
    const audienceUrl = live['audienceUrl'] as string
    const presenterUrl = live['presenterUrl'] as string
    const sessionId = live['sessionId'] as string

    expect(live).toMatchObject({ running: true, reused: false, browserOpened: false, urlScope: 'tool-host' })
    expect(await run('present', [project, { openBrowser: false }])).toMatchObject({
      sessionId, audienceUrl, presenterUrl, reused: true
    })

    if (process.platform === 'linux' || process.platform === 'darwin') {
      expect(await fs.stat(path.join(home, 'opened-urls')).catch(() => null)).toBeNull()
      expect(await run('present', [project])).toMatchObject({ browserOpened: true, url: audienceUrl })
      expect(await run('present', [project, { view: 'presenter' }])).toMatchObject({
        browserOpened: true, url: presenterUrl, reused: true
      })
      expect((await fs.readFile(path.join(home, 'opened-urls'), 'utf8')).trim().split('\n'))
        .toEqual([audienceUrl, presenterUrl])

      const opener = path.join(home, 'bin', process.platform === 'darwin' ? 'open' : 'xdg-open')

      await fs.writeFile(opener, '#!/usr/bin/env node\nprocess.exit(1)\n')
      expect(await run('present', [project])).toMatchObject({
        running: true, reused: true, browserOpened: false, browserError: expect.any(String)
      })
    }

    for (const other of [
      { ...context, conversationSessionId: 'another-conversation' },
      { ...context, profileName: 'b' }
    ]) {
      const denied = await manager.execute(
        { ...other, functionName: 'stop' }, [sessionId], () => {},
        { concurrency: ToolConcurrency.Serial }
      )

      expect(denied.success).toBe(false)
      expect(denied.message).toContain('unavailable in this conversation')
    }

    await page.goto(audienceUrl, { waitUntil: 'networkidle' })
    await expect.poll(() => page.locator('#reveal').evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.locator('#reveal').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')

    const presenter = await browser.newPage()

    await presenter.addInitScript(() => localStorage.setItem('slidev-wake-lock', 'false'))
    await presenter.goto(presenterUrl, { waitUntil: 'networkidle' })
    await expect.poll(() => presenter.locator('body').innerText()).toContain('Private speaker note for the presenter.')
    await presenter.keyboard.press('ArrowRight')
    await presenter.keyboard.press('ArrowRight')
    await expect.poll(() => presenter.evaluate('window.__slidev__.nav.currentSlideNo')).toBe(2)
    await expect.poll(() => page.evaluate('window.__slidev__.nav.currentSlideNo')).toBe(2)

    expect(await run('stop', [sessionId])).toMatchObject({ running: false })
    await expect.poll(() => fetch(audienceUrl).then(() => true, () => false)).toBe(false)

    const restarted = await run('present', [project, { openBrowser: false }])

    expect(restarted['sessionId']).not.toBe(sessionId)
    await manager.dispose()
    await expect.poll(() => fetch(restarted['audienceUrl'] as string).then(() => true, () => false)).toBe(false)
    manager = new ToolWorkerManager()
  } finally {
    server.kill()
    await browser.close()
  }

  await fs.writeFile(source, markdown.replace(
    'Every profile owns',
    '<img :src="\'/missing.png\'" />\n\nEvery profile owns'
  ))

  expect(await run('check', [project])).toMatchObject({ ok: false })
  expect(await run('check', [project, { slides: [1] }])).toMatchObject({
    ok: true, scope: 'targeted', complete: false, checkedStates: 2
  })
  expect(await run('check', [project, { slides: [2] }])).toMatchObject({
    ok: false, scope: 'targeted', complete: false, checkedStates: 1
  })
  expect(await run('check', [project, { slides: [3] }])).toMatchObject({
    ok: false, complete: false, errors: expect.arrayContaining(['Slide 3 does not exist.'])
  })
}, 300_000)

it('renders seekable HTML motion into durable profile artifacts and returns actionable validation findings', async () => {
  await fixture(false)

  const project = path.join(home, 'motion-project')
  const source = path.join(project, 'index.html')
  const context = {
    toolkitId: 'media_production', toolId: 'hyperframes',
    profileName: 'a', conversationSessionId: 'motion', parameters: {}
  }
  const run = (functionName: string, args: unknown[]): Promise<ToolRuntimeResult> =>
    manager.execute({ ...context, functionName }, args, () => {})
  const created = await run('create', [project, 'landscape'])

  expect(created.success, created.message).toBe(true)
  expect((await fs.stat(path.join(project, 'assets', 'gsap.min.js'))).size)
    .toBeGreaterThan(0)
  const scaffold = await run('check', [project])

  expect(scaffold.success, scaffold.message).toBe(true)
  expect(scaffold.output['result']).toMatchObject({
    scope: 'full', complete: true, durationMs: expect.any(Number),
    checks: { ok: true, browserSkipped: false }
  })
  expect((await run('inspect', [project])).output['result']).toMatchObject({
    timeline: { timeline: { duration: 6 } }
  })

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; }
#root { position: relative; width: 100%; height: 100%; background: #101010; }
#marker { position: absolute; left: 20px; top: 30px; width: 30px; height: 30px; background: #ee3a85; }
</style><script src="assets/gsap.min.js"></script></head>
<body><div id="root" data-composition-id="motion" data-start="0" data-duration="1" data-width="320" data-height="180" data-fps="12">
<div id="marker" class="clip" data-start="0" data-duration="1" data-track-index="0"></div>
</div><script>
const timeline = gsap.timeline({ paused: true });
timeline.fromTo('#marker', { x: 0 }, { x: 100, duration: 1, ease: 'none' }, 0);
window.__timelines.motion = timeline;
</script></body></html>`

  await fs.writeFile(source, html)

  const duplicate = await run('create', [project])

  expect(duplicate.success).toBe(false)
  expect(await fs.readFile(source, 'utf8')).toBe(html)

  const inspected = await run('inspect', [project])

  expect(inspected.success, inspected.message).toBe(true)
  expect(inspected.output['result']).toMatchObject({
    timeline: { timeline: { duration: 1 } }
  })

  const checked = await run('check', [project])

  expect(checked.success, checked.message).toBe(true)
  expect(checked.output['result']).toMatchObject({
    scope: 'full', complete: true, checks: { ok: true, browserSkipped: false }
  })
  expect((await run('check', [project, { mode: 'lint' }])).output['result']).toMatchObject({
    scope: 'lint', complete: false, checks: { ok: true, browserSkipped: true }
  })
  expect((await run('check', [project, { mode: 'targeted', times: [0.5] }])).output['result']).toMatchObject({
    scope: 'targeted', complete: false,
    checks: { ok: true, browserSkipped: false, layout: { samples: [0.5] } }
  })
  expect((await run('check', [project, { mode: 'targeted', times: [] }])).success).toBe(false)
  expect((await run('check', [project, { mode: 'targeted', times: [0.5, 2] }])).success).toBe(false)
  expect((await run('check', [project, { times: [0.5] }])).success).toBe(false)

  const preview = await run('preview', [project, [0, 0.5]])

  expect(preview.success, preview.message).toBe(true)
  expect(preview.modelFiles).toMatchObject([{ mediaType: 'image/jpeg' }])
  expect(preview.output['result']).toMatchObject({
    modelPreviewAttached: true,
    artifacts: [
      { mime_type: 'image/png', filename: expect.any(String) },
      { mime_type: 'image/png', filename: expect.any(String) }
    ]
  })

  const rendered = await run('render', [project, 'draft'])

  expect(rendered.success, rendered.message).toBe(true)
  expect(rendered.output['result']).toMatchObject({ durationMs: expect.any(Number) })

  const artifact = (rendered.output['result'] as {
    artifacts: Array<{ path: string, mime_type: string }>
  }).artifacts[0]!
  const require = createRequire(path.resolve(
    'tools/media_production/hyperframes/src/nodejs/package.json'
  ))
  const ffmpeg = require('ffmpeg-static') as string
  const ffprobe = require('@ffprobe-installer/ffprobe') as { path: string }
  const metadata = spawnSync(ffprobe.path, [
    '-v', 'error', '-show_entries',
    'format=duration:stream=codec_name,width,height,r_frame_rate',
    '-of', 'json', artifact.path
  ], { encoding: 'utf8' })

  expect(artifact.mime_type).toBe('video/mp4')
  expect(artifact.path).toContain(path.join(
    home, 'profiles', 'a', 'sessions', 'motion', 'artifacts', 'outputs'
  ))
  expect(metadata.status, metadata.stderr).toBe(0)
  expect(JSON.parse(metadata.stdout)).toMatchObject({
    format: { duration: '1.000000' },
    streams: [{ codec_name: 'h264', width: 320, height: 180, r_frame_rate: '12/1' }]
  })

  // Verify motion in the encoded video, not merely in the source timeline:
  // the marker must leave its initial pixel by the midpoint frame.
  const frames = spawnSync(ffmpeg, [
    '-v', 'error', '-i', artifact.path,
    '-vf', 'select=eq(n\\,0)+eq(n\\,6)', '-vsync', '0',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ])
  const frameBytes = 320 * 180 * 3
  const pixel = (35 * 320 + 25) * 3

  expect(frames.status, frames.stderr.toString()).toBe(0)
  expect(frames.stdout.length).toBe(frameBytes * 2)
  expect(frames.stdout[pixel]).toBeGreaterThan(180)
  expect(frames.stdout[frameBytes + pixel]).toBeLessThan(30)
  expect(await fs.readFile(source, 'utf8')).toBe(html)

  await fs.writeFile(source, html.replace('window.__timelines.motion = timeline;', ''))

  const invalid = await run('check', [project])

  expect(invalid.success, invalid.message).toBe(true)
  expect(invalid.output['result']).toMatchObject({
    scope: 'full', complete: false,
    checks: {
      ok: false, browserSkipped: true,
      lint: { findings: expect.arrayContaining([
        expect.objectContaining({ severity: 'error' })
      ]) }
    }
  })
  expect((await run('check', [project, { mode: 'lint' }])).output['result']).toMatchObject({
    scope: 'lint', complete: false, checks: { ok: false, browserSkipped: true }
  })
})

it('compiles local documents and page images into durable conversation artifacts', async () => {
  await fixture(false)

  const project = path.join(home, 'project')
  const source = path.join(project, 'report.typ')
  const reader = new DocumentReader()

  await fs.mkdir(project)
  await fs.writeFile(source, [
    '#set page(width: 12cm, height: 10cm, margin: 1cm)',
    '= Sales report',
    '#sys.inputs.at("label")',
    '#figure(image("chart.svg", width: 8cm), caption: [Quarterly revenue])',
    '#pagebreak()',
    '= Findings',
    '#table(columns: 2, [Quarter], [Revenue], [Q1], [42])',
    '#figure(image("profit.png", width: 8cm), caption: [Quarterly profit])'
  ].join('\n'))

  const run = async (toolId: string, functionName: string, args: unknown[]): Promise<{
    artifacts: Array<{ path: string, filename: string, mime_type: string }>
    text: string
  }> => {
    const result = await manager.execute({
      toolkitId: 'document', toolId, functionName,
      profileName: 'a', conversationSessionId: 'documents', parameters: {}
    }, args, () => {})

    expect(result.success, JSON.stringify(result)).toBe(true)

    return result.output['result'] as {
      artifacts: Array<{ path: string, filename: string, mime_type: string }>
      text: string
    }
  }

  try {
    const charts = [
      {
        name: 'Quarterly revenue',
        option: {
          title: { text: 'Quarterly revenue' },
          xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'] },
          yAxis: { type: 'value', name: 'Revenue' },
          series: [{ type: 'bar', data: [42, 58, 72, 96] }]
        }
      },
      {
        name: 'Quarterly profit',
        option: {
          title: { text: 'Quarterly profit' },
          xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'] },
          yAxis: { type: 'value' },
          series: [{ type: 'line', smooth: true, data: [8, 12, 15, 21] }]
        }
      }
    ]
    const generated = await run('echarts', 'render', [charts, { width: 800, height: 400 }])

    expect(generated.artifacts).toHaveLength(4)

    const svg = generated.artifacts.find((artifact) => artifact.filename === 'chart-1.svg')!
    const png = generated.artifacts.find((artifact) => artifact.filename === 'chart-2.png')!
    const pngBytes = await fs.readFile(png.path)

    expect((await fs.readFile(svg.path, 'utf8'))).toContain('Quarterly revenue')
    expect(pngBytes.readUInt32BE(16)).toBe(1_600)
    expect(pngBytes.readUInt32BE(20)).toBe(800)
    await fs.copyFile(svg.path, path.join(project, 'chart.svg'))
    await fs.copyFile(png.path, path.join(project, 'profit.png'))

    const imageOnly = await run('echarts', 'render', [charts, { formats: ['png'] }])

    expect(imageOnly.artifacts).toHaveLength(2)
    expect(imageOnly.artifacts.every((artifact) => artifact.mime_type === 'image/png')).toBe(true)

    const fonts = await run('typst', 'listFonts', [])

    expect(fonts.text).toContain('Libertinus Serif')

    const pdf = await run('typst', 'compile', [source, { inputs: { label: 'Verified total: 42' } }])

    expect(pdf.artifacts).toMatchObject([{ filename: 'report.pdf', mime_type: 'application/pdf' }])
    expect(pdf.artifacts[0]!.path).toContain(path.join(home, 'profiles', 'a', 'sessions', 'documents'))
    expect((await reader.readPdf(pdf.artifacts[0]!.path, { pageCount: 2 })).data).toMatchObject({
      totalPages: 2,
      pages: [
        { text: expect.stringContaining('Verified total: 42') },
        { text: expect.stringContaining('Findings') }
      ]
    })

    for (const format of ['svg', 'png']) {
      const images = await run('typst', 'compile', [source, { format, inputs: { label: 'Image export' } }])

      expect(images.artifacts).toHaveLength(2)

      for (const image of images.artifacts) {
        const bytes = await fs.readFile(image.path)

        if (format === 'png') {
          expect(bytes.subarray(1, 4).toString()).toBe('PNG')
        } else {
          expect(bytes.toString()).toContain('<svg')
        }
      }
    }

    const docx = await run('document', 'create', ['docx', {
      title: 'Editable report',
      sections: [{
        heading: 'Findings',
        paragraphs: ['Verified total: 42'],
        images: [
          { path: svg.path, caption: 'Quarterly revenue', altText: 'Revenue grows each quarter.' },
          { path: png.path, caption: 'Quarterly profit' }
        ]
      }]
    }])

    expect(await reader.readDocument(docx.artifacts[0]!.path)).toMatchObject({
      text: expect.stringContaining('Verified total: 42')
    })

    const wordArchive = path.join(home, 'report.zip')
    const word = path.join(home, 'word')

    await fs.copyFile(docx.artifacts[0]!.path, wordArchive)
    await extractArchive(wordArchive, word)

    const media = await fs.readdir(path.join(word, 'word', 'media'))
    const xml = await fs.readFile(path.join(word, 'word', 'document.xml'), 'utf8')

    // Verify actual Office media, not just the returned attachment metadata.
    expect(media.filter((file) => file.endsWith('.svg'))).toHaveLength(1)
    expect(media.filter((file) => file.endsWith('.png'))).toHaveLength(2)
    expect(xml).toContain('Revenue grows each quarter.')
    expect(xml).toContain('Quarterly profit')

    const invalidBatch = await manager.execute({
      toolkitId: 'document', toolId: 'echarts', functionName: 'render',
      profileName: 'a', conversationSessionId: 'documents', parameters: {}
    }, [[charts[0], {
      name: 'Unsupported chart',
      option: { series: [{ type: 'unsupported-series-type', data: [1, 2] }] }
    }]], () => {})

    expect(invalidBatch.success).toBe(false)
    expect(invalidBatch.message).toContain('Not all chart series')

    // A failed import must not expose files outside the selected project or
    // leave a successful artifact result that the agent could deliver.
    await fs.writeFile(path.join(home, 'outside.txt'), 'Private outside content')
    await fs.writeFile(source, '#read("../outside.txt")')

    const rejected = await manager.execute({
      toolkitId: 'document', toolId: 'typst', functionName: 'compile',
      profileName: 'a', conversationSessionId: 'documents', parameters: {}
    }, [source], () => {})

    expect(rejected.success).toBe(false)
    expect(JSON.stringify(rejected)).toContain('project root')
    expect(await fs.readFile(source, 'utf8')).toBe('#read("../outside.txt")')
    expect(await fs.readdir(path.join(home, 'profiles', 'a', 'sessions', 'documents', 'artifacts', 'outputs')))
      .toHaveLength(12)
  } finally {
    await reader.dispose()
  }
})

it('isolates concurrent calls even when a tool normally retains instance state', async () => {
  await fixture(true)
  const run = (session: string): Promise<ToolRuntimeResult> => manager.execute({
    toolkitId: 'fixture', toolId: 'state', functionName: 'next',
    profileName: 'a', conversationSessionId: session, parameters: {}
  }, [false, false], () => {}, { concurrency: ToolConcurrency.Parallel })
  const [first, second] = await Promise.all([run('one'), run('two')])

  expect(first.output['result']).toMatchObject({ count: 1, session: 'one' })
  expect(second.output['result']).toMatchObject({ count: 1, session: 'two' })
  expect((first.output['result'] as { pid: number }).pid)
    .not.toBe((second.output['result'] as { pid: number }).pid)
  expect((await fs.readFile(path.join(home, 'disposed'), 'utf8')).trim().split('\n'))
    .toEqual(['a', 'a'])
})

it('delivers a large result before retiring a one-shot worker', async () => {
  await fixture(false)

  const result = await manager.execute({
    toolkitId: 'fixture',
    toolId: 'state',
    functionName: 'largeResult',
    profileName: 'a',
    conversationSessionId: 'large-result',
    parameters: {}
  }, [LARGE_RESULT_BYTES], () => {})

  expect(result.success, result.message).toBe(true)
  expect(result.output['result']).toEqual({ payload: 'x'.repeat(LARGE_RESULT_BYTES) })
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
})

it('preserves vector sources, publishes complete output batches and cleans workspaces after failures', async () => {
  await fixture(false)
  const source = path.join(home, 'source.vectorcraft')
  const toolDirectory = path.join(home, 'profiles', 'a', 'tools', 'fixture', 'vector')

  await fs.mkdir(path.join(toolDirectory, 'src', 'nodejs'), { recursive: true })
  await fs.writeFile(path.join(toolDirectory, 'tool.json'), '{}')
  await fs.writeFile(path.join(toolDirectory, 'src', 'nodejs', 'index.ts'), `
import fs from 'node:fs/promises'
import path from 'node:path'
import VectorCraftTool from '@@/tools/media_production/vectorcraft/src/nodejs/vectorcraft-tool'

export default class Fixture extends VectorCraftTool {
  async runCli(args) {
    const project = args[args.indexOf('--export') + 1]
    const source = args[args.indexOf('--in') + 1]
    const directory = path.dirname(project)

    await fs.writeFile(path.join(process.env.LEON_HOME, 'workspace-path'), directory)
    await fs.writeFile(source, 'Edited copy')
    await fs.writeFile(project, 'Edited copy')
    const parameters = args.flatMap((arg, index) =>
      arg === '--params' ? [JSON.parse(args[index + 1])] : []
    )
    const fail = parameters.some((params) => params.fail)

    for (const params of parameters) {
      if (params.path) {
        await fs.writeFile(params.path, fail ? '' : 'Preview content')
      }
    }

    return { stdout: '{}', stderr: '' }
  }
}
`)
  await fs.writeFile(source, 'Original content')
  const context = {
    toolkitId: 'fixture', toolId: 'vector', functionName: 'edit',
    profileName: 'a', conversationSessionId: 'workspace', parameters: {}
  }
  const result = await manager.execute(context, [[{ command: 'fixture.edit' }], source], () => {})

  expect(result.success, result.message).toBe(true)
  expect(result.output['result']).toMatchObject({ modelPreviewAttached: true })
  const output = result.output['result'] as { artifacts: Array<{ path: string }> }

  expect(output.artifacts).toHaveLength(3)
  expect(await fs.readFile(output.artifacts[0]!.path, 'utf8')).toBe('Edited copy')
  expect(await fs.readFile(source, 'utf8')).toBe('Original content')
  expect(result.modelFiles).toMatchObject([{ mediaType: 'image/png' }])
  const workspace = await fs.readFile(path.join(home, 'workspace-path'), 'utf8')

  expect(await fs.stat(workspace).catch(() => null)).toBeNull()
  const failed = await manager.execute(context, [
    [{ command: 'fixture.edit', params: { fail: true } }], source
  ], () => {})

  expect(failed.success).toBe(false)
  const failedWorkspace = await fs.readFile(path.join(home, 'workspace-path'), 'utf8')

  expect(await fs.stat(failedWorkspace).catch(() => null)).toBeNull()
  expect(await fs.readFile(source, 'utf8')).toBe('Original content')
  expect(await fs.readdir(path.join(home, 'profiles', 'a', 'sessions', 'workspace', 'artifacts', 'outputs')))
    .toHaveLength(3)
})

it('runs two workers at once and cancellation affects only the selected call', async () => {
  await fixture(true)
  const firstController = new AbortController()
  const secondController = new AbortController()
  let started = 0
  let releaseBothStarted: () => void = () => {}
  const bothStarted = new Promise<void>((resolve) => {
    releaseBothStarted = resolve
  })
  const run = (profile: string, controller: AbortController): Promise<ToolRuntimeResult> => manager.execute({
    toolkitId: 'fixture', toolId: 'state', functionName: 'hold',
    profileName: profile, conversationSessionId: 'one', parameters: {},
    signal: controller.signal
  }, [], (line) => {
    if (line.includes('fixture-waiting')) {
      started += 1
      if (started === 2) {
        releaseBothStarted()
      }
    }
  }, { concurrency: ToolConcurrency.Parallel })
  const first = run('a', firstController)
  const second = run('b', secondController)
  await bothStarted
  firstController.abort()
  expect((await first).success).toBe(false)
  expect(secondController.signal.aborted).toBe(false)
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
  secondController.abort()
  expect((await second).success).toBe(false)
}, 10_000)

afterEach(async () => {
  await manager?.dispose()
  if (home) await fs.rm(home, { recursive: true, force: true })
})

/**
 * Exercise real bridge processes with a harmless profile tool, never the owner's desktop.
 */
async function fixture(persistent: boolean): Promise<void> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-worker-'))
  vi.stubEnv('LEON_HOME', home)
  manager = new ToolWorkerManager()
  for (const profile of ['a', 'b']) {
    const directory = path.join(home, 'profiles', profile, 'tools', 'fixture', 'state')
    await fs.mkdir(path.join(directory, 'src', 'nodejs'), { recursive: true })
    await fs.writeFile(path.join(directory, 'tool.json'), '{}')
    await fs.writeFile(path.join(directory, 'src', 'nodejs', 'index.ts'), `
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Tool } from '@sdk/base-tool'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'
export default class Fixture extends Tool {
  toolName = 'state'; toolkit = 'fixture'; description = 'Worker fixture'
  runtimeLifetime = ToolRuntimeLifetime.${persistent ? 'Persistent' : 'Call'}
  count = 0
  async next(attach, crash = false) {
    if (crash) process.exit(7)
    this.count++
    if (attach) this.attachModelFiles([{ dataBase64: 'eA==', mediaType: 'text/plain' }])
    return { count: this.count, profile: this.executionContext.profileName,
      session: this.executionContext.conversationSessionId, pid: process.pid }
  }
  async hold() {
    this.log('fixture-waiting')
    await new Promise((resolve) => this.executionContext.signal.addEventListener('abort', resolve, { once: true }))
    return { interrupted: true }
  }
  largeResult(bytes) {
    return { payload: 'x'.repeat(bytes) }
  }
  async readInput() {
    const command = [
      "process.stdin.on('end', () => {",
      "  process.stdout.write('stdin-closed')",
      '})',
      'process.stdin.resume()'
    ].join('\\n')

    return this.executeCommand({
      binaryName: process.execPath,
      args: ['-e', command],
      options: { timeout: 5_000 },
      skipBinaryDownload: true
    })
  }
  async dispose() {
    await fs.appendFile(path.join(process.env.LEON_HOME, 'disposed'), process.env.LEON_PROFILE + '\\n')
  }
}
`)
  }
}

async function next(profile: string, session: string, attach = false, crash = false): Promise<ToolRuntimeResult> {
  return manager.execute({ toolkitId: 'fixture', toolId: 'state', functionName: 'next',
    profileName: profile, conversationSessionId: session, parameters: {} }, [attach, crash], () => {}, { concurrency: ToolConcurrency.Serial })
}

it('retains per-profile state, refreshes session context, clears attachments and disposes workers', async () => {
  await fixture(true)
  const first = await next('a', 'one', true)
  expect(first.success).toBe(true)
  expect(first.modelFiles).toHaveLength(1)
  const second = await next('a', 'two')
  expect(second.output['result']).toMatchObject({ count: 2, profile: 'a', session: 'two' })
  expect(second.modelFiles).toBeUndefined()
  expect((await next('b', 'three')).output['result']).toMatchObject({ count: 1, profile: 'b' })
  await manager.dispose()
  expect((await fs.readFile(path.join(home, 'disposed'), 'utf8')).trim().split('\n').sort()).toEqual(['a', 'b'])
})

it('keeps ordinary calls isolated and does not replay a crashed persistent call', async () => {
  await fixture(false)
  expect((await next('a', 'one')).output['result']).toMatchObject({ count: 1 })
  expect((await next('a', 'one')).output['result']).toMatchObject({ count: 1 })
  await manager.dispose()
  await fs.rm(home, { recursive: true, force: true })
  await fixture(true)
  expect((await next('a', 'one')).success).toBe(true)
  const crashed = await next('a', 'one', false, true)
  expect(crashed.success).toBe(false)
  expect(crashed.message).toContain('Input may have been delivered')
  expect((await next('a', 'one')).output['result']).toMatchObject({ count: 1 })
})

it('closes unused stdin so non-interactive commands can finish', async () => {
  await fixture(false)

  const result = await manager.execute({
    toolkitId: 'fixture',
    toolId: 'state',
    functionName: 'readInput',
    profileName: 'a',
    conversationSessionId: 'one',
    parameters: {}
  }, [], () => {})

  expect(result.success).toBe(true)
  expect(result.output['result']).toBe('stdin-closed')
})

it('cancels an active call cooperatively and releases its worker before another call', async () => {
  await fixture(true)
  const controller = new AbortController()
  const result = await manager.execute({ toolkitId: 'fixture', toolId: 'state', functionName: 'hold',
    profileName: 'a', conversationSessionId: 'one', parameters: {}, signal: controller.signal }, [],
  (line) => { if (line.includes('fixture-waiting')) controller.abort() }, { concurrency: ToolConcurrency.Serial })
  expect(result.success).toBe(false)
  expect(result.message).toContain('canceled')
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
  expect((await next('a', 'two')).output['result']).toMatchObject({ count: 1 })
})


it.skipIf(spawnSync('rg', ['--version']).status !== 0)('executes built-in ripgrep functions through real profile workers', async () => {
  await fixture(false)
  const { default: ToolkitRegistry } = await import('@/core/tool-manager/toolkit-registry')
  const registry = new ToolkitRegistry()
  await registry.load()
  expect(registry.getFlattenedTools()).toContainEqual(expect.objectContaining({ toolkitId: 'file_system', toolId: 'ripgrep' }))
  expect(Object.keys(registry.getToolFunctions('file_system', 'ripgrep') || {})).toEqual(['search', 'listFiles'])
  const source = path.join(home, 'sample.ts')
  await fs.writeFile(source, 'first\nneedle\n')
  const context = { toolkitId: 'file_system', toolId: 'ripgrep',
    profileName: 'a', conversationSessionId: 'ripgrep', parameters: {} }
  // A cold install from two workers must publish an executable atomically.
  const [search, files] = await Promise.all([
    manager.execute({ ...context, functionName: 'search' },
      ['needle', [source]], () => {}, { concurrency: ToolConcurrency.Parallel }),
    manager.execute({ ...context, functionName: 'listFiles' },
      [[source]], () => {}, { concurrency: ToolConcurrency.Parallel })
  ])
  expect(search.success, search.message).toBe(true)
  expect(search.output['result']).toMatchObject({ truncated: false, matches: [
    { path: { text: source }, line_number: 2, lines: { text: 'needle\n' } }
  ] })
  expect(files.success, files.message).toBe(true)
  expect(files.output['result']).toMatchObject({ truncated: false, files: [{ text: source }] })

  // Long paths exceed the former 4 MiB cap with a modest number of empty files.
  const directory = path.join(home, ...Array.from({ length: 4 }, () => 'd'.repeat(240)))
  await fs.mkdir(directory, { recursive: true })
  const inventory = Array.from({ length: 4_001 }, (_, index) =>
    path.join(directory, `${'f'.repeat(210)}-${index}.png`)
  )
  for (let offset = 0; offset < inventory.length; offset += 64) {
    await Promise.all(inventory.slice(offset, offset + 64).map((filename) => fs.writeFile(filename, '')))
  }
  const listing = await manager.execute({ ...context, functionName: 'listFiles' },
    [[directory]], () => {}, { concurrency: ToolConcurrency.Parallel })
  expect(listing.success, listing.message).toBe(true)
  const saved = listing.output['result'] as {
    files: { text: string }[]
    retainedOutput: { path: string }
  }
  expect(saved.files.length).toBeLessThan(100)
  expect(listing.output['result']).toMatchObject({
    truncated: false,
    summary: { returnedRecords: inventory.length, complete: true },
    preview: { truncated: true }
  })
  expect(JSON.stringify(listing).length).toBeLessThan(40_000)
  expect((await fs.stat(saved.retainedOutput.path)).size).toBeGreaterThan(LARGE_RESULT_BYTES)
  const complete = JSON.parse(await fs.readFile(saved.retainedOutput.path, 'utf8'))
  expect(complete.result.files.map((file: { text: string }) => file.text).sort()).toEqual(inventory.sort())
})
