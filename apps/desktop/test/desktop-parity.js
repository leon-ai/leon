// Exercise the real host transport and shared composer without changing the OS clipboard.
void (async () => {
  if (window.leonParityStarted) {
    return
  }
  window.leonParityStarted = true
  const { waitFor, button, fill, report } = window.leonDiagnostics
  const checks = []
  const errors = []
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  const configuration = window.leonDiagnosticConfig
  try {
    const token = await waitFor(() => document.querySelector('input[aria-label="Profile token"]'), 'sign-in')
    fill(token, 'desktop:fixture-token')
    await waitFor(() => !button('Connect').disabled, 'connect')
    button('Connect').click()
    const composer = await waitFor(() => document.querySelector('textarea[aria-label="Message Leon"]'), 'composer')
    // Only the document's visibility is simulated. The native window stays hidden.
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    let granted
    window.addEventListener('leon:desktop-files', (event) => {
 granted = event.detail.files[0] 
})
    button('New session').focus()
    await fetch('/__desktop/test/paste', { method: 'POST' })
    await waitFor(() => button(`Remove ${configuration.filename}`), 'page-level native preview')
    if (!granted || document.activeElement === composer) {
      throw new Error('Native paste required composer focus or failed to deliver a file reference')
    }
    if (JSON.stringify(granted).includes(configuration.clipboard_files[0])) {
      throw new Error('The renderer received a filesystem path')
    }
    checks.push('Native file paste away from composer focus; opaque metadata only')
    const range = await fetch(granted.url, { headers: { Range: 'bytes=0-63' } })
    if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 64) {
      throw new Error('Native previews did not preserve bounded byte ranges')
    }
    checks.push('Native file preview byte ranges')
    const created = await fetch('/api/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID() }) }).then((response) => response.json())
    const context = { profile: 'Desktop fixture', sessionId: created.session.id, uploadId: granted.id }
    const wrong = await fetch(granted.url + '/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...context, profile: 'another profile' }) })
    if (wrong.status !== 409) {
      throw new Error('A native upload crossed profile boundaries')
    }
    checks.push('Native upload rejects mismatched profiles before reading file bytes')
    const controller = new AbortController()
    const cancelled = await fetch(granted.url + '/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context), signal: controller.signal })
    const reader = cancelled.body.getReader()
    await reader.read()
    controller.abort()
    await reader.cancel().catch(() => undefined)
    checks.push('Native upload cancellation closes the streaming response')
    button(`Remove ${configuration.filename}`).click()
    await waitFor(async () => (await fetch(granted.url, { method: 'HEAD' })).status >= 400, 'released native reference')
    checks.push('Removing a draft revokes its native file reference')
    await fetch('/__desktop/test/paste', { method: 'POST' })
    await waitFor(() => button(`Remove ${configuration.filename}`), 'repasted native preview')
    fill(document.querySelector('textarea'), 'Native attachment parity · 你好 😀')
    await waitFor(() => !button('Send message').disabled, 'native send')
    document.querySelector('form[aria-label="Send a message to Leon"]').requestSubmit()
    await waitFor(() => document.querySelector('[aria-label="Upload status for ' + configuration.filename + '"]'), 'native progress')
    await waitFor(() => location.pathname.includes('/session/'), 'native session navigation')
    await waitFor(() => document.body.textContent.includes('Hello from the fixture.'), 'native attachment accepted')
    await waitFor(() => !document.querySelector('[aria-label="Attached files"]'), 'submitted draft released')
    checks.push('Native file larger than 8 MB uploads through the real composer with progress')
    const interactive = await fetch(`/api/v1/sessions/${created.session.id}/messages/fixture-reply/ui`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-leon-client-type': 'mobile',
        'x-leon-client-os': 'android'
      },
      body: JSON.stringify({ id: crypto.randomUUID(), surfaceId: 'fixture', nodeId: 'choice', revision: 1, values: true })
    })
    if (interactive.status !== 202) {
      throw new Error('Desktop could not send an interactive reply to the server')
    }
    await waitFor(async () => (await fetch('/__desktop/notifications').then((response) => response.json())).length === 1,
      'live native completion notification')
    checks.push('Live turn completion reaches native notifications without an OS banner')
    const auth = await fetch('/api/v1/profile-auth').then((response) => response.json())
    const incompatible = await fetch('/api/v1/updates/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: `v${Number(auth.version.split('.')[0]) + 1}.0.0` }) })
    if (incompatible.status !== 409) {
      throw new Error('Desktop must reject a breaking server update before forwarding installation')
    }
    checks.push('Breaking server updates are rejected before installation')
    // Exercise the real Aurora bootstrap under the inherited desktop policy;
    // its opaque frame can interact without gaining access to Node or the host.
    const frame = await waitFor(() => document.querySelector('iframe[title="Desktop sandbox check"]'), 'sandbox frame')
    let sandboxReply
    const sandboxMessage = (event) => {
      if (event.source === frame.contentWindow && event.data?.type === 'desktop-sandbox-check') {
        sandboxReply = { ...event.data, origin: event.origin }
      }
    }
    window.addEventListener('message', sandboxMessage)
    try {
      await waitFor(() => {
        frame.contentWindow.postMessage('desktop-sandbox-check', '*')
        return sandboxReply
      }, 'isolated Aurora interaction')
      if (sandboxReply.node !== 'undefined' || sandboxReply.origin !== 'null') {
        throw new Error('Aurora lost its opaque-origin sandbox')
      }
    } finally {
      window.removeEventListener('message', sandboxMessage)
    }
    checks.push('Aurora interacts under the inherited CSP without Node or same-origin privileges')
    let blockedInline = false
    const violation = (event) => {
      if (event.blockedURI === 'inline' && event.effectiveDirective === 'script-src-elem') {
        blockedInline = true
      }
    }
    window.addEventListener('securitypolicyviolation', violation)
    const untrusted = document.createElement('script')
    untrusted.textContent = 'window.leonUntrustedInline = true'
    try {
      document.head.append(untrusted)
      await waitFor(() => blockedInline, 'blocked inline script')
      if (window.leonUntrustedInline) {
        throw new Error('An untrusted inline script executed in the desktop renderer')
      }
    } finally {
      untrusted.remove()
      window.removeEventListener('securitypolicyviolation', violation)
    }
    checks.push('Content policy blocks untrusted inline execution')
    const browserBytes = new Uint8Array(9 * 1_024 * 1_024).fill(97)
    const query = new URLSearchParams({ filename: 'browser-large.txt', media_type: 'text/plain', upload_id: crypto.randomUUID() })
    const ordinary = await fetch(`/api/v1/sessions/${created.session.id}/attachments?${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: browserBytes
    })
    const receipt = await ordinary.json()
    if (!ordinary.ok || receipt.attachment?.size_bytes !== browserBytes.length) {
      throw new Error('An ordinary attachment is still capped at 8 MB')
    }
    checks.push('Ordinary browser-file uploads above 8 MB reach the server')
    const artifact = await fetch(`/api/v1/artifacts/${created.session.id}/fixture-note`)
    if (artifact.headers.get('Content-Security-Policy') !== 'sandbox; default-src \'none\'') {
      throw new Error('The desktop host dropped the server’s artifact sandbox policy')
    }
    const artifactWindow = window.open(`/api/v1/artifacts/${created.session.id}/fixture-note?inline=1`, '_blank')
    if (!artifactWindow) {
      throw new Error('The authenticated artifact could not open in a desktop window')
    }
    artifactWindow.close()
    checks.push('Authenticated artifact windows preserve the server’s sandbox policy')
    const settings = await fetch('/web-app/settings/general', { headers: { Accept: 'text/html' } })
    if (!settings.ok || !(await settings.text()).includes('name="leon-desktop"')) {
      throw new Error('A refreshed settings route did not restore the shared application')
    }
    const saved = await fetch('/__desktop/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'leon.web-app.theme': 'dark', 'leon.web-app.recent-models.Desktop fixture': '[]' }) })
    const rejected = await fetch('/__desktop/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'must-not-persist' }) })
    const restored = await fetch('/web-app/settings/general', { headers: { Accept: 'text/html' } }).then((response) => response.text())
    if (!saved.ok || rejected.status !== 400 || !restored.includes('leon.web-app.recent-models.Desktop fixture') || restored.includes('must-not-persist')) {
      throw new Error('Desktop preferences did not preserve their allowlist and profile scope')
    }
    checks.push('Settings-route refresh and allowlisted profile-scoped preferences')
    const returnURL = new URL('/api/v1/connections/complete', location.origin)
    const noSession = { credentials: 'omit' }
    const malformedReturn = await fetch(returnURL, noSession)
    const privateRoute = await fetch('/api/v1/profile-auth', noSession)
    if (malformedReturn.status !== 401 || privateRoute.status !== 401) {
      throw new Error('Requests without a desktop session reached private routes')
    }
    checks.push('Requests without the desktop session cannot access private routes')
    if (errors.length) {
      throw new Error(errors.join('; '))
    }
    await report({ passed: true, finished: true, background: true, checks })
  } catch (error) {
    await report({ passed: false, finished: true, background: true, checks, error: String(error), errors, fixture_body: document.body.textContent.slice(-3_000) })
  }
})()
