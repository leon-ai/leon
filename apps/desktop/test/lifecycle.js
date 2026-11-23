void (async () => {
  const { waitFor, fill, report } = window.leonDiagnostics
  if (document.querySelector('meta[name="leon-desktop-bootstrap"]')?.content !== 'complete') {
    return
  }
  const action = (name) => fetch('/__desktop/test/window', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: name })
  }).then((response) => response.json())
  try {
    const composer = await waitFor(() => document.querySelector('textarea[aria-label="Message Leon"]'), 'new session')
    const draft = 'A draft retained while the desktop window is closed.'
    fill(composer, draft)
    const before = await action('status')
    const checks = []
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
    // The external harness verifies that app.quit exits instead of hiding again.
    void action('quit').catch(() => undefined)
  } catch (error) {
    await report({ passed: false, phase: 'complete', error: String(error) })
  }
})()
