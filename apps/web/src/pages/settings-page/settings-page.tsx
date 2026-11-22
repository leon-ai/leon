import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from '@tanstack/react-router'

import { SETTINGS_SECTIONS } from '@/data/settings-sections'
import { Icon } from '@/components/icon'
import { Input } from '@/components/input'
import { ScrollList } from '@/components/scroll-list'
import { Loader } from '@/components/loader'
import { Shortcut } from '@/components/shortcut'
import { useProfile } from '@/data/profile'
import type { DialogView } from '@/layout/app-layout/dialog-navigation'
import { getListNavigationIndex } from '@/utils/list-navigation'
import { createSearchIndex, searchIndex } from '@/utils/search'

import { AppearanceSettings } from './appearance-settings'
import { GeneralSettings } from './general-settings'
import { SettingSection } from './setting-section'
import '@/layout/sidebar/menu-item/menu-item.sass'
import './settings-page.sass'

const ToolsConnections = lazy(() => import('./tools-connections'))
const PrivacySettings = lazy(() => import('./privacy-settings').then(({ PrivacySettings }) => ({ default: PrivacySettings })))
const SkillsSettings = lazy(() => import('./skills-settings'))
const MAX_SEARCH_RESULTS = 8

const searchTargets = SETTINGS_SECTIONS.flatMap((category) => [
  { category, target: undefined },
  ...category.targets.map((target) => ({ category, target }))
])
const settingsIndex = createSearchIndex(searchTargets, ({ category, target }) => target
  ? [target.label, ...target.aliases, `${category.label} ${target.label}`]
  : [category.label, ...category.aliases])

type SettingsView = Extract<DialogView, { kind: 'settings' }>

/**
 * Searches categories and mounted settings sections through one route catalog.
 */
export function SettingsPage({ view, open }: { view: SettingsView, open: (view: SettingsView) => void }) {
  const { section, target } = view
  const category = SETTINGS_SECTIONS.find((entry) => entry.id === section)
  const profile = useProfile()
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const content = useRef<HTMLElement>(null)
  const resultsId = useId()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(-1)
  const results = query.trim() ? searchIndex(settingsIndex, query).slice(0, MAX_SEARCH_RESULTS) : []
  const visible = expanded && results.length > 0

  useEffect(() => {
    const panel = content.current
    if (!target) {
      panel?.scrollTo({ top: 0 })
      return
    }
    const item = document.getElementById(`settings-${target}`)
    if (item && panel?.contains(item)) {
      // Scroll the settings pane independently of the dialog around it.
      item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [section, target])

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent): void {
      if (event.key !== '/' || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }
      const field = input.current
      const focus = document.activeElement
      const overlays = document.querySelectorAll('.dialog-overlay-open')
      // Clicking dialog whitespace can leave focus on the body. Only the
      // topmost dialog claims the shortcut, including when focus has no control.
      if (!field || focus === field || !overlays.item(overlays.length - 1)?.contains(field)) {
        return
      }
      if (focus instanceof HTMLElement && (focus.isContentEditable || focus.matches('input, textarea, select'))) {
        return
      }
      event.preventDefault()
      field.focus({ preventScroll: true })
    }

    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  if (!category) {
    return null
  }

  function select(result: (typeof searchTargets)[number]): void {
    setQuery('')
    setExpanded(false)
    setActive(-1)
    open({ kind: 'settings', section: result.category.id, ...(result.target ? { target: result.target.id } : {}) })
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.key === 'Escape' && visible) {
      event.preventDefault()
      event.stopPropagation()
      setExpanded(false)
      return
    }
    if (event.key === 'Enter' && visible) {
      event.preventDefault()
      const result = results[active < 0 ? 0 : active]
      if (result) {
        select(result.item)
      }
      return
    }
    if (results.length > 0) {
      const next = getListNavigationIndex(event, { count: results.length, currentIndex: active, loop: true })
      if (next !== undefined) {
        event.preventDefault()
        setExpanded(true)
        setActive(next)
      }
    }
  }

  return <div className="settings-layout">
    <div className="settings-sidebar">
      <div className="settings-search">
        <div className="settings-search-field">
          <Input autoFocus fieldRef={input} iconName="search" type="search" ariaLabel="Search settings"
            placeholder="Search settings" role="combobox" aria-autocomplete="list"
            aria-keyshortcuts="/" aria-expanded={visible} aria-controls={visible ? resultsId : undefined}
            aria-activedescendant={visible && active >= 0 ? `${resultsId}-${active}` : undefined}
            value={query} onKeyDown={handleSearchKey} onFocus={() => setExpanded(true)}
            onBlur={() => setExpanded(false)} onChange={(event) => {
              setQuery(event.currentTarget.value)
              setExpanded(true)
              setActive(-1)
            }} />
          <Shortcut keys={['/']} variant="inset" />
        </div>
        {visible && <ul className="settings-search-results" role="listbox" id={resultsId} aria-label="Matching settings">
          {results.map(({ item }, index) => <li key={`${item.category.id}/${item.target?.id ?? ''}`}
            id={`${resultsId}-${index}`} role="option" aria-selected={active === index}
            onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}>
            <Icon name={item.category.icon} />
            <span>{item.target?.label ?? item.category.label}
              {item.target && <small>{item.category.label}</small>}
            </span>
          </li>)}
        </ul>}
        {expanded && query.trim() && results.length === 0 && <div className="settings-search-empty" role="status">No matching settings.</div>}
      </div>
      <ScrollList className="settings-navigation" aria-label="Settings navigation">
        <nav aria-label="Settings">{SETTINGS_SECTIONS.map((entry) => <Link key={entry.id}
          to="/settings/$section" params={{ section: entry.id }}
          className={`menu-item${section === entry.id ? ' menu-item-active' : ''}`}
          aria-current={section === entry.id ? 'page' : undefined}
          onClick={(event) => {
            if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
              event.preventDefault()
              select({ category: entry, target: undefined })
            }
          }}>
          <Icon name={entry.icon} className="menu-item-icon" /><span className="menu-item-label">{entry.label}</span>
        </Link>)}</nav>
      </ScrollList>
    </div>
    <section ref={content} className="settings-content" aria-label={category.label} data-target={target}>
      {section === 'tools' ? <SettingSection title="Tool catalog" id="settings-tool-catalog"><Suspense fallback={<Loader size="md" label="Getting your tools ready…" />}><ToolsConnections key={profile} /></Suspense></SettingSection> :
        section === 'skills' ? <SettingSection title="Skill catalog" id="settings-skill-catalog"><Suspense fallback={<Loader size="md" label="Getting your skills ready…" />}><SkillsSettings key={profile} /></Suspense></SettingSection> :
        section === 'privacy' ? <div id="settings-usage-sharing"><Suspense fallback={<Loader size="md" label="Opening privacy settings…" />}><PrivacySettings key={profile} /></Suspense></div> :
        section === 'general' ? <GeneralSettings /> :
        section === 'appearance' ? <AppearanceSettings /> : <p className="settings-placeholder">This section is being prepared. Your current preferences haven’t changed.</p>}
    </section>
  </div>
}
