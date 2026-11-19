import { useMemo, useState, type CSSProperties } from 'react'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { Icon } from '@/components/icon'
import { LLMProviderIcon } from '@/components/llm-provider-icon'
import { ThoughtIcon } from '@/components/thought-icon'
import { useTheme } from '@/hooks/use-theme'
import { getPublicAssetPath } from '@/config'
import { COMMON_ICONS, ICON_ALIASES, ICON_VARIANT_ARTWORK, TOOL_ICON_NAMES } from '@/components/icon/icon-definitions'
import { ASSET_ICONS } from '@/components/icon/asset-icons'
import { ICON_MORPHS, type MorphFrames } from '@/components/icon/icon-morphs'
import { MorphPaths } from '@/components/icon/morph-paths'
import { MenuItem } from '@/layout/sidebar/menu-item'
import { createSearchIndex, searchIndex } from '@/utils/search'

import './icons-preview.sass'

const PROVIDERS = Object.keys(import.meta.glob('../../../../apps/web/public/img/providers/*.svg'))
  .map((file) => file.slice(file.lastIndexOf('/') + 1, -'.svg'.length)).sort()
const PACKAGE_LOGOS = Object.entries(import.meta.glob<string>('../../../../tools/*/*/logo.svg', {
  eager: true, query: '?url&no-inline', import: 'default'
})).map(([file, src]) => ({ name: file.split('/').slice(-3, -1).join('/'), src }))
  .sort((left, right) => left.name.localeCompare(right.name))
const PAGE_SIZE = 80
const ICON_SIZES = [16, 20, 24, 32]
const ICON_NAMES = [...new Set([
  ...Object.keys(COMMON_ICONS), ...Object.keys(ICON_ALIASES), ...Object.keys(ICON_VARIANT_ARTWORK),
  ...TOOL_ICON_NAMES, ...Object.keys(ASSET_ICONS)
])].sort().map((name) => ({ name }))
const INDEX = createSearchIndex(ICON_NAMES, (item) => [item.name])
const MORPH_LABELS: Readonly<Record<string, string>> = {
  folder: 'Workspace folder', theme: 'Theme', sound: 'Sounds', sidebar: 'Sidebar',
  composer: 'Send and stop', pin: 'Pinning', copy: 'Copy confirmation'
}

function StatePreview({ name, frames }: { name: string, frames: MorphFrames }) {
  const states = Object.keys(frames)
  const [index, setIndex] = useState(0)
  const label = MORPH_LABELS[name] ?? name

  return <article className="gallery-example" aria-label={label} data-preview-morph={name}>
    <h3>{label}</h3>
    <div className="icons-state-endpoints">{states.map((state) => <span key={state}>
      <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <MorphPaths frames={frames} state={state} />
      </svg><span>{state}</span>
    </span>)}</div>
    <Button ariaLabel={`Toggle ${label.toLowerCase()} preview`} ariaPressed={index > 0}
      onClick={() => setIndex((value) => (value + 1) % states.length)}
      icon={<svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <MorphPaths frames={frames} state={states[index]!} />
      </svg>} />
  </article>
}

/**
 * Reviews the application's actual icon registry and morphs within Aurora.
 * Paging bounds local assets and SVG nodes even as the catalog grows.
 */
export default function IconsPreview() {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(24)
  const results = useMemo(() => searchIndex(INDEX, query), [query])
  const visible = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return <section className="aurora-icons-preview" aria-label="Icons preview"
    style={{ '--preview-icon-size': `${size}px` } as CSSProperties}>
    <div className="aurora-actions">
      <Input ariaLabel="Find an icon" type="search" iconName="search" placeholder="Find an icon…" value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setPage(0)
        }} />
      {ICON_SIZES.map((value) => <Button key={value} ariaPressed={size === value} onClick={() => setSize(value)}>{value}px</Button>)}
    </div>
    <p className="gallery-notice">The same local artwork used by Leon, including custom rounded icons and explicit line and fill variants.</p>
    <ul className="icons-grid">{visible.map(({ item }) => <li key={item.name} data-preview-icon={item.name}>
      <Icon name={item.name} /><span>{item.name}</span>
    </li>)}</ul>
    <div className="aurora-actions">
      <Button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous icons</Button>
      <span role="status">{results.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, results.length)} of ${results.length}` : 'No matching icons'}</span>
      <Button disabled={(page + 1) * PAGE_SIZE >= results.length} onClick={() => setPage((value) => value + 1)}>Next icons</Button>
    </div>
    <h2>Provider logos</h2>
    <ul className="icons-grid">{PROVIDERS.map((provider) => <li key={provider}>
      <LLMProviderIcon provider={provider} /><span>{provider}</span>
    </li>)}</ul>
    <h2>Catalog logos</h2>
    <ul className="icons-grid">{PACKAGE_LOGOS.map(({ name, src }) => <li key={name}>
      <img src={src} alt={`${name} logo`} loading="lazy" decoding="async" /><span>{name}</span>
    </li>)}</ul>
    <h2>Custom artwork</h2>
    <ul className="icons-grid">
      <li><ThoughtIcon /><span>Thought</span></li>
      <li><img src={getPublicAssetPath(`img/logo-for-${theme}-bg.svg`)} alt="Leon" /><span>Leon</span></li>
    </ul>
    <h2>Menu gestures</h2>
    <nav className="icons-menu-gestures" aria-label="Animated sidebar icons">
      <MenuItem iconName="edit-box" label="New session" />
      <MenuItem iconName="search" label="Search sessions" />
      <MenuItem iconName="inbox-2" label="Inbox" />
    </nav>
    <h2>State morphs</h2>
    <div className="gallery-grid">{Object.entries(ICON_MORPHS).map(([name, frames]) =>
      <StatePreview key={name} name={name} frames={frames} />)}</div>
  </section>
}
