import { useEffect, useRef, useState, type TransitionEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { clsx } from 'clsx'

import './sidebar.sass'
import { getPublicAssetPath } from '@/config'
import { Button } from '@/components/button'
import { Dialog } from '@/components/dialog'
import { Loader } from '@/components/loader'
import { prefetchModule } from '@/utils/prefetch'
import { useToast } from '@/components/toast'
import { useTheme } from '@/hooks/use-theme'
import { loadImage } from '@/utils/load-image'
import {
  getStoredSidebarExpanded,
  getStoredSoundsEnabled,
  saveSidebarExpanded,
  saveSoundsEnabled,
  registerThemePreparation,
  toggleTheme
} from '@/theme'

import { Logo } from './logo'
import { Menu } from './menu'
import { SessionList } from './session-list'
import { SidebarFooter } from './sidebar-footer'

const DARK_THEME_LOGO_SRC = getPublicAssetPath('img/logo-for-dark-bg-text.svg')
const LIGHT_THEME_LOGO_SRC = getPublicAssetPath(
  'img/logo-for-light-bg-text.svg'
)
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SCROLL_MASK_FADE_DISTANCE_PX = 54
type SearchModule = typeof import('@/components/search-sessions-dialog')
// Warmed dialogs render immediately; failed imports remain retryable on demand.
let searchModule: SearchModule | undefined
let searchRequest: Promise<SearchModule> | undefined

function loadSearchSessions(): Promise<SearchModule> {
  searchRequest ??= import('@/components/search-sessions-dialog').then((module) => {
    searchModule = module
    return module
  }).catch((error: unknown) => {
    searchRequest = undefined
    throw error
  })

  return searchRequest
}

function DeferredSearchSessions({ onSessionSelect }: { onSessionSelect: () => void }) {
  const [content, setContent] = useState(() => searchModule)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { showToast } = useToast()
  useEffect(() => {
    let cancelled = false
    void loadSearchSessions().then((module) => {
      if (!cancelled) {
        setContent(module)
      }
    }).catch(() => {
      if (!cancelled) {
        setFailed(true)
        showToast({ type: 'error', title: 'Could not load search', description: 'Check your network connection and try again.' })
      }
    })

    return () => {
      cancelled = true
    }
  }, [attempt, showToast])

  if (content) {
    return <content.SearchSessionsDialog onSessionSelect={onSessionSelect} />
  }
  if (failed) {
    return <Button onClick={() => {
      setFailed(false)
      setAttempt((value) => value + 1)
    }}>Retry loading search</Button>
  }

  return <Loader size="sm" label="Loading search…" />
}

function shouldReduceMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
}

export function Sidebar() {
  const navigate = useNavigate()
  const sidebarScrollAreaRef = useRef<HTMLDivElement>(null)
  const searchReturnFocusRef = useRef<HTMLElement | null>(null)
  const [soundsEnabled, setSoundsEnabled] = useState(getStoredSoundsEnabled)
  const theme = useTheme()
  const requestedTheme = useTheme({ includeRequested: true })
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredSidebarExpanded)
  const [sidebarContentCollapsed, setSidebarContentCollapsed] = useState(
    () => !getStoredSidebarExpanded()
  )
  const [sidebarClosing, setSidebarClosing] = useState(false)
  const [sidebarScrollAreaScrolled, setSidebarScrollAreaScrolled] =
    useState(false)
  const [searchSessionsDialogOpen, setSearchSessionsDialogOpen] =
    useState(false)

  useEffect(() => registerThemePreparation(async (nextTheme) => {
    await loadImage(
      nextTheme === 'dark' ? DARK_THEME_LOGO_SRC : LIGHT_THEME_LOGO_SRC,
      'high'
    )
  }), [])

  function updateSoundsEnabled(nextSoundsEnabled: boolean): void {
    setSoundsEnabled(nextSoundsEnabled)
    saveSoundsEnabled(nextSoundsEnabled)
  }

  function updateSidebarExpanded(nextSidebarExpanded: boolean): void {
    if (nextSidebarExpanded) {
      setSidebarClosing(false)
      setSidebarContentCollapsed(false)
      setSidebarExpanded(true)
      saveSidebarExpanded(true)
      return
    }

    setSidebarClosing(true)
    setSidebarExpanded(nextSidebarExpanded)
    saveSidebarExpanded(nextSidebarExpanded)

    if (shouldReduceMotion()) {
      setSidebarContentCollapsed(true)
      setSidebarClosing(false)
    }
  }

  function handleSidebarTransitionEnd(
    event: TransitionEvent<HTMLElement>
  ): void {
    if (
      event.propertyName !== 'width' ||
      sidebarExpanded
    ) {
      return
    }

    setSidebarContentCollapsed(true)
    setSidebarClosing(false)
  }

  function handleSidebarScroll(): void {
    const scrollArea = sidebarScrollAreaRef.current

    if (scrollArea === null) {
      return
    }

    const scrollTop = Math.max(0, scrollArea.scrollTop)
    const maskOpacity = Math.min(
      scrollTop / SCROLL_MASK_FADE_DISTANCE_PX,
      1
    )

    scrollArea.style.setProperty(
      '--sidebar-scroll-area-mask-opacity',
      String(maskOpacity)
    )
    setSidebarScrollAreaScrolled(scrollTop > 0)
  }

  function openSearchSessionsDialog(): void {
    if (!searchReturnFocusRef.current) {
      searchReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setSearchSessionsDialogOpen(true)
  }

  function closeSearchSessionsDialog(): void {
    setSearchSessionsDialogOpen(false)
    if (searchReturnFocusRef.current?.isConnected) {
      searchReturnFocusRef.current.focus({ preventScroll: true })
    }
    searchReturnFocusRef.current = null
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const modifierKeyPressed = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (
        event.repeat ||
        event.altKey ||
        !modifierKeyPressed
      ) {
        return
      }

      if (event.shiftKey && key === 'o') {
        event.preventDefault()
        searchReturnFocusRef.current = null
        setSearchSessionsDialogOpen(false)
        void navigate({ to: '/' })
        return
      }

      if (
        event.shiftKey ||
        key !== 'k'
      ) {
        return
      }

      event.preventDefault()
      openSearchSessionsDialog()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [navigate])

  const logoSrc = theme === 'dark' ? DARK_THEME_LOGO_SRC : LIGHT_THEME_LOGO_SRC

  return (
    <aside className={clsx(
      'sidebar',
      sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed',
      {
        'sidebar-closing': sidebarClosing,
        'sidebar-content-collapsed': sidebarContentCollapsed
      }
    )}
    onTransitionEnd={handleSidebarTransitionEnd}>
      <header className="sidebar-header">
        <div className="sidebar-logo-slot">
          <Logo
            src={logoSrc}
            width={96}
            height={36}
          />
          <div className="sidebar-logo-open-button">
            <Button
              iconName="sidebar-unfold"
              tone="muted"
              tooltipMessage="Open sidebar"
              tooltipPosition="right"
              onClick={() => updateSidebarExpanded(true)}
            />
          </div>
        </div>
        <div className="sidebar-controls">
          <Button
            iconName={soundsEnabled ? 'volume-up' : 'volume-mute'}
            tone="muted"
            tooltipMessage={soundsEnabled ? 'Mute sounds' : 'Unmute sounds'}
            onClick={() => updateSoundsEnabled(!soundsEnabled)}
          />
          <Button
            className="sidebar-theme-toggle"
            iconName={requestedTheme === 'dark' ? 'moon' : 'sun'}
            tone="muted"
            tooltipMessage={requestedTheme === 'dark' ? 'Apply light theme' : 'Apply dark theme'}
            onClick={toggleTheme}
          />
          <Button
            iconName={sidebarExpanded ? 'sidebar-fold' : 'sidebar-unfold'}
            tone="muted"
            tooltipMessage={sidebarExpanded ? 'Close sidebar' : 'Open sidebar'}
            onClick={() => updateSidebarExpanded(!sidebarExpanded)}
          />
        </div>
      </header>
      <Menu
        collapsed={sidebarContentCollapsed}
        variant="fixed"
        onSearchSessions={openSearchSessionsDialog}
        onSearchIntent={() => prefetchModule(loadSearchSessions)}
      />
      <div
        className={clsx('sidebar-scroll-area', {
          'sidebar-scroll-area-scrolled': sidebarScrollAreaScrolled
        })}
        ref={sidebarScrollAreaRef}
        onScroll={handleSidebarScroll}
      >
        <div className="sidebar-scroll-area-mask" aria-hidden="true" />
        <Menu collapsed={sidebarContentCollapsed} variant="scrollable" />
        <SessionList
          collapsed={sidebarContentCollapsed}
          scrollElementRef={sidebarScrollAreaRef}
        />
      </div>
      <button
        type="button"
        className="sidebar-collapsed-unfold-hit"
        aria-label="Open sidebar"
        onClick={() => updateSidebarExpanded(true)}
      />
      <SidebarFooter />
      <Dialog
        hideHeader
        open={searchSessionsDialogOpen}
        title="Search sessions"
        size="large"
        actions={[
          {
            label: 'Close',
            variant: 'secondary',
            onClick: closeSearchSessionsDialog
          }
        ]}
        onClose={closeSearchSessionsDialog}
      >
        <DeferredSearchSessions
          onSessionSelect={() => {
            searchReturnFocusRef.current = null
            setSearchSessionsDialogOpen(false)
          }}
        />
      </Dialog>
    </aside>
  )
}
