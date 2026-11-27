import { useLocation, useMatchRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { isSettingsPath } from '@/data/settings-sections'

export const INSIGHTS_TABS = ['overview', 'context-window', 'repeated-queries', 'pulse', 'evaluations'] as const
export type InsightsTab = (typeof INSIGHTS_TABS)[number]
export const DEFAULT_SETTINGS_CATEGORY = 'general'

export type DialogView =
  | { kind: 'settings', section: string, target?: string }
  | { kind: 'insights', tab: InsightsTab }

/**
 * Only registered Insights tabs can open a dialog from a shared URL.
 */
export function isInsightsTab(tab: string): tab is InsightsTab {
  return INSIGHTS_TABS.includes(tab as InsightsTab)
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    leonDialog?: { view: DialogView, backgroundKey?: string }
  }
}

/**
 * Maps a shareable dialog path to its selected content. An in-app mask
 * preserves the real conversation route until the owner closes the dialog.
 */
export function useDialogNavigation(): {
  view: DialogView | undefined
  open: (next: DialogView) => void
  close: () => void
} {
  const router = useRouter()
  const closing = useRef(false)
  const location = useLocation()
  const match = useMatchRoute()
  const masked = location.state.leonDialog
  const settingTarget = match({ to: '/settings/$section/$target', fuzzy: false })
  const settingSection = match({ to: '/settings/$section', fuzzy: false })
  const insightsTab = match({ to: '/insights/$tab', fuzzy: false })
  const directSettings = settingTarget || settingSection || match({ to: '/settings', fuzzy: false })
  let view: DialogView | undefined = masked?.view

  if (!view && directSettings) {
    const section = settingTarget ? settingTarget.section : settingSection ? settingSection.section : DEFAULT_SETTINGS_CATEGORY
    const target = settingTarget ? settingTarget.target : undefined
    if (isSettingsPath(section, target)) {
      view = { kind: 'settings', section, ...(target ? { target } : {}) }
    }
  } else if (!view && (insightsTab || match({ to: '/insights', fuzzy: false }))) {
    const tab = insightsTab ? insightsTab.tab : 'overview'
    if (isInsightsTab(tab)) {
      view = { kind: 'insights', tab }
    }
  }
  const isOpen = Boolean(view)
  useEffect(() => {
    if (!isOpen) {
      closing.current = false
    }
  }, [isOpen])

  async function navigateTo(next: DialogView): Promise<void> {
    const target = next.kind === 'insights'
      ? { to: '/insights/$tab' as const, params: { tab: next.tab } }
      : next.target
        ? { to: '/settings/$section/$target' as const, params: { section: next.section, target: next.target } }
        : { to: '/settings/$section' as const, params: { section: next.section } }
    const replace = view !== undefined
    const session = match({ to: '/session/$sessionId', fuzzy: false })
    const root = match({ to: '/', fuzzy: false })

    if (session || root) {
      const backgroundKey = masked?.backgroundKey ?? location.state['__TSR_key']
      const state = { leonDialog: { view: next, ...(backgroundKey ? { backgroundKey } : {}) } }
      const mask = { ...target, unmaskOnReload: true }
      if (session) {
        await router.navigate({ to: '/session/$sessionId', params: session, replace, state, mask, resetScroll: false })
      } else {
        const workspace = location.search['workspace']
        await router.navigate({ to: '/', search: typeof workspace === 'string' ? { workspace } : {},
          replace, state, mask, resetScroll: false })
      }
    } else {
      await router.navigate({ ...target, replace, resetScroll: false })
    }
  }

  function close(): void {
    if (closing.current) {
      return
    }
    closing.current = true
    if (masked && router.history.canGoBack()) {
      const current = masked.view
      const initial: DialogView = current.kind === 'settings'
        ? { kind: 'settings', section: DEFAULT_SETTINGS_CATEGORY }
        : { kind: 'insights', tab: 'overview' }
      const alreadyInitial = current.kind === 'settings'
        ? current.section === DEFAULT_SETTINGS_CATEGORY && !current.target
        : current.tab === 'overview'
      // Keep the background entry intact and clear the deep dialog route so
      // Forward after an explicit dismissal opens a fresh dialog too.
      if (alreadyInitial) {
        router.history.back()
      } else {
        void navigateTo(initial).finally(() => {
          if (router.state.location.state.leonDialog) {
            router.history.back()
          }
        })
      }
    } else {
      void router.navigate({ to: '/', replace: true })
    }
  }

  return { view, open: (next) => void navigateTo(next), close }
}
