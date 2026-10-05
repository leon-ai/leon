import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'

enum SignInState {
  Connecting = 'connecting',
  Connected = 'connected',
  Failed = 'failed'
}

const MESSAGES = {
  [SignInState.Connecting]: {
    title: 'Connecting your ChatGPT account…',
    detail: 'Leon is finishing your sign-in. Please keep this tab open.'
  },
  [SignInState.Connected]: {
    title: 'ChatGPT connected',
    detail: 'You can close this tab and return to Leon.'
  },
  [SignInState.Failed]: {
    title: 'Unable to connect ChatGPT',
    detail: 'Return to Leon and try signing in again.'
  }
}

/**
 * Stream a self-contained callback page and confirm success only after Leon
 * verifies, saves and selects the account. No additional listener is needed.
 */
export function serveChatGPTSignInPage(
  response: ServerResponse,
  logo: string,
  completion?: Promise<unknown>
): void {
  const state = completion ? SignInState.Connecting : SignInState.Failed
  const message = MESSAGES[state]
  const nonce = randomBytes(16).toString('base64')

  response.writeHead(completion ? 200 : 400, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`
  })
  response.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT sign-in · Leon</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #000; color: #f5f5f7; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; }
    main { max-width: 28rem; padding: 2rem; text-align: center; }
    img { width: 44px; height: 46px; }
    .brand { margin: .75rem 0 2.5rem; color: #bebebe; font-size: .9rem; }
    h1 { margin: 1.25rem 0 .75rem; font-size: 1.5rem; font-weight: 600; }
    #detail { margin: 0; color: #bebebe; line-height: 1.6; }
    #status { display: grid; place-items: center; width: 2rem; height: 2rem; margin: auto; font-size: 1.5rem; }
    [data-state="connecting"] #status { box-sizing: border-box; border: 2px solid #333; border-top-color: #1c75db; border-radius: 50%; animation: spin 1s linear infinite; }
    [data-state="connected"] #status { color: #1c75db; }
    [data-state="failed"] #status { color: #ed297a; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { #status { animation: none !important; } }
  </style>
</head>
<body data-state="${state}">
  <main>
    <img src="data:image/svg+xml;base64,${logo}" alt="Leon logo">
    <p class="brand">Leon AI</p>
    <div id="status" aria-hidden="true">${completion ? '' : '!'}</div>
    <section aria-live="polite" aria-atomic="true">
      <h1 id="title">${message.title}</h1>
      <p id="detail">${message.detail}</p>
    </section>
    <noscript><p>Return to Leon to check your connection status.</p></noscript>
  </main>
  <script nonce="${nonce}">history.replaceState(null, '', location.pathname);</script>
`)

  if (!completion) {
    response.end('</body></html>')
    return
  }

  const finish = (finalState: SignInState): void => {
    const finalMessage = MESSAGES[finalState]

    response.end(`<script nonce="${nonce}">
    document.body.dataset.state = ${JSON.stringify(finalState)};
    document.getElementById('status').textContent = ${JSON.stringify(finalState === SignInState.Connected ? '✓' : '!')};
    document.getElementById('title').textContent = ${JSON.stringify(finalMessage.title)};
    document.getElementById('detail').textContent = ${JSON.stringify(finalMessage.detail)};
  </script></body></html>`)
  }

  void completion.then(
    () => finish(SignInState.Connected),
    () => finish(SignInState.Failed)
  )
}
