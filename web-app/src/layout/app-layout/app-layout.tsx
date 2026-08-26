import { Outlet, useRouterState } from '@tanstack/react-router'

import { Vibes } from '../../components/vibes'
import { PageContainer } from '../page-container'
import { Sidebar } from '../sidebar'
import {
  getVibesPreviewConfiguration,
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from '../../pages/vibes-preview-page/vibes-preview-search'

import './app-layout.sass'

export function AppLayout() {
  const location = useRouterState({
    select: (state) => state.location
  })
  const previewConfiguration = import.meta.env.DEV &&
    location.pathname === VIBES_PREVIEW_PATH
    ? getVibesPreviewConfiguration(parseVibesPreviewSearch(location.search))
    : undefined

  return (
    <div className="app-layout">
      <Vibes {...(previewConfiguration === undefined ? {} : {
        environment: previewConfiguration.environment,
        interior: previewConfiguration.interior
      })} />
      <Sidebar />
      <main className="app-main">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </main>
    </div>
  )
}
