import { useEffect, useRef, useState, type TransitionEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { clsx } from 'clsx'

import './sidebar.sass'
import { Button } from '../../components/button'
import { Dialog } from '../../components/dialog'
import { SearchSessionsDialog } from '../../components/search-sessions-dialog'
import {
  getStoredSidebarExpanded,
  getStoredSoundsEnabled,
  getStoredTheme,
  saveSidebarExpanded,
  saveSoundsEnabled,
  saveTheme,
  type Theme
} from '../../theme'

import { Logo } from './logo'
import { Menu } from './menu'
import { SessionList } from './session-list'
import { SidebarFooter } from './sidebar-footer'

const DARK_THEME_LOGO_SRC = '/img/logo-for-dark-bg-text.svg'
const LIGHT_THEME_LOGO_SRC = '/img/logo-for-light-bg-text.svg'
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

function shouldReduceMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
}

export function Sidebar() {
  const navigate = useNavigate()
  const sidebarScrollAreaRef = useRef<HTMLDivElement>(null)
  const [soundsEnabled, setSoundsEnabled] = useState(getStoredSoundsEnabled)
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredSidebarExpanded)
  const [sidebarContentCollapsed, setSidebarContentCollapsed] = useState(
    () => !getStoredSidebarExpanded()
  )
  const [sidebarClosing, setSidebarClosing] = useState(false)
  const [sidebarScrollAreaScrolled, setSidebarScrollAreaScrolled] =
    useState(false)
  const [searchSessionsDialogOpen, setSearchSessionsDialogOpen] =
    useState(false)

  function toggleTheme(): void {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'

    setTheme(nextTheme)
    saveTheme(nextTheme)
  }

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

    setSidebarScrollAreaScrolled(scrollArea.scrollTop > 0)
  }

  function openSearchSessionsDialog(): void {
    setSearchSessionsDialogOpen(true)
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
            iconName={theme === 'dark' ? 'moon' : 'sun'}
            tone="muted"
            tooltipMessage={theme === 'dark' ? 'Apply light theme' : 'Apply dark theme'}
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
      />
      <div
        className={clsx('sidebar-scroll-area', {
          'sidebar-scroll-area-scrolled': sidebarScrollAreaScrolled
        })}
        ref={sidebarScrollAreaRef}
        onScroll={handleSidebarScroll}
      >
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
            variant: 'primary',
            onClick: () => setSearchSessionsDialogOpen(false)
          }
        ]}
        onClose={() => setSearchSessionsDialogOpen(false)}
      >
        <SearchSessionsDialog
          onSessionSelect={() => setSearchSessionsDialogOpen(false)}
        />
      </Dialog>
    </aside>
  )
}
