import { Outlet, useRouterState } from '@tanstack/react-router'

import { Vibes } from '@/components/vibes'
import { PageContainer } from '@/layout/page-container'
import { Sidebar } from '@/layout/sidebar'
import { useAmbientConditions } from '@/data/ambient-conditions'
import {
  getVibesPreviewConfiguration,
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from '@/pages/vibes-preview-page/vibes-preview-search'

import './app-layout.sass'

export function AppLayout() {
  const location = useRouterState({
    select: (state) => state.location
  })
  const previewConfiguration = import.meta.env.DEV &&
    location.pathname === VIBES_PREVIEW_PATH
    ? getVibesPreviewConfiguration(parseVibesPreviewSearch(location.search))
    : undefined
  const {
    data: ambientConditions,
    isFetched: hasFetchedAmbientConditions
  } = useAmbientConditions(previewConfiguration === undefined)
  const vibeEnvironment = previewConfiguration?.environment ??
    (ambientConditions === undefined
      ? undefined
      : {
          season: ambientConditions.season,
          solarPhase: ambientConditions.solarPhase,
          weather: ambientConditions.weather?.condition ?? 'clear'
        })
  const shouldRenderVibes = previewConfiguration !== undefined ||
    ambientConditions !== undefined ||
    hasFetchedAmbientConditions

  return (
    <div className="app-layout">
      {/* Only the initial ambient request should delay the scene. */}
      {shouldRenderVibes && (
        <Vibes
          animateTransitions={previewConfiguration === undefined}
          {...(vibeEnvironment === undefined
            ? {}
            : { environment: vibeEnvironment })}
        />
      )}
      <Sidebar />
      <main className="app-main">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </main>
    </div>
  )
}
