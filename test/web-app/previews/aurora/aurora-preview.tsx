import '@fontsource/source-sans-pro/latin-400.css'
import '@fontsource/source-sans-pro/latin-600.css'
import '@/styles/main.sass'

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AURORA_CATALOG, ArtifactWidget, Badge, BooleanChoiceWidget, Button, ChoiceWidget,
  FormWidget, Input, Loader, PreparationStatus, PreparationWidget, Progress,
  Selection, Range, Surface, Switch, Segmented, Tabs, NumberStepper, SearchSelect,
  DataTableWidget, ComparisonWidget
} from '../../../../aurora/src/v2'
import { Button as AppButton } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { Input as AppInput } from '@/components/input'
import { FileIcon, Icon } from '@/components/icon'
import { VisualPreview, VisualPreviewProvider } from '@/components/visual-preview/visual-preview'
import { ToastProvider } from '@/components/toast'
import { createSearchIndex, searchIndex } from '@/utils/search'
import { applyTheme, getCurrentTheme, type Theme } from '@/theme'
import { AURORA_QUERY_EXAMPLES, AURORA_GENERATED_SPEC, AURORA_CALCULATOR_SPEC, AURORA_LIGHT_SPEC, AURORA_MEMORY_SPEC, AURORA_PRESENTATION_SPEC } from '../../../fixtures/aurora'
import type { ChartData } from '../../../../aurora/src/v2/contracts/presentation'
import imageURL from '../../../../aurora/preview/public/pancakes.jpeg?url'
import documentURL from '../../../fixtures/documents/attention-is-all-you-need.pdf?url'

import './aurora-preview.sass'
import { ConnectionsPreview } from './connection-preview'

type GalleryKind = 'component' | 'widget' | 'connection' | 'generated' | 'answer' | 'feed'
type DemoOutcome = 'success' | 'failure' | 'pending'

const SEARCH_INDEX = createSearchIndex(AURORA_CATALOG, (entry) => [entry.title, entry.description])
const GeneratedFrame = lazy(() => import('@/components/aurora-answer/generated/generated-frame'))
const ChartWidget = lazy(() => import('@/components/aurora-answer/chart-widget'))
const FeedPreview = lazy(() => import('./feed-preview'))
const CHOICES = [
  { value: 'quiet', label: 'A quiet morning', description: 'A little room to think.' },
  { value: 'creative', label: 'Something creative', description: 'Try an idea and see where it goes.' },
  { value: 'outside', label: 'Time outside', description: 'Take a small break from the screen.' }
]
const ARTIFACTS = [
  { id: 'image', filename: 'Sunday pancakes.jpeg', mimeType: 'image/jpeg', url: imageURL },
  { id: 'document', filename: 'Attention is all you need.pdf', mimeType: 'application/pdf', url: documentURL }
]

function Artifacts() {
  return <ArtifactWidget title="A little inspiration" items={ARTIFACTS}
    renderFileIcon={(filename) => <FileIcon fileName={filename} />}
    renderImagePreview={(item, image) => <VisualPreview title={item.filename} fullWidth>{image}</VisualPreview>}
  />
}

function QueryExample({ id }: { id: string }) {
  const query = Object.entries(AURORA_QUERY_EXAMPLES).find(([key]) => key === id)?.[1]

  if (!query) {
    return null
  }

  return <aside className="gallery-query" aria-label="Try in Leon">
    <div><span>Try in Leon</span><CopyButton text={query} label="Copy query" size="sm" /></div>
    <p>{query}</p>
  </aside>
}

function SubmissionDemo({ children }: { children: (submit: (value: unknown) => Promise<void>) => ReactNode }) {
  const [outcome, setOutcome] = useState<DemoOutcome>('success')
  const [receipt, setReceipt] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const finishRef = useRef<(() => void) | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      finishRef.current?.()
    }
  }, [])

  async function submit(value: unknown): Promise<void> {
    if (outcome === 'failure') {
      throw new Error('Previewed save failure')
    }

    if (outcome === 'pending') {
      setPending(true)
      await new Promise<void>((resolve) => {
        finishRef.current = resolve
      })
      finishRef.current = null
    }

    if (mounted.current) {
      setPending(false)
      setReceipt(value)
    }
  }

  return <div className="demo-stack">
    <div key={revision}>{children(submit)}</div>
    <div className="demo-controls">
      <label>Preview result <select value={outcome} disabled={pending}
        onChange={(event) => setOutcome(event.target.value as DemoOutcome)}>
        <option value="success">Success</option>
        <option value="failure">Failure</option>
        <option value="pending">Pending</option>
      </select></label>
      {pending ? <Button variant="secondary" onClick={() => finishRef.current?.()}>Finish save</Button> : (
        <Button onClick={() => {
          setReceipt(undefined)
          setRevision((value) => value + 1)
        }}>Reset example</Button>
      )}
    </div>
    {receipt !== undefined && <output className="demo-receipt" aria-label="Submitted values">{JSON.stringify(receipt, null, 2)}</output>}
  </div>
}

function PreparationDemo() {
  const [status, setStatus] = useState(PreparationStatus.Downloading)
  const [completed, setCompleted] = useState(36)
  const details = {
    [PreparationStatus.Preparing]: 'Checking the files I need…',
    [PreparationStatus.Downloading]: 'Downloading the speech model',
    [PreparationStatus.Ready]: 'The files are ready.',
    [PreparationStatus.Failed]: 'I couldn’t finish the download. You can try again.',
    [PreparationStatus.Cancelled]: 'Download cancelled.'
  }

  return <div className="demo-stack">
    <PreparationWidget title="Getting things ready" status={status} detail={details[status]}
      {...(status === PreparationStatus.Downloading ? { completed, total: 100 } : {})}
      onCancel={() => setStatus(PreparationStatus.Cancelled)} onRetry={() => setStatus(PreparationStatus.Downloading)} />
    <div className="demo-controls">
      <label>Preview state <select value={status} onChange={(event) => setStatus(event.target.value as PreparationStatus)}>
        {Object.values(PreparationStatus).map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>Measured progress <input aria-label="Measured progress" type="range" min={0} max={100}
        value={completed} onChange={(event) => setCompleted(Number(event.target.value))} /></label>
    </div>
  </div>
}

function ButtonDemo() {
  const [selected, setSelected] = useState(false)

  return <div className="demo-stack">
    <div className="aurora-actions">
      <Button variant="primary">Continue</Button><Button variant="secondary">Save for later</Button>
      <Button>Not now</Button><Button variant="danger">Delete</Button>
    </div>
    <div className="aurora-actions">
      <Button variant="primary" loading>Saving…</Button><Button variant="secondary" disabled>Unavailable</Button>
      <Button ariaPressed={selected} icon={<Icon name="pushpin-line" selected={selected} morph />}
        onClick={() => setSelected((value) => !value)}>{selected ? 'Pinned' : 'Pin'}</Button>
      <CopyButton text="A little more than words." label="Copy example" />
    </div>
  </div>
}

function SelectionDemo() {
  const [selected, setSelected] = useState(false)

  return <div className="demo-stack">
    <Selection multiple label="Leave a little room for a new idea" checked={selected}
      onChange={(event) => setSelected(event.target.checked)} />
    <Selection multiple label="Kept for later" defaultChecked disabled />
    <Selection name="selection-example" label="A gentle pace" defaultChecked />
    <Selection name="selection-example" label="A focused afternoon" />
  </div>
}

function ChartDemo(props: ChartData) {
  const [kind, setKind] = useState(props.kind)

  return <div className="demo-stack">
    <Segmented label="Chart type" value={kind} options={[
      { value: 'bar', label: 'Bar' }, { value: 'line', label: 'Line' }, { value: 'pie', label: 'Pie' }
    ]} onValueChange={(value) => {
      if (value === 'bar' || value === 'line' || value === 'pie') {
        setKind(value)
      }
    }} />
    <Suspense fallback={<Loader size="sm" />}><ChartWidget {...props} kind={kind} /></Suspense>
  </div>
}

function formExample(submit: (value: unknown) => Promise<void>) {
  return <FormWidget title="Make room for a small project" onSubmit={submit} fields={[
    { name: 'name', label: 'Project name', type: 'text', required: true, placeholder: 'A little idea' },
    { name: 'pace', label: 'Pace', type: 'select', required: true, options: [
      { value: 'gentle', label: 'A gentle pace' }, { value: 'focused', label: 'A focused afternoon' }
    ] },
    { name: 'notes', label: 'Anything else?', type: 'textarea', placeholder: 'There is no rush.' }
  ]} />
}

function Example({ id }: { id: string }) {
  const spec = id === 'reading-dashboard' ? AURORA_GENERATED_SPEC :
    id === 'savings-calculator' ? AURORA_CALCULATOR_SPEC : id === 'light-explorer' ? AURORA_LIGHT_SPEC :
      id === 'memory-map' ? AURORA_MEMORY_SPEC : undefined
  const [state, setState] = useState<Record<string, unknown>>({})
  const [receipt, setReceipt] = useState<unknown>()
  const [selected, setSelected] = useState<string[]>([])
  const presentation = AURORA_PRESENTATION_SPEC.elements[id]
  if (presentation?.type === 'DataTable') {
    return <DataTableWidget {...presentation.props} />
  }
  if (presentation?.type === 'Comparison') {
    return <ComparisonWidget {...presentation.props} />
  }
  if (presentation?.type === 'Chart') {
    return <ChartDemo {...presentation.props} />
  }
  const generated = spec?.elements[spec.root]
  if (generated?.type === 'Generated') {
    return <><Suspense fallback={<Loader size="sm" />}>
      <GeneratedFrame node={generated} initialState={state} onStateChange={setState} submitted={receipt !== undefined}
        onSubmit={async (values) => { setReceipt(values) }} />
    </Suspense>
    {receipt !== undefined && <output aria-label="Submitted values">{JSON.stringify(receipt)}</output>}</>
  }
  switch (id) {
    case 'button':
      return <ButtonDemo />
    case 'badge':
      return <div className="aurora-actions">
        <Badge label="New" /><Badge label="Soon" variant="secondary" />
        <Badge label="Connected" variant="success" /><Badge label="Failed" variant="error" />
        <Badge label="Action needed" variant="warning" />
      </div>
    case 'input':
      return <div className="demo-stack"><Input ariaLabel="A small idea" placeholder="What’s on your mind?" />
        <Input ariaLabel="A longer note" multiline rows={3} placeholder="A little more room…" /></div>
    case 'selection':
      return <SelectionDemo />
    case 'range':
      return <Range aria-label="A little room to adjust" min={0} max={100} defaultValue={40} />
    case 'switch':
      return <Switch label="A little background music" defaultChecked />
    case 'segmented':
      return <Segmented label="A pace for today" defaultValue="gentle" options={[
        { value: 'gentle', label: 'Gentle' }, { value: 'focused', label: 'Focused' }
      ]} />
    case 'tabs':
      return <Tabs label="Project views" items={[
        { value: 'ideas', label: 'Ideas', content: <p>A little room to explore.</p> },
        { value: 'notes', label: 'Notes', content: <p>Keep the useful pieces together.</p> }
      ]} />
    case 'number-stepper':
      return <NumberStepper label="Reading minutes" defaultValue="30" min={0} max={60} step={5} />
    case 'search-select':
      return <div className="demo-stack"><SearchSelect label="Choose a moment" options={CHOICES} />
        <SearchSelect label="Make room for" multiple options={CHOICES} value={selected} onValueChange={setSelected} />
        <output aria-label="Selected moments">{selected.join(', ')}</output></div>
    case 'loader':
      return <div className="aurora-actions"><Loader size="xs" label="A moment…" /><Loader size="sm" label="Getting ready…" /><Loader size="md" label="Getting things ready…" /></div>
    case 'progress':
      return <div className="demo-stack"><Progress label="Preparing a workspace" /><Progress label="Files downloaded" value={64} /></div>
    case 'surface':
      return <Surface title="A place for your ideas" description="Small pieces can make something useful."
        footer={<Button variant="primary">Keep this idea</Button>}><p>Start wherever feels right.</p></Surface>
    case 'boolean':
      return <SubmissionDemo>{(submit) => <BooleanChoiceWidget title="Keep this idea for later?" onSubmit={submit} />}</SubmissionDemo>
    case 'single-choice':
      return <SubmissionDemo>{(submit) => <ChoiceWidget title="What sounds good?" options={CHOICES} onSubmit={submit} />}</SubmissionDemo>
    case 'multi-choice':
      return <SubmissionDemo>{(submit) => <ChoiceWidget title="Make a little space for…" options={CHOICES} multiple onSubmit={submit} />}</SubmissionDemo>
    case 'form':
      return <SubmissionDemo>{formExample}</SubmissionDemo>
    case 'preparation':
      return <PreparationDemo />
    case 'artifacts':
      return <Artifacts />
    default:
      return null
  }
}

function App() {
  const [kind, setKind] = useState<GalleryKind>('component')
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<Theme>(getCurrentTheme)
  const [narrow, setNarrow] = useState(false)
  const results = searchIndex(SEARCH_INDEX, query).filter(({ item }) => item.kind === kind)

  return <ToastProvider><VisualPreviewProvider><main className="aurora-gallery">
    <header className="aurora-gallery-header">
      <div><p className="gallery-eyebrow">Leon’s visual language</p><h1>Aurora <span>2.0</span></h1>
        <p className="gallery-intro">A little more than words. A quiet space to explore, choose and create.</p></div>
      <div className="aurora-actions">
        <AppButton iconName={theme === 'dark' ? 'sun' : 'moon'} tooltipMessage={`Apply ${theme === 'dark' ? 'light' : 'dark'} theme`}
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark'
            setTheme(next)
            void applyTheme(next)
          }} />
        <Button ariaPressed={narrow} onClick={() => setNarrow((value) => !value)}>Narrow preview</Button>
      </div>
    </header>
    <div className="gallery-toolbar">
      <nav aria-label="Aurora collection" className="aurora-actions">
        {(['component', 'widget', 'connection', 'generated', 'answer', 'feed'] as const).map((value) => <Button key={value}
          ariaPressed={kind === value} variant={kind === value ? 'secondary' : 'ghost'}
          onClick={() => setKind(value)}>{value === 'component' ? 'Components' : value === 'widget' ? 'Widgets' : value === 'connection' ? 'Connections' : value === 'generated' ? 'Generated UI' : value === 'feed' ? 'Feed' : 'Answer preview'}</Button>)}
      </nav>
      {kind !== 'answer' && kind !== 'connection' && kind !== 'feed' && <AppInput ariaLabel="Find a component or widget" type="search" iconName="search"
        placeholder="Find something…" value={query} onChange={(event) => setQuery(event.target.value)} />}
    </div>
    <p className="gallery-notice">Interactive local examples. Nothing here is sent to Leon or an AI provider.</p>
    {kind === 'widget' && <p className="gallery-notice">Copy a query into a session to try it with Leon. He chooses the presentation; the result may differ from these examples.</p>}
    {kind === 'feed' ? <div className={`feed-example${narrow ? ' gallery-narrow' : ''}`}>
      <Suspense fallback={<Loader size="sm" label="Opening feed examples…" />}><FeedPreview /></Suspense>
    </div> : kind === 'connection' ? <div className={`connections-example${narrow ? ' gallery-narrow' : ''}`}><ConnectionsPreview /></div> : kind === 'answer' ? <section aria-label="Visual answer preview" className={`answer-example${narrow ? ' gallery-narrow' : ''}`}>
      <p>A slow Sunday sounds lovely. Here’s a little inspiration for the morning.</p>
      <Artifacts />
      <p>You could make breakfast, then leave a little time for something you enjoy.</p>
      <Example id="single-choice" />
      <p className="gallery-notice">An example of ordered answer content—not a connected agent response.</p>
    </section> : <div className={`gallery-grid${narrow ? ' gallery-narrow' : ''}`}>
      {results.map(({ item }) => <section className="gallery-example" aria-label={item.title} key={item.id}>
        <header><h2>{item.title}</h2><p>{item.description}</p></header><Example id={item.id} />
        <QueryExample id={item.id} />
      </section>)}
      {results.length === 0 && <p role="status">Nothing here yet. Try another word.</p>}
    </div>}
    <footer className="gallery-notice">Made for Leon’s pace. Native controls, local assets and shared design tokens.</footer>
  </main></VisualPreviewProvider></ToastProvider>
}

createRoot(document.getElementById('aurora-preview')!).render(<App />)
