void (async () => {
  const { waitFor, button, fill, report } = window.leonDiagnostics
  if (document.querySelector('meta[name="leon-desktop-bootstrap"]')?.content !== 'complete') {
    return
  }
  const action = (name) => fetch('/__desktop/test/window', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: name })
  }).then((response) => response.json())
  try {
    const composer = await waitFor(() => document.querySelector('textarea[aria-label="Message Leon"]'), 'new session')
    const checks = []
    const bar = document.querySelector('.desktop-titlebar')
    const bounds = bar?.getBoundingClientRect()
    const main = document.querySelector('.app-main').getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    if (!bounds || bounds.height <= 0 || bounds.y !== 0 || bounds.width !== innerWidth ||
      main.top < bounds.bottom || sidebar.top < bounds.bottom || Math.abs(main.bottom - innerHeight) > 1 ||
      getComputedStyle(bar).getPropertyValue('-webkit-app-region') !== 'drag') {
      throw new Error('Native controls need a draggable title strip above the sidebar and viewport-sized content')
    }
    checks.push('Native title-bar geometry reserves space without overflowing the viewport')
    const initial = await action('status')
    if (document.documentElement.dataset.theme !== 'dark' || initial.background.slice(-6).toLowerCase() !== '000000') {
      throw new Error('The initial native window must match the shared default theme')
    }
    button('Settings').click()
    await waitFor(() => button('Appearance'), 'appearance settings').then((control) => control.click())
    for (const [label, scheme] of [['Light', 'light'], ['Dark', 'dark'], ['System', 'system']]) {
      await waitFor(() => button(label), `${label} theme`).then((control) => control.click())
      await waitFor(async () => {
        const host = await action('status')
        const theme = scheme === 'system' ? (host.systemDark ? 'dark' : 'light') : scheme
        const color = theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)'
        return localStorage.getItem('leon.web-app.theme') === scheme && document.documentElement.dataset.theme === theme &&
          getComputedStyle(bar).backgroundColor === color &&
          host.background.slice(-6).toLowerCase() === (theme === 'dark' ? '000000' : 'ffffff') &&
          !host.visible && !host.focused
      }, `${label} native and rendered appearance`)
      checks.push(`${label} preference colors the native window and draggable strip without activation`)
    }
    button('Close dialog').click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'closed settings')
    const draft = 'A draft retained while the desktop window is closed.'
    fill(composer, draft)
    const before = await action('status')
    if (before.platform === 'darwin') {
      const closed = await action('close')
      if (!closed.alive || closed.visible || closed.focused || composer.value !== draft) {
        throw new Error('Closing the macOS window must hide it and preserve its draft')
      }
      const reopened = await action('activate')
      if (!reopened.alive || composer.value !== draft || reopened.visible || reopened.focused) {
        throw new Error('Activation must reuse the window; hidden diagnostics must never steal focus')
      }
      checks.push('macOS close keeps the window alive and preserves the draft', 'Dock activation reuses the same renderer without diagnostic focus')
    }
    await report({ passed: true, phase: 'complete', checks })
    // macOS is terminated externally through its native Dock Quit path.
    if (!window.leonDiagnosticConfig.native_quit) {
      void action('quit').catch(() => undefined)
    }
  } catch (error) {
    await report({ passed: false, phase: 'complete', error: String(error) })
  }
})()
