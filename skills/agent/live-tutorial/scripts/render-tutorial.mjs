import { createRequire } from 'node:module'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
const run = promisify(execFile)
const ANNOTATION_COLOR = '0xff3b30'
const ANNOTATION_TEXT_COLOR = 'white'
async function inside(root, candidate) {
  const resolved = await fs.realpath(candidate)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Tutorial artifacts must belong to the current session.')
  }
  return resolved
}
function wrapCaption(text, columns) {
  const lines = []
  let line = ''
  // A full font-size cell per code point conservatively accommodates CJK and
  // wide glyphs. Split long words too; captions never extend past the panel.
  for (const word of text.trim().split(/\s+/u)) {
    if (line && Array.from(`${line} ${word}`).length > columns) {
      lines.push(line.trim())
      line = ''
    }
    if (line)
      line += ' '
    for (const character of word) {
      if (Array.from(line).length >= columns) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  if (line.trim())
    lines.push(line.trim())
  return lines
}
/** Render captured evidence only, without shell scripts or Python packages. */
export async function renderTutorial(binary, sessionRoot, outputDir, steps) {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) {
    throw new Error('A tutorial needs 2–6 verified screenshots and instructions.')
  }
  const root = await fs.realpath(sessionRoot)
  const recordingRoot = await inside(root, path.join(root, 'recordings'))
  const output = await inside(recordingRoot, outputDir)
  const captures = await Promise.all(steps.map(async (step, index) => {
    if (typeof step.instruction !== 'string' || !step.instruction.trim() || step.instruction.length > 240) {
      throw new Error('Each instruction must contain 1–240 characters.')
    }
    const screenshot = await inside(root, step.screenshotPath)
    const bytes = await fs.readFile(screenshot)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.length < 24) {
      throw new Error('Use original PNG screenshots returned by computer use.')
    }
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width < 320 || height < 100 || width > 8192 || height > 8192) {
      throw new Error('Unsupported tutorial screenshot dimensions.')
    }
    let point = step.point
    let bounds
    let targetLabel = null
    let metadata
    try {
      metadata = JSON.parse(await fs.readFile(await inside(root, `${screenshot}.json`), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT' || step.targetToken) throw error
    }
    if (step.targetToken) {
      const target = metadata.elements?.find(element => element.element_token === step.targetToken)
      if (!target?.pixel_center || !target?.pixel_bounds) {
        throw new Error('Target token has no geometry in this capture. Use a target from this exact screenshot.')
      }
      point = { ...target.pixel_center, coordinateWidth: metadata.screenshot_width, coordinateHeight: metadata.screenshot_height }
      bounds = target.pixel_bounds
      targetLabel = target.label || null
    }
    if (step.targetToken && step.point) throw new Error('Use targetToken or point, not both.')
    if (step.point && index === steps.length - 1) {
      throw new Error('Do not guess a point on the final result. Omit the annotation or use verified targetToken geometry.')
    }
    if (step.point && metadata?.elements?.some(element => element.pixel_center && element.pixel_bounds)) {
      throw new Error('This capture contains accessible target geometry. Use targetToken from this exact screenshot instead of a guessed point.')
    }
    if (point && metadata &&
        !(point.coordinateWidth === metadata.screenshot_width && point.coordinateHeight === metadata.screenshot_height) &&
        !(point.coordinateWidth === width && point.coordinateHeight === height)) {
      throw new Error('Point dimensions do not match this capture or its model attachment.')
    }
    if (point && (![point.x, point.y, point.coordinateWidth, point.coordinateHeight].every(Number.isFinite) ||
      point.coordinateWidth <= 1 || point.coordinateHeight <= 1 ||
      point.x < 0 || point.y < 0 || point.x >= point.coordinateWidth || point.y >= point.coordinateHeight)) {
      throw new Error('Target points must be inside their observation coordinate space.')
    }
    return { screenshot, width, height, point, bounds, targetLabel, instruction: step.instruction.trim() }
  }))
  if (new Set(captures.map(capture => capture.screenshot)).size !== captures.length) {
    throw new Error('Use a distinct real capture for each tutorial state.')
  }
  // One readable canvas for Retina and ordinary captures. All annotations
  // follow the same source -> displayed-image transform (no guessed DPI).
  const width = 1600
  const margin = 32
  const headerHeight = 88
  const fontSize = 34
  const imageWidth = width - margin * 2
  const imageHeight = Math.max(...captures.map(capture =>
    Math.round(capture.height * Math.min(imageWidth / capture.width, 960 / capture.height))))
  const imageTop = headerHeight
  const captions = captures.map(capture => wrapCaption(capture.instruction, Math.floor((width - margin * 2) / fontSize)))
  const panelHeight = Math.max(...captions.map(lines => lines.length)) * (fontSize + 8) + margin * 2
  const height = Math.ceil((imageTop + imageHeight + panelHeight) / 2) * 2
  // A unique directory preserves previous videos and makes all FFmpeg paths
  // local, avoiding quoting issues in textfile and concat filter arguments.
  const work = await fs.mkdtemp(path.join(output, 'tutorial-'))
  const execute = async (args) => {
    await run(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      cwd: work, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
    })
  }
  const durations = []
  for (const [index, capture] of captures.entries()) {
    const name = `step-${index + 1}`
    await fs.copyFile(capture.screenshot, path.join(work, `${name}-original.png`))
    const caption = captions[index] || []
    await fs.writeFile(path.join(work, `${name}.txt`), caption.join('\n'))
    const scale = Math.min(imageWidth / capture.width, 960 / capture.height)
    const displayedWidth = Math.round(capture.width * scale)
    const displayedHeight = Math.round(capture.height * scale)
    const imageLeft = Math.floor((width - displayedWidth) / 2)
    const filters = [
      `scale=${displayedWidth}:${displayedHeight}:flags=lanczos`,
      `pad=${width}:${height}:${imageLeft}:${imageTop}:color=0x101820`,
      `drawbox=x=0:y=0:w=${width}:h=6:color=${ANNOTATION_COLOR}:t=fill`,
      `drawtext=text='STEP ${index + 1} / ${captures.length}':fontsize=30:fontcolor=${ANNOTATION_COLOR}:x=${margin}:y=28`
    ]
    if (capture.point) {
      const sx = (displayedWidth - 1) / (capture.point.coordinateWidth - 1)
      const sy = (displayedHeight - 1) / (capture.point.coordinateHeight - 1)
      let x = Math.round(imageLeft + capture.point.x * sx)
      const y = Math.round(imageTop + capture.point.y * sy)
      const direction = x > width / 2 ? -1 : 1
      if (capture.bounds) {
        const box = capture.bounds
        filters.push(`drawbox=x=${imageLeft + box.x * sx}:y=${imageTop + box.y * sy}:w=${box.width * sx}:h=${box.height * sy}:color=${ANNOTATION_COLOR}:t=4`)
        // Point to the outline's near edge, keeping the control label readable.
        x = Math.round(imageLeft + (direction > 0 ? box.x + box.width : box.x) * sx) + direction * 6
      } else {
        // A point is a marker, not invented control bounds.
        filters.push(`drawbox=x=${Math.max(imageLeft, x - 14)}:y=${Math.max(imageTop, y - 14)}:w=28:h=28:color=${ANNOTATION_COLOR}:t=4`)
      }
      const start = x + direction * 84
      filters.push(`drawbox=x=${Math.min(x, start)}:y=${y - 3}:w=84:h=6:color=${ANNOTATION_COLOR}:t=fill`)
      for (let offset = 0; offset < 14; offset++) {
        filters.push(`drawbox=x=${x + direction * offset}:y=${y - offset}:w=2:h=${offset * 2 + 1}:color=${ANNOTATION_COLOR}:t=fill`)
      }
      const badgeX = Math.max(margin, Math.min(width - margin - 40, start - 20))
      const badgeY = Math.max(imageTop, Math.min(imageTop + displayedHeight - 40, y - 20))
      filters.push(
        `drawbox=x=${badgeX}:y=${badgeY}:w=40:h=40:color=${ANNOTATION_COLOR}:t=fill`,
        `drawtext=text='${index + 1}':fontsize=28:fontcolor=${ANNOTATION_TEXT_COLOR}:x=${badgeX + 11}:y=${badgeY + 5}`
      )
    }
    filters.push(
      `drawbox=x=${margin}:y=${imageTop + imageHeight + 12}:w=${width - margin * 2}:h=2:color=0x344552:t=fill`,
      `drawtext=textfile=${name}.txt:expansion=none:fontcolor=white:fontsize=${fontSize}:line_spacing=10:x=${margin}:y=${imageTop + imageHeight + margin}`
    )
    await execute(['-i', `${name}-original.png`, '-vf', filters.join(','), '-frames:v', '1', `${name}.png`])
    durations.push(Math.max(5, Math.ceil(capture.instruction.length / 12)))
  }
  const duration = durations.reduce((sum, value) => sum + value, 0)
  const manifest = durations.map((seconds, index) => `file 'step-${index + 1}.png'\nduration ${seconds}\n`).join('') + `file 'step-${captures.length}.png'\n`
  await fs.writeFile(path.join(work, 'frames.txt'), manifest)
  await execute(['-f', 'concat', '-safe', '1', '-i', 'frames.txt', '-t', String(duration), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'tutorial.mp4'])
  // Decode the entire result before exposing its path as a deliverable.
  await execute(['-xerror', '-i', 'tutorial.mp4', '-f', 'null', '-'])
  const filePath = await fs.realpath(path.join(work, 'tutorial.mp4'))
  const sizeBytes = (await fs.stat(filePath)).size
  if (!sizeBytes)
    throw new Error('Tutorial encoding produced an empty file.')
  return { filePath, fileMarker: `[FILE_PATH]${filePath}[/FILE_PATH]`, sizeBytes, stepCount: captures.length, resolvedTargets: captures.map(capture => capture.targetLabel), previewPaths: captures.map((_, index) => path.join(work, `step-${index + 1}.png`)) }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node render-tutorial.mjs --manifest <JSON file or ->\n')
    return
  }
  if (args.length !== 2 || args[0] !== '--manifest') {
    throw new Error('Usage: node render-tutorial.mjs --manifest <JSON file or ->')
  }
  const session = process.env.LEON_SESSION_ID
  const profile = process.env.LEON_PROFILE
  if (!session || !profile || profile === '.' || profile === '..' ||
      path.posix.basename(profile) !== profile || path.win32.basename(profile) !== profile) {
    throw new Error('Tutorial rendering requires an active Leon profile and session.')
  }
  const chunks = []
  if (args[1] === '-') {
    for await (const chunk of process.stdin) chunks.push(chunk)
  }
  const manifest = JSON.parse(args[1] === '-'
    ? Buffer.concat(chunks).toString('utf8')
    : await fs.readFile(args[1], 'utf8'))
  const packagePath = process.env.LEON_CODEBASE_PATH
    ? path.join(process.env.LEON_CODEBASE_PATH, 'package.json')
    : fileURLToPath(new URL('../../../../package.json', import.meta.url))
  const require = createRequire(packagePath)
  const binary = require('ffmpeg-static')
  if (!binary) throw new Error('Bundled ffmpeg-static is unavailable for this platform.')
  const root = path.join(process.env.LEON_HOME || path.join(os.homedir(), '.leon'),
    'profiles', profile, 'sessions', encodeURIComponent(session), 'artifacts', 'computer-use')
  const result = await renderTutorial(binary, root, manifest.outputDir, manifest.steps)
  process.stdout.write(JSON.stringify({ success: true, ...result }) + '\n')
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ success: false, error: error.message }) + '\n')
  process.exitCode = 1
})
