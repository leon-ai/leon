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
const Insights = lazy(() => import('@/pages/insights-page/insights-page').then(({ Insights }) => ({ default: Insights })))

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
        }}
        onInsights={() => openDialog({ kind: 'insights', tab: 'overview' })} />
      <main className="app-main">
        {previewOnly ? <PageContainer><Outlet /></PageContainer> : <ProfileAccessGate>
          <PageContainer inert={Boolean(dialog)}><Outlet /></PageContainer>
          {dialog && <Dialog title={dialog.kind === 'settings' ? 'Settings' : 'Insights'} onClose={close}
            open centered size="wide" hideFooter className={`routed-dialog routed-dialog-${dialog.kind}`}>
            <Suspense fallback={<Loader size="md" label={dialog.kind === 'settings' ? 'Opening settings…' : 'Opening insights…'} />}>
              {dialog.kind === 'settings'
                ? <SettingsPage view={dialog} open={open} />
                : <Insights tab={dialog.tab} selectTab={(tab) => open({ kind: 'insights', tab })} />}
            </Suspense>
          </Dialog>}
        </ProfileAccessGate>}
      </main>
    </div>
  )
}
