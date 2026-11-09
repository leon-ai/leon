import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { Button } from '../../../../../../aurora/src/v2/components/button/button'
import { Input } from '../../../../../../aurora/src/v2/components/input/input'
import { Progress } from '../../../../../../aurora/src/v2/components/progress'
import { Selection } from '../../../../../../aurora/src/v2/components/selection'
import { Surface } from '../../../../../../aurora/src/v2/components/surface'
import { Loader } from '../../../../../../aurora/src/v2/components/loader/loader'
import { Range } from '../../../../../../aurora/src/v2/components/range'
import { Switch } from '../../../../../../aurora/src/v2/components/switch'
import { Segmented } from '../../../../../../aurora/src/v2/components/segmented'
import type { TabsProps } from '../../../../../../aurora/src/v2/components/tabs'
import { NumberStepper } from '../../../../../../aurora/src/v2/components/number-stepper'
import type { SearchSelectProps } from '../../../../../../aurora/src/v2/components/search-select'
import { DataTableWidget } from '../../../../../../aurora/src/v2/widgets/data-table'
import { ComparisonWidget } from '../../../../../../aurora/src/v2/widgets/comparison'
import { ChartWidget, type ChartInstance } from '../../../../../../aurora/src/v2/widgets/chart'
import type { ChartData } from '../../../../../../aurora/src/v2/contracts/presentation'
import { GENERATED_BRIDGE_VERSION, GeneratedMessage, isGeneratedState } from '../../../../../../aurora/src/v2/contracts/generated'
import { COMMON_ICONS, ICON_VARIANT_ARTWORK, type IconDefinition } from '../../icon/icon-definitions'
import { IconPaths } from '../../icon/icon-paths'
import { resolveIconName, getIconVariant } from '../../icon/icon-name'
import { observeNativeControls } from './native-controls'

const MAXIMUM_ERROR_CHARACTERS = 512
let port: MessagePort | undefined
let root: Root | undefined
let state: Record<string, unknown> = {}
let measureFrame = 0
let previousHeight = 0
let sourceFinished = false
let reactCommitted = true
let renderRevision = 0
let pendingVisuals = 0
let firstRender = true
let fontsPending = false
let initialMeasurementPending = false
let disposed = false
const SOURCE_FINISHED_EVENT = 'aurora:source-finished'
let chartsPending: Promise<void> | undefined
let resolveCharts: (() => void) | undefined
let controlsPending: Promise<NonNullable<Window['auroraControlsRuntime']>> | undefined
let resolveControls: ((value: NonNullable<Window['auroraControlsRuntime']>) => void) | undefined
const moduleURLs = new Map<string, string>()

function trackVisual<T>(work: Promise<T>): Promise<T> {
  pendingVisuals += 1

  return work.finally(() => {
    pendingVisuals -= 1
    measure()
  })
}

function PendingVisual() {
  React.useLayoutEffect(() => {
    pendingVisuals += 1

    return () => {
      pendingVisuals -= 1
      measure()
    }
  }, [])

  return <Loader size="sm" />
}

function RenderCommit({ children, revision }: { children: React.ReactNode, revision: number }) {
  React.useLayoutEffect(() => {
    reactCommitted = true
    measure()
  }, [revision])

  return children
}

declare global {
  interface Window {
    Aurora: typeof api
    React: typeof React
    auroraReactDOM: typeof ReactDOM
    auroraImageRuntime?: () => Promise<Blob>
    auroraControlsRuntime?: {
      Tabs: React.ComponentType<TabsProps>
      SearchSelect: React.ComponentType<SearchSelectProps>
    }
    auroraChartsRuntime?: {
      create: (element: HTMLElement, option: Record<string, unknown>) => Promise<ChartInstance>
      dispose: () => void
      refresh: () => void
      snapshots: (root: HTMLElement) => ReadonlyMap<HTMLCanvasElement, string>
    }
  }
}

function loadControls(): Promise<NonNullable<Window['auroraControlsRuntime']>> {
  if (!controlsPending) {
    controlsPending = trackVisual(new Promise((resolve) => {
      resolveControls = resolve
    }))
    port?.postMessage({ type: GeneratedMessage.Controls })
  }

  return controlsPending
}

const LazyTabs = React.lazy(async () => ({ default: (await loadControls()).Tabs }))
const LazySearchSelect = React.lazy(async () => ({ default: (await loadControls()).SearchSelect }))

function Tabs(props: TabsProps) {
  return <React.Suspense fallback={<PendingVisual />}><LazyTabs {...props} /></React.Suspense>
}

function SearchSelect(props: SearchSelectProps) {
  return <React.Suspense fallback={<PendingVisual />}><LazySearchSelect {...props} /></React.Suspense>
}

function reportError(error: unknown): void {
  port?.postMessage({ type: GeneratedMessage.Error,
    message: (error instanceof Error ? error.message : String(error)).slice(0, MAXIMUM_ERROR_CHARACTERS) })
}

function Icon({ name }: { name: string }) {
  const icons: Readonly<Record<string, IconDefinition>> = COMMON_ICONS
  const variants: Readonly<Record<string, IconDefinition>> = ICON_VARIANT_ARTWORK
  const resolved = resolveIconName(name)
  const variant = `${resolved}-${getIconVariant(name)}`
  const definition = Object.hasOwn(variants, variant) ? variants[variant]! :
    Object.hasOwn(icons, resolved) ? icons[resolved]! : icons['tools']!

  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><IconPaths definition={definition} /></svg>
}

const api = {
  React, h: React.createElement, Button, Input, Progress, Selection, Range, Switch, Segmented, Tabs,
  NumberStepper, SearchSelect, Surface, Loader, Icon, DataTableWidget, ComparisonWidget,
  ChartWidget: (props: ChartData) => <ChartWidget {...props} createChart={api.chart} />,
  token(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!name.startsWith('--') || !value) {
      throw new Error(`Unknown Aurora token ${name}.`)
    }

    return value
  },
  render(content: React.ReactNode): void {
    root ??= createRoot(document.getElementById('aurora-root')!, { onUncaughtError: reportError })
    reactCommitted = false
    root.render(<RenderCommit revision={++renderRevision}>{content}</RenderCommit>)
  },
  state: {
    get(): Record<string, unknown> {
      return structuredClone(state)
    },
    set(value: Record<string, unknown>): void {
      if (!isGeneratedState(value)) {
        throw new Error('Keep saved interface state to a small JSON object.')
      }
      state = structuredClone(value)
      port?.postMessage({ type: GeneratedMessage.State, value: state })
    }
  },
  submit(values: Record<string, string>): void {
    // The host presents these values for an explicit owner confirmation. This
    // proposal cannot itself send a conversation command or invoke a tool.
    port?.postMessage({ type: GeneratedMessage.Submit, values })
  },
  async chart(element: HTMLElement, option: Record<string, unknown>): Promise<ChartInstance> {
    if (!chartsPending) {
      chartsPending = new Promise<void>((resolve) => {
        resolveCharts = resolve
      })
      port?.postMessage({ type: GeneratedMessage.Charts })
    }
    return trackVisual(chartsPending.then(() => window.auroraChartsRuntime!.create(element, option)))
  }
}

function context(value: { theme: string, variables: Record<string, string> }): void {
  document.documentElement.dataset['theme'] = value.theme
  for (const [name, item] of Object.entries(value.variables)) {
    document.documentElement.style.setProperty(name, item)
  }
  window.auroraChartsRuntime?.refresh()
  window.dispatchEvent(new Event('aurora:theme'))
}

function measure(): void {
  cancelAnimationFrame(measureFrame)
  if (disposed || firstRender && (!sourceFinished || !reactCommitted || pendingVisuals > 0)) {
    return
  }
  if (document.fonts.status !== 'loaded') {
    if (!fontsPending) {
      fontsPending = true
      void document.fonts.ready.then(() => {
        fontsPending = false
        measure()
      })
    }
    return
  }
  const report = (): void => {
    if (disposed || firstRender && (!sourceFinished || !reactCommitted || pendingVisuals > 0)) {
      return
    }
    const height = Math.ceil(document.body.getBoundingClientRect().height)
    if (firstRender || height !== previousHeight) {
      previousHeight = height
      port?.postMessage({ type: firstRender ? GeneratedMessage.Rendered : GeneratedMessage.Resize, height })
      firstRender = false
    }
  }
  if (firstRender) {
    // Offscreen cross-origin frames can have rAF suspended. Their initial
    // layout must still reach the feed before the owner scrolls them into view.
    if (!initialMeasurementPending) {
      initialMeasurementPending = true
      queueMicrotask(() => {
        initialMeasurementPending = false
        report()
      })
    }
  } else {
    measureFrame = requestAnimationFrame(report)
  }
}

function exportImage(id: string): void {
  void window.auroraImageRuntime!().then(async (blob) => {
    const bytes = await blob.arrayBuffer()
    port?.postMessage({ type: GeneratedMessage.Export, id, bytes }, [bytes])
  }).catch(() => {
    port?.postMessage({ type: GeneratedMessage.Export, id, failed: true })
  })
}

function initialize(event: MessageEvent): void {
  if (event.source !== parent || event.data?.version !== GENERATED_BRIDGE_VERSION ||
    event.data?.type !== GeneratedMessage.Initialize || !event.ports[0]) {
    return
  }
  window.removeEventListener('message', initialize)
  port = event.ports[0]
  port.onmessage = (message: MessageEvent) => {
    if (message.data.type === GeneratedMessage.Export && window.auroraImageRuntime) {
      exportImage(message.data.id)
      return
    }
    if (message.data.type === GeneratedMessage.Context) {
      context(message.data)
    } else if (message.data.type === GeneratedMessage.Charts || message.data.type === GeneratedMessage.Controls ||
      message.data.type === GeneratedMessage.Export) {
      const files = message.data.files as Record<string, { source: string, imports: string[] }>
      function moduleURL(name: string): string {
        const previous = moduleURLs.get(name)
        if (previous) {
          return previous
        }
        const file = files[name]!
        let code = file.source
        for (const dependency of file.imports) {
          const url = moduleURL(dependency)
          code = code.replaceAll(`"./${dependency}"`, JSON.stringify(url))
            .replaceAll(`'./${dependency}'`, JSON.stringify(url))
        }
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
        moduleURLs.set(name, url)

        return url
      }
      const script = document.createElement('script')
      script.type = 'module'
      script.src = moduleURL(message.data.entry)
      script.onload = () => {
        script.remove()
        if (message.data.type === GeneratedMessage.Charts) {
          resolveCharts?.()
        } else if (message.data.type === GeneratedMessage.Controls) {
          resolveControls?.(window.auroraControlsRuntime!)
        } else {
          exportImage(message.data.id)
        }
      }
      script.onerror = () => {
        script.remove()
        if (message.data.type === GeneratedMessage.Export) {
          port?.postMessage({ type: GeneratedMessage.Export, id: message.data.id, failed: true })
        } else {
          reportError('I could not load this interface component.')
        }
      }
      document.head.append(script)
    }
  }
  const initial = event.data
  context(initial)
  state = isGeneratedState(initial.state) ? initial.state : {}
  document.getElementById('aurora-content')!.innerHTML = initial.source.html
  const style = document.createElement('style')
  // Unlayered shared controls outrank authored rules, even ID selectors. Layout
  // and content styling remain free within their own lower-priority layer.
  style.textContent = `@layer generated { ${initial.source.css ?? ''} }`
  document.head.append(style)
  const releaseControls = observeNativeControls(document.body)
  window.Aurora = api
  window.React = React
  window.auroraReactDOM = ReactDOM

  const observer = new ResizeObserver(measure)
  observer.observe(document.body)
  window.addEventListener('error', (error) => reportError(error.message))
  window.addEventListener('unhandledrejection', (error) => reportError(error.reason))
  window.addEventListener('pagehide', () => {
    disposed = true
    releaseControls()
    observer.disconnect()
    cancelAnimationFrame(measureFrame)
    root?.unmount()
    window.auroraChartsRuntime?.dispose()
    for (const url of moduleURLs.values()) {
      URL.revokeObjectURL(url)
    }
    moduleURLs.clear()
    port?.close()
  }, { once: true })
  window.addEventListener(SOURCE_FINISHED_EVENT, () => {
    sourceFinished = true
    measure()
  }, { once: true })
  const script = document.createElement('script')
  script.textContent = `(async () => {\n${initial.source.javascript ?? ''}\n})().then(() => window.dispatchEvent(new Event('${SOURCE_FINISHED_EVENT}'))).catch(error => window.dispatchEvent(new ErrorEvent('error', { message: String(error) })))`
  document.body.append(script)
  measure()
}

window.addEventListener('message', initialize)
parent.postMessage({ version: GENERATED_BRIDGE_VERSION, type: GeneratedMessage.Ready }, '*')
