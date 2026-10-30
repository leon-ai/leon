import { Outlet, useRouterState } from '@tanstack/react-router'

import { Vibes } from '@/components/vibes'
import { PageContainer } from '@/layout/page-container'
import { Sidebar } from '@/layout/sidebar'
import { useAmbientConditions } from '@/data/ambient-conditions'
import { ProfileAccessGate, ProfileBoundary } from '@/data/profile'
import {
  getVibesPreviewConfiguration,
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from '@/pages/vibes-preview-page/vibes-preview-search'

import './app-layout.sass'

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
  const { data: ambientConditions } = useAmbientConditions(
    previewConfiguration === undefined
  )
  const vibeEnvironment = previewConfiguration?.environment ??
    (ambientConditions === undefined
      ? undefined
      : {
          season: ambientConditions.season,
          solarPhase: ambientConditions.solarPhase,
          weather: ambientConditions.weather?.condition ?? 'clear'
        })
  return (
    <div className="app-layout">
      <Vibes
        animateTransitions={previewConfiguration === undefined}
        {...(vibeEnvironment === undefined
          ? {}
          : { environment: vibeEnvironment })}
      />
      <Sidebar />
      <main className="app-main">
        <PageContainer>
          {previewOnly ? <Outlet /> : <ProfileAccessGate><Outlet /></ProfileAccessGate>}
        </PageContainer>
      </main>
    </div>
  )
}
