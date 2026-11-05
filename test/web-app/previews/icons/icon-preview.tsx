import '@fontsource/source-sans-pro/latin-400.css'
import '@fontsource/source-sans-pro/latin-600.css'
import '@/styles/main.sass'

import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { Icon } from '@/components/icon'
import { ICON_ALIASES, SOFT_ICON_NAMES } from '@/components/icon/icon-definitions'
import { IconPaths } from '@/components/icon/icon'
import { BRAND_ICONS } from '@/components/icon/brand-icons'
import { ICON_MORPHS, type MorphFrames } from '@/components/icon/icon-morphs'
import { MorphPaths } from '@/components/icon/morph-paths'
import { LLMProviderIcon } from '@/components/llm-provider-icon'
import { ThoughtIcon } from '@/components/thought-icon'
import { ToastProvider } from '@/components/toast'
import { MenuItem } from '@/layout/sidebar/menu-item'
import { getPublicAssetPath } from '@/config'
import { ORIGINAL_ARTWORK } from './original-artwork'
import { SOFT_COMMON_ICONS, SOFT_TOOL_ICONS } from './soft-artwork'

import './icon-preview.sass'

const ICON_SIZES = [16, 20, 24, 32]
const SELECTION_STORAGE_KEY = 'leon.web-app.icon-preview.soft-selections'
const MENU = [
  { name: 'edit-box', label: 'New session' },
  { name: 'search', label: 'Search sessions' },
  { name: 'settings', label: 'Settings' },
  { name: 'download-cloud-2', label: 'Update' },
  { name: 'book-open', label: 'Docs' }
]
const MORPH_LABELS: Readonly<Record<string, string>> = {
  copy: 'Copy confirmation', theme: 'Theme', sound: 'Sounds', sidebar: 'Sidebar',
  composer: 'Send and stop', pin: 'Pinning', 'list-selection': 'Inline view',
  'column-selection': 'Split view'
}
// Discover local marks without loading profile or model configuration.
const PROVIDERS = Object.keys(import.meta.glob('../../../../apps/web/public/img/providers/*.svg', {
  query: '?url', import: 'default'
})).map((file) => file.split('/').at(-1)!.slice(0, -'.svg'.length)).sort()
const CATALOGS = [
  { id: 'interface', title: 'Interface and activity', icons: Object.keys(SOFT_COMMON_ICONS).sort() },
  { id: 'tools', title: 'Tools and categories', icons: Object.keys(SOFT_TOOL_ICONS).sort() },
  { id: 'aliases', title: 'Compatibility names', icons: Object.keys(ICON_ALIASES).sort() }
]

// Only explicit exceptions are stored; new artwork always starts with its original selected.
function readSoftSelections(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null')

    if (Array.isArray(value)) {
      return Object.keys(ORIGINAL_ARTWORK).filter((name) => value.includes(name))
    }
  } catch {
    // Reviewing artwork still works when browser storage is blocked or invalid.
  }

  return [...SOFT_ICON_NAMES].sort()
}

function GallerySection({ id, title, count, description, children }: {
  id: string
  title: string
  count: number
  description?: string | undefined
  children: ReactNode
}) {
  return (
    <section id={id} className="gallery-section" aria-labelledby={`${id}-heading`}>
      <header className="section-header">
        <h2 id={`${id}-heading`}>{title} <span className="section-count">{count}</span></h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  )
}

function IconTile({ name, children }: { name: string, children: ReactNode }) {
  const aliases = Object.entries(ICON_ALIASES).filter(([, target]) => target === name).map(([alias]) => alias)

  return (
    <li className="icon-tile" data-preview-icon={name} title={aliases.length ? `Also used as: ${aliases.join(', ')}` : name}>
      <span className="icon-tile-artwork">{children}</span>
      <span className="icon-tile-name">{name}</span>
    </li>
  )
}

function ComparisonTile({ name, soft, onChange }: {
  name: string
  soft: boolean
  onChange: (soft: boolean) => void
}) {
  const original = ORIGINAL_ARTWORK[name]!
  const softName = ICON_ALIASES[name] ?? name
  const study = (SOFT_COMMON_ICONS as typeof SOFT_TOOL_ICONS)[softName] ?? SOFT_TOOL_ICONS[softName]!

  return (
    <li className="comparison-tile" data-preview-comparison={name}>
      <h3>{name}</h3>
      <div className="comparison-options" role="group" aria-label={`${name} artwork`}>
        <Button className="artwork-choice" ariaPressed={!soft} onClick={() => onChange(false)}
          icon={<span className="original-artwork" style={{ maskImage: `url("${original.url}")` }} />}>
          Original
        </Button>
        <Button className="artwork-choice" ariaPressed={soft} onClick={() => onChange(true)}
          icon={<svg className="app-icon" viewBox="0 0 24 24" fill="none" strokeWidth="2.1"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <IconPaths definition={study} />
          </svg>}>
          Soft B
        </Button>
      </div>
      <p className="original-filename">{original.filename}</p>
    </li>
  )
}

function PoseIcon({ frames, state }: { frames: MorphFrames, state: string }) {
  return (
    <svg className="app-icon" viewBox="0 0 24 24" fill="none" strokeWidth="2.1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <MorphPaths frames={frames} state={state} />
    </svg>
  )
}

function MorphCard({ family, frames }: { family: string, frames: MorphFrames }) {
  const states = Object.keys(frames)
  const [index, setIndex] = useState(0)
  const label = MORPH_LABELS[family] ?? family

  return (
    <article className="morph-card" data-preview-morph={family} aria-label={label}>
      <h3>{label}</h3>
      <div className="morph-endpoints" aria-label="Available states">
        {states.map((state) => (
          <span key={state}><PoseIcon frames={frames} state={state} /><span>{state}</span></span>
        ))}
      </div>
      <Button className="morph-trigger" icon={<PoseIcon frames={frames} state={states[index]!} />}
        ariaLabel={`Toggle ${label.toLowerCase()} preview`} ariaPressed={index > 0}
        onClick={() => setIndex((current) => (current + 1) % states.length)} />
      <p className="morph-current" aria-live="polite">{states[index]}</p>
    </article>
  )
}

function IconPreview() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [size, setSize] = useState(24)
  const [softSelections, setSoftSelections] = useState(readSoftSelections)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(softSelections))
      setSaved(true)
    } catch {
      setSaved(false)
    }
  }, [softSelections])

  useLayoutEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  function selectArtwork(name: string, soft: boolean): void {
    setSoftSelections((current) => {
      if (current.includes(name) === soft) {
        return current
      }

      return soft ? [...current, name].sort() : current.filter((selected) => selected !== name)
    })
  }

  return (
    <main style={{ '--preview-icon-size': `${size}px` } as CSSProperties}>
      <header className="preview-header">
        <div>
          <p className="eyebrow">Leon · Icon review</p>
          <h1>Keep the familiar. Soften a few.</h1>
          <p className="introduction">Compare the original SVGs with Soft B. Original is the default, with the app’s approved exceptions selected for you.</p>
        </div>
        <div className="preview-controls">
          <label htmlFor="icon-size">Icon size</label>
          <select id="icon-size" value={size} onChange={(event) => setSize(Number(event.target.value))}>
            {ICON_SIZES.map((value) => <option key={value} value={value}>{value}px</option>)}
          </select>
          <Button iconName={theme === 'dark' ? 'moon' : 'sun'} variant="secondary"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Apply light theme' : 'Apply dark theme'}
          </Button>
        </div>
      </header>
      <div className="selection-summary">
        <div>
          <p>{softSelections.length} Soft B {softSelections.length === 1 ? 'exception' : 'exceptions'} selected</p>
          <p className="selection-note" role="status">{saved
            ? 'Choices are saved in this browser only. The app stays unchanged until you approve them.'
            : 'Browser storage is unavailable. Copy your choices before leaving; the app stays unchanged.'}</p>
        </div>
        <CopyButton text={JSON.stringify({ default: 'original', softB: softSelections }, null, 2)} label="Copy icon choices" />
      </div>
      <nav className="gallery-navigation" aria-label="Gallery sections">
        {CATALOGS.map((catalog) => <a key={catalog.id} href={`#${catalog.id}`}>{catalog.title}</a>)}
        <a href="#brands">Brand marks</a>
        <a href="#providers">Providers</a><a href="#custom">Custom artwork</a>
        <a href="#gestures">Gestures</a><a href="#morphs">State morphs</a>
      </nav>
      {CATALOGS.map((catalog) => (
        <GallerySection key={catalog.id} id={catalog.id} title={catalog.title} count={catalog.icons.length}
          description={catalog.id === 'aliases'
            ? 'Older names can have distinct original shapes. Review them separately rather than losing those differences.'
            : undefined}>
          <ul className="comparison-grid">
            {catalog.icons.map((name) => <ComparisonTile key={name} name={name}
              soft={softSelections.includes(name)} onChange={(soft) => selectArtwork(name, soft)} />)}
          </ul>
        </GallerySection>
      ))}
      <GallerySection id="brands" title="Brand marks" count={Object.keys(BRAND_ICONS).length}
        description="Original artwork stays unchanged; brand marks are not redraw candidates.">
        <ul className="icon-grid">
          {Object.keys(BRAND_ICONS).sort().map((name) => <IconTile key={name} name={name}><Icon name={name} /></IconTile>)}
        </ul>
      </GallerySection>
      <GallerySection id="providers" title="LLM provider logos" count={PROVIDERS.length}
        description="Original local brand artwork, displayed through the shared provider component.">
        <ul className="icon-grid">
          {PROVIDERS.map((provider) => <IconTile key={provider} name={provider}><LLMProviderIcon provider={provider} /></IconTile>)}
        </ul>
      </GallerySection>
      <GallerySection id="custom" title="Custom artwork" count={2}>
        <ul className="icon-grid">
          <IconTile name="Thought"><ThoughtIcon /></IconTile>
          <IconTile name="Leon"><img src={getPublicAssetPath(`img/logo-for-${theme}-bg.svg`)} alt="" /></IconTile>
        </ul>
      </GallerySection>
      <GallerySection id="gestures" title="Soft B gesture studies" count={MENU.length}
        description="Animation studies only, independent of your choices above. Hover or focus an item to play its gesture once.">
        <nav className="gesture-grid" aria-label="Animated sidebar icons">
          {MENU.map((item) => <MenuItem key={item.name} iconName={item.name} label={item.label} />)}
        </nav>
      </GallerySection>
      <GallerySection id="morphs" title="Applied state morphs" count={Object.keys(ICON_MORPHS).length}
        description="These pairs use the artwork currently applied in the app, independently of draft choices above. Click the large icon or press Enter to explore each state change.">
        <div className="morph-grid">
          {Object.entries(ICON_MORPHS).map(([family, frames]) => <MorphCard key={family} family={family} frames={frames} />)}
        </div>
      </GallerySection>
      <footer>
        <p>Original shapes come directly from the installed Remix Icon SVGs, not the font. Only this preview imports the comparison artwork.</p>
        <p>All artwork is local. Brand marks retain their original appearance and licenses. Animation respects your reduced-motion preference.</p>
      </footer>
    </main>
  )
}

const root = createRoot(document.querySelector('#icon-preview')!)
root.render(<ToastProvider><IconPreview /></ToastProvider>)

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount())
}
