import { Outlet, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useRef } from 'react'

import { Vibes } from '@/components/vibes'
import { Dialog } from '@/components/dialog'
import { Loader } from '@/components/loader'
import { PageContainer } from '@/layout/page-container'
import { Sidebar } from '@/layout/sidebar'
import { useAmbientConditions } from '@/data/ambient-conditions'
import { ProfileAccessGate, ProfileBoundary } from '@/data/profile'
import { ConversationConnection } from '@/data/conversation-connection'
import { restoreOverlayFocus } from '@/utils/overlay-focus'
import { DEFAULT_SETTINGS_CATEGORY, useDialogNavigation, type DialogView } from './dialog-navigation'
import {
  getVibesPreviewConfiguration,
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from '@/pages/vibes-preview-page/vibes-preview-search'

import './app-layout.sass'

const SettingsPage = lazy(() => import('@/pages/settings-page/settings-page').then(({ SettingsPage }) => ({ default: SettingsPage })))

export function AppLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  if (import.meta.env.DEV && pathname === VIBES_PREVIEW_PATH) {
    return <AuthenticatedAppLayout previewOnly />
  }

  return <ProfileBoundary><AuthenticatedAppLayout /></ProfileBoundary>
}

function AuthenticatedAppLayout({ previewOnly = false }: { previewOnly?: boolean }) {
  const location = useRouterState({
    select: (state) => state.location
  })
  const previewConfiguration = import.meta.env.DEV &&
    location.pathname === VIBES_PREVIEW_PATH
    ? getVibesPreviewConfiguration(parseVibesPreviewSearch(location.search))
    : undefined
  const { data: ambientConditions, isError: isAmbientUnavailable } = useAmbientConditions(
    previewConfiguration === undefined
  )
  const vibeEnvironment = previewConfiguration?.environment ??
    (ambientConditions === undefined || isAmbientUnavailable
      ? undefined
      : {
          season: ambientConditions.season,
          solarPhase: ambientConditions.solarPhase,
          weather: ambientConditions.weather?.condition ?? 'clear'
        })
  const { view, open, close } = useDialogNavigation()
  const dialog = previewOnly ? undefined : view
  const returnFocus = useRef<HTMLElement | null>(null)

  function openDialog(next: DialogView): void {
    if (!view && document.activeElement instanceof HTMLElement) {
      returnFocus.current = document.activeElement
    }
    open(next)
  }

  useEffect(() => {
    if (!dialog && returnFocus.current) {
      const element = returnFocus.current
      returnFocus.current = null
      restoreOverlayFocus(element)
    }
  }, [dialog])

  return (
    <div className="app-layout">
      {!previewOnly && <ConversationConnection />}
      <Vibes
        animateTransitions={previewConfiguration === undefined}
        {...(vibeEnvironment === undefined
          ? {}
          : { environment: vibeEnvironment })}
      />
      <Sidebar inert={Boolean(dialog)}
        onSettings={() => {
          if (dialog?.kind !== 'settings') {
            openDialog({ kind: 'settings', section: DEFAULT_SETTINGS_CATEGORY })
          }
        }} />
      <main className="app-main">
        {previewOnly ? <PageContainer><Outlet /></PageContainer> : <ProfileAccessGate>
          <PageContainer inert={Boolean(dialog)}><Outlet /></PageContainer>
          {dialog && <Dialog title="Settings" onClose={close}
            open centered size="wide" hideFooter className="routed-dialog routed-dialog-settings">
            <Suspense fallback={<Loader size="md" label="Opening settings…" />}>
              <SettingsPage view={dialog} open={open} />
            </Suspense>
          </Dialog>}
        </ProfileAccessGate>}
      </main>
    </div>
  )
}
