import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AuroraNode, AuroraValues } from '../../../../../../aurora/src/v2/contracts/answer'
import { isAuroraSubmission } from '../../../../../../aurora/src/v2/contracts/answer'
import { GENERATED_BRIDGE_VERSION, GeneratedMessage, isGeneratedState,
  MAXIMUM_GENERATED_HEIGHT, MINIMUM_GENERATED_HEIGHT, MAXIMUM_GENERATED_STATE_CHARACTERS } from '../../../../../../aurora/src/v2/contracts/generated'
import runtime from 'virtual:aurora-sandbox'
import styles from './frame-styles.sass?inline'
import { VISUAL_FONT_CSS } from '../../visual-export/visual-fonts'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Loader } from '@/components/loader'
import { Icon } from '@/components/icon'
import { useToast } from '@/components/toast'
import { THEME_CHANGE_EVENT, getCurrentTheme } from '@/theme'

import './generated-frame.sass'

type GeneratedNode = Extract<AuroraNode, { type: 'Generated' }>
const CodeView = lazy(() => import('@/components/code-view/code-view').then((module) => ({ default: module.CodeView })))
const MAXIMUM_MESSAGES_PER_SECOND = 120
const FRAME_STARTUP_TIMEOUT_MS = 5_000
const FRAME_RENDER_TIMEOUT_MS = 30_000
const MAXIMUM_FRAME_MESSAGE_CHARACTERS = MAXIMUM_GENERATED_STATE_CHARACTERS + 1_024
const STYLE_PREFIXES = ['--color-', '--space-', '--font-', '--line-height-', '--border-radius-', '--shadow-', '--duration-', '--gradient-', '--transition-', '--ease-']
const CSP = 'default-src \'none\'; script-src \'unsafe-inline\' blob:; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'; object-src \'none\'; frame-src \'none\''

function themeContext() {
  const computed = getComputedStyle(document.documentElement)
  const variables = Object.fromEntries([...computed].filter((name) => STYLE_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .map((name) => [name, computed.getPropertyValue(name)]))

  return { theme: getCurrentTheme(), variables }
}

function createDocument(): string {
  // The document contains trusted bootstrap code only. Model content arrives
  // after an authenticated frame handshake, never inside this HTML envelope.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<meta name="referrer" content="no-referrer"><style>${VISUAL_FONT_CSS}${styles}</style></head>` +
    `<body><div id="aurora-content"></div><div id="aurora-root"></div><script>${runtime.replaceAll('</script', '<\\/script')}</script></body></html>`
}

interface GeneratedFrameProps {
  node: GeneratedNode
  readOnly?: boolean
  submitted?: boolean
  initialState?: Record<string, unknown>
  initialValues?: AuroraValues | undefined
  onStateChange?: (state: Record<string, unknown>) => void
  onSubmit?: (values: AuroraValues) => Promise<void>
  onReady?: (ready: boolean) => void
}

/**
 * Executes a versioned interface in an opaque-origin document. Only declared,
 * validated values reach the host, and an owner click outside the frame must
 * confirm every submission. Local interactions never dispatch app commands.
 */
export default function GeneratedFrame({ node, readOnly = false, submitted = false, initialState = {}, initialValues,
  onStateChange, onSubmit, onReady }: GeneratedFrameProps) {
  const container = useRef<HTMLElement>(null)
  const { showToast } = useToast()
  const [expanded, setExpanded] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const [url, setURL] = useState('')
  const [height, setHeight] = useState(node.props.height ?? 360)
  const [error, setError] = useState('')
  const [stopped, setStopped] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [proposal, setProposal] = useState<AuroraValues | undefined>(initialValues)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [exportReady, setExportReady] = useState(false)
  const requestImage = useRef<(() => Promise<Blob>) | undefined>(undefined)
  const callbacks = useRef({ onStateChange, initialState, readOnly, submitted, pending, node })
  callbacks.current = { onStateChange, initialState, readOnly, submitted, pending, node }
  const { html, css, javascript } = node.props
  const source = `<!-- ${node.props.title} -->\n${node.props.html}\n\n/* CSS */\n${node.props.css ?? ''}\n\n// JavaScript\n${node.props.javascript ?? ''}`

  useLayoutEffect(() => {
    onReady?.(exportReady || stopped)
  }, [onReady, exportReady, stopped])

  useEffect(() => {
    function updateFullscreen(): void {
      setExpanded(document.fullscreenElement === container.current)
    }
    document.addEventListener('fullscreenchange', updateFullscreen)

    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement === container.current) {
        await document.exitFullscreen()
      } else {
        await container.current?.requestFullscreen()
      }
    } catch {
      showToast({ type: 'error', title: 'I couldn’t change this view',
        description: 'Your browser did not allow fullscreen. You can keep using the visual here.' })
    }
  }

  // Cache refreshes can replace source objects without changing the document.
  // Only executable content changes may restart its local interaction state.
  useEffect(() => {
    if (stopped) {
      return
    }
    let live = true
    let channel: MessageChannel | undefined
    let attached = false
    let rendered = false
    let renderTimeout: ReturnType<typeof setTimeout> | undefined
    const enginesRequested = new Set<GeneratedMessage>()
    let imageRequest: {
      id: string
      resolve: (value: Blob) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    } | undefined
    setExportReady(false)
    let windowStart = performance.now()
    let count = 0
    const blobURL = URL.createObjectURL(new Blob([createDocument()], { type: 'text/html' }))
    const startupTimeout = setTimeout(() => {
      if (!attached) {
        setError('I couldn’t start this interface. You can still read the summary below.')
        setStopped(true)
      }
    }, FRAME_STARTUP_TIMEOUT_MS)

    function sendTheme(): void {
      channel?.port1.postMessage({ type: GeneratedMessage.Context, ...themeContext() })
    }

    function ready(event: MessageEvent): void {
      if (attached || event.source !== frame.current?.contentWindow || event.data?.version !== GENERATED_BRIDGE_VERSION ||
        event.data?.type !== GeneratedMessage.Ready) {
        return
      }
      attached = true
      clearTimeout(startupTimeout)
      renderTimeout = setTimeout(() => {
        setError('I couldn’t finish preparing this interface. You can still read the summary below.')
        setStopped(true)
      }, FRAME_RENDER_TIMEOUT_MS)
      channel = new MessageChannel()
      channel.port1.onmessage = (message: MessageEvent) => {
        if (!live || !message.data || typeof message.data !== 'object') {
          return
        }
        if (performance.now() - windowStart > 1_000) {
          count = 0
          windowStart = performance.now()
        }
        count += 1
        let length = MAXIMUM_FRAME_MESSAGE_CHARACTERS + 1
        try {
          length = JSON.stringify(message.data).length
        } catch {
          // Structured clone accepts cycles and BigInts, but the bridge does not.
        }
        if (count > MAXIMUM_MESSAGES_PER_SECOND || length > MAXIMUM_FRAME_MESSAGE_CHARACTERS) {
          setError('I paused this interface because it sent too much data.')
          setStopped(true)
          return
        }
        const data = message.data
        if (data.type === GeneratedMessage.Rendered && Number.isFinite(data.height) && !rendered) {
          rendered = true
          clearTimeout(renderTimeout)
          setHeight(Math.min(MAXIMUM_GENERATED_HEIGHT, Math.max(MINIMUM_GENERATED_HEIGHT, data.height)))
          setExportReady(true)
        } else if (data.type === GeneratedMessage.Resize && rendered && Number.isFinite(data.height)) {
          setHeight(Math.min(MAXIMUM_GENERATED_HEIGHT, Math.max(MINIMUM_GENERATED_HEIGHT, data.height)))
        } else if (data.type === GeneratedMessage.State && isGeneratedState(data.value)) {
          callbacks.current.onStateChange?.(data.value)
        } else if (data.type === GeneratedMessage.Submit && !callbacks.current.readOnly && !callbacks.current.submitted && !callbacks.current.pending &&
          isAuroraSubmission(callbacks.current.node, data.values)) {
          setProposal(data.values)
        } else if (data.type === GeneratedMessage.Error) {
          setError('I couldn’t run this interface. You can still read the summary below.')
          setStopped(true)
        } else if ((data.type === GeneratedMessage.Charts || data.type === GeneratedMessage.Controls) && !enginesRequested.has(data.type)) {
          enginesRequested.add(data.type)
          const load = data.type === GeneratedMessage.Charts ? import('virtual:aurora-charts') : import('virtual:aurora-controls')
          void load.then(async ({ default: chartSource }) => {
            const files = await chartSource.load()
            if (live) {
              channel?.port1.postMessage({ type: data.type, entry: chartSource.entry, files })
            }
          }).catch(() => {
            if (live) {
              setError('I couldn’t load this interface component. You can still read the summary below.')
              setStopped(true)
            }
          })
        }
      }
      frame.current?.contentWindow?.postMessage({ version: GENERATED_BRIDGE_VERSION,
        type: GeneratedMessage.Initialize, source: { html, css, javascript },
        state: callbacks.current.initialState, ...themeContext() }, '*', [channel.port2])
    }

    window.addEventListener('message', ready)
    window.addEventListener(THEME_CHANGE_EVENT, sendTheme)
    setURL(blobURL)

    return () => {
      live = false
      window.removeEventListener('message', ready)
      window.removeEventListener(THEME_CHANGE_EVENT, sendTheme)
      channel?.port1.close()
      requestImage.current = undefined
      if (imageRequest) {
        clearTimeout(imageRequest.timeout)
        imageRequest.reject(new Error('This visual is no longer open.'))
        imageRequest = undefined
      }
      clearTimeout(startupTimeout)
      clearTimeout(renderTimeout)
      URL.revokeObjectURL(blobURL)
    }
  }, [html, css, javascript, stopped])

  return <section className="generated-surface" aria-label={node.props.title} ref={container}>
    <header className="generated-toolbar">
      <span>{node.props.title}</span>
      <div className="aurora-actions">
        <Button iconName="code-s-slash" tooltipMessage="View source" tone="muted" onClick={() => setSourceOpen(true)} />
        {document.fullscreenEnabled && <Button
          icon={<Icon name="expand-diagonal" state={expanded ? 'expanded' : 'idle'} />}
          tooltipMessage={expanded ? 'Collapse' : 'Expand'} tone="muted" ariaPressed={expanded}
          onClick={() => void toggleFullscreen()} />}
      </div>
    </header>
    {url && !stopped && <iframe ref={frame} src={url} title={node.props.title} sandbox="allow-scripts"
      referrerPolicy="no-referrer" className="generated-frame" style={{ height }} />}
    {error && <p className="aurora-feedback" role="status">{error}</p>}
    <details className="generated-summary" open={stopped}>
      <summary>Text summary</summary><p>{node.props.fallback}</p>
    </details>
    {readOnly && node.props.fields && !submitted && <p className="aurora-feedback">You can send a selection from the latest completed reply.</p>}
    {proposal && node.props.fields && <div className="generated-confirmation">
      <dl>{node.props.fields.map((field) => <div key={field.name}><dt>{field.label}</dt>
        <dd>{(proposal as Record<string, string>)[field.name]}</dd></div>)}</dl>
      <Button variant="secondary" disabled={readOnly || submitted || pending || !onSubmit} loading={pending}
        onClick={() => {
          setPending(true)
          setSubmitError(false)
          void onSubmit?.(proposal).catch(() => setSubmitError(true)).finally(() => setPending(false))
        }}>Send selection</Button>
      {submitError && <p role="alert" className="aurora-feedback">I couldn’t send this. Your selection is still here; please try again.</p>}
      {submitted && <p role="status" className="aurora-feedback">Sent. Thank you.</p>}
    </div>}
    <Dialog title="Interface source" open={sourceOpen} onClose={() => setSourceOpen(false)} centered size="wide"
      footer={<CopyButton text={source} label="Copy source" />}>
      <Suspense fallback={<Loader size="sm" />}><CodeView text={source} label="Interface source" language="html" /></Suspense>
    </Dialog>
  </section>
}
