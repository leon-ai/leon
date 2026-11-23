// Native counters are sampled by the driver; DOM checks validate the workload.
void (async () => {
  const { waitFor, button, fill, report } = window.leonDiagnostics
  const config = window.leonDiagnosticConfig
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const channel = new MessageChannel()
  const tasks = []
  channel.port1.onmessage = () => tasks.shift()?.()
  const task = () => new Promise((resolve) => {
    tasks.push(resolve)
    channel.port2.postMessage(null)
  })
  const errors = []
  let layoutDiagnostics = 0
  window.addEventListener('error', (event) => {
    // Browser layout-delivery notices are retained separately from exceptions.
    if (!event.error && event.message === 'ResizeObserver loop completed with undelivered notifications.') {
      layoutDiagnostics += 1
      return
    }
    errors.push(event.message)
  })
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  const phase = async (value, results = {}) => {
    if (!config.paint_when_hidden && document.visibilityState !== 'hidden') {
      throw new Error('The performance window must remain hidden')
    }
    await report({ passed: true, phase: value, visibility: document.visibilityState,
      errors, layout_diagnostics: layoutDiagnostics, ...results })
  }

  try {
    await waitFor(() => document.querySelector('textarea:not(:disabled)'), 'usable composer')
    await document.fonts.ready
    if (config.page === 'history' || config.page === 'active') {
      const history = await waitFor(() => document.querySelector('a[href$="/session/welcome"]'), 'history link')
      history.click()
      await waitFor(() => document.querySelector('.session-page .feed-turn'), 'mounted history')
    }
    if (config.page !== 'active') {
      await phase('idle')
      return
    }

    const input = document.querySelector('textarea')
    fill(input, 'Measure streaming, typing and scrolling')
    await waitFor(() => !button('Send message').disabled, 'enabled send')
    await phase('workload')
    document.querySelector('form[aria-label="Send a message to Leon"]').requestSubmit()
    await waitFor(() => button('Stop this turn'), 'running turn')
    const viewport = document.querySelector('.feed').closest('.app-main')
    const offsets = new Set()
    let edits = 0
    let streamingScrolls = 0
    let draft = ''
    for (let index = 0; index < config.scroll_steps; index += 1) {
      if (index % 4 === 0) {
        draft = `Unsent draft ${edits} · 你好 😀`
        fill(input, draft)
        edits += 1
      }
      // Stay near the live turn so history pagination cannot replace it.
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - index % 3 * 40)
      await task()
      offsets.add(Math.round(viewport.scrollTop))
      streamingScrolls += Number(Boolean(button('Stop this turn')))
      await pause(config.interaction_ms)
    }
    await waitFor(() => !button('Stop this turn'), 'completed stream')
    viewport.scrollTop = viewport.scrollHeight
    await waitFor(() => document.querySelector('.feed').textContent.includes(config.expected_answer.trim()), 'complete streamed answer')
    if (input.value !== draft) {
      throw new Error('The unsent draft was not preserved')
    }
    if (offsets.size < 2 || streamingScrolls === 0) {
      throw new Error('Scrolling did not advance during the stream')
    }
    if (errors.length) {
      throw new Error(errors.join('; '))
    }
    await phase('complete', { edits, scrolls: config.scroll_steps, streaming_scrolls: streamingScrolls,
      distinct_offsets: offsets.size, draft_preserved: true, complete_answer: true })
  } catch (error) {
    await report({ passed: false, phase: 'complete', error: String(error), errors })
  } finally {
    channel.port1.close()
    channel.port2.close()
  }
})()
