import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-chromium'

const CLI_PATH = fileURLToPath(new URL('../node_modules/@slidev/cli/bin/slidev.mjs', import.meta.url))
const SERVE_PATH = fileURLToPath(new URL('./serve.mjs', import.meta.url))
const MAX_CHECK_STATES = 240
const MAX_FINDINGS = 100
const VIEWPORT = { width: 1280, height: 720 }
const DEFAULT_WAIT_MS = 750
const NAVIGATION_KEY = '__slidev__'
const [action, entry, outputPath, resultPath, serialized = '{}'] = process.argv.slice(2)
const parameters = JSON.parse(serialized)

// Slidev locates sibling themes and icon collections from its invocation path.
// Keep that lookup at this tool's install even for projects outside Leon's tree.
process.argv[1] = CLI_PATH

const { createServer, resolveOptions } = await import('@slidev/cli')

/**
 * Invoke the tool-owned CLI without shell interpretation or interactive prompts.
 */
async function runSlidev(args) {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    cwd: path.dirname(entry),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CI: 'true' }
  })

  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Slidev ${args[0]} failed with exit code ${code}.`))
      }
    })
  })
}

/**
 * Capture rendered states in a finite local server, then close browser resources.
 */
async function inspectBrowser(options) {
  const server = await createServer(options, {
    server: { host: '127.0.0.1', port: 0, open: false },
    logLevel: 'warn'
  })
  let browser
  let finished = false
  const errors = new Set()
  const failedRequests = new Set()
  const states = []
  const findings = []

  function observations() {
    return {
      ok: finished && findings.length === 0 && errors.size === 0 && failedRequests.size === 0,
      scope: action === 'preview' ? 'selected' : 'full',
      complete: finished,
      states,
      checkedStates: states.length,
      findings: findings.slice(0, MAX_FINDINGS),
      findingCount: findings.length,
      errors: [...errors],
      failedRequests: [...failedRequests]
    }
  }

  try {
    await server.listen()

    const port = server.httpServer.address().port

    browser = await chromium.launch()

    const page = await browser.newPage({ viewport: VIEWPORT })

    page.on('pageerror', (error) => errors.add(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.add(message.text())
      }
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.add(`${response.status()} ${response.url()}`)
      }
    })
    page.on('requestfailed', (request) => {
      // Navigation cancels Slidev's long-lived development streams normally.
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
        failedRequests.add(request.url())
      }
    })

    // Automated capture does not need to prevent a physical display sleeping.
    await page.addInitScript(() => localStorage.setItem('slidev-wake-lock', 'false'))

    await page.goto(`http://127.0.0.1:${port}/1`, { waitUntil: 'networkidle' })

    try {
      await page.waitForFunction(
        (key) => Boolean(window[key]?.nav?.currentSlideNo),
        NAVIGATION_KEY
      )
    } catch (error) {
      const reason = [...errors, ...failedRequests].join('; ') || error.message

      throw new Error(`Presentation did not initialize: ${reason}`)
    }

    async function selectState(slide, click, waitMs = DEFAULT_WAIT_MS) {
      await page.evaluate(async ({ slide, click, key }) => {
        await window[key].nav.go(slide, click)
      }, { slide, click, key: NAVIGATION_KEY })
      await page.waitForFunction(({ slide, click, key }) => {
        const nav = window[key].nav

        return nav.currentSlideNo === slide && nav.clicks === click
      }, { slide, click, key: NAVIGATION_KEY })
      await page.locator(`.slidev-page-${slide} .slidev-layout`).waitFor({ state: 'visible' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(waitMs)

      return page.evaluate((key) => ({
        slide: window[key].nav.currentSlideNo,
        click: window[key].nav.clicks,
        totalClicks: window[key].nav.clicksTotal
      }), NAVIGATION_KEY)
    }

    if (action === 'preview') {
      for (const [index, state] of parameters.states.entries()) {
        if (state.slide > options.data.slides.length) {
          throw new Error(`Slide ${state.slide} does not exist.`)
        }

        const initial = await selectState(state.slide, 0, 0)

        if ((state.click ?? 0) > initial.totalClicks) {
          throw new Error(`Slide ${state.slide} has only ${initial.totalClicks} click steps.`)
        }

        const selected = await selectState(
          state.slide,
          state.click ?? 0,
          state.waitMs ?? DEFAULT_WAIT_MS
        )
        const filename = `preview-${index + 1}-slide-${state.slide}-click-${selected.click}.png`

        await page.locator(`.slidev-page-${state.slide} .slidev-layout`).screenshot({
          path: path.join(outputPath, filename)
        })
        states.push({ ...selected, waitMs: state.waitMs ?? DEFAULT_WAIT_MS, filename })
      }
    } else {
      const slides = Array.from({ length: options.data.slides.length }, (_, index) => index + 1)

      for (const slide of slides) {
        const initial = await selectState(slide, 0)

        for (let click = 0; click <= initial.totalClicks; click += 1) {
          if (states.length >= MAX_CHECK_STATES) {
            throw new Error(`Check at most ${MAX_CHECK_STATES} slide/click states per deck.`)
          }

          const state = click === 0 ? initial : await selectState(slide, click)
          const issues = await page.locator(`.slidev-page-${slide} .slidev-layout`).evaluate((root) => {
            const bounds = root.getBoundingClientRect()
            const issues = []

            for (const element of root.querySelectorAll('*')) {
              const box = element.getBoundingClientRect()
              let visible = box.width > 0 && box.height > 0

              for (
                let current = element;
                current && current !== root.parentElement;
                current = current.parentElement
              ) {
                const style = getComputedStyle(current)

                if (
                  style.display === 'none' ||
                  style.visibility === 'hidden' ||
                  Number(style.opacity) === 0
                ) {
                  visible = false
                  break
                }
              }

              if (!visible) {
                continue
              }

              if (
                box.left < bounds.left - 2 || box.top < bounds.top - 2 ||
                box.right > bounds.right + 2 || box.bottom > bounds.bottom + 2
              ) {
                issues.push({
                  type: 'overflow',
                  element: element.tagName,
                  text: element.textContent.trim().slice(0, 100)
                })
              }

              if (
                element instanceof HTMLImageElement &&
                (!element.complete || element.naturalWidth === 0)
              ) {
                issues.push({ type: 'missing_image', source: element.getAttribute('src') })
              }
            }

            return issues
          })

          states.push(state)
          findings.push(...issues.map((issue) => ({ ...state, ...issue })))
        }
      }
    }

    finished = true

    return observations()
  } catch (error) {
    if (action !== 'check') {
      throw error
    }

    // A broken slide is a repairable observation. Preserve partial coverage
    // and the actual renderer errors instead of reporting an empty success.
    errors.add(error.message)

    return observations()
  } finally {
    await browser?.close()
    await server.close()
  }
}

let result

if (action === 'export') {
  if (parameters.format === 'web') {
    const directory = path.join(outputPath, 'web')

    await runSlidev([
      'build', entry, '--out', directory, '--base', '/', '--router-mode', 'hash',
      ...(parameters.includeNotes ? [] : ['--without-notes'])
    ])
    await fs.copyFile(SERVE_PATH, path.join(directory, 'serve.mjs'))
    result = {
      files: ['presentation-web.zip'],
      startCommand: 'node serve.mjs',
      animated: true
    }
  } else {
    const filename = `presentation.${parameters.format.startsWith('pptx') ? 'pptx' : parameters.format}`

    await runSlidev([
      'export', entry, '--format', parameters.format,
      '--output', path.join(outputPath, filename),
      '--with-clicks', String(parameters.withClicks),
      '--wait', String(DEFAULT_WAIT_MS)
    ])

    if (parameters.format === 'png') {
      const files = []

      for (const image of (await fs.readdir(path.join(outputPath, filename))).sort()) {
        if (image.endsWith('.png')) {
          const target = `slide-${image}`

          await fs.rename(
            path.join(outputPath, filename, image),
            path.join(outputPath, target)
          )
          files.push(target)
        }
      }

      result = { files, animated: false }
    } else {
      result = { files: [filename], animated: false }
    }
  }

} else {
  const options = await resolveOptions({ entry }, 'dev')

  if (action === 'inspect') {
    result = {
      title: options.data.config.title,
      slideCount: options.data.slides.length,
      slides: options.data.slides.map((slide, index) => ({
        slide: index + 1,
        title: slide.title,
        content: slide.content,
        notes: slide.note,
        layout: slide.frontmatter.layout,
        declaredClicks: slide.frontmatter.clicks
      }))
    }
  } else {
    result = await inspectBrowser(options)
  }
}

await fs.writeFile(resultPath, JSON.stringify(result))
