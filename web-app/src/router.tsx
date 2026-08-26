import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound
} from '@tanstack/react-router'

import { AppLayout } from './layout/app-layout'
import { NewSessionPage } from './pages/new-session-page'
import { SessionPage } from './pages/session-page'
import {
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from './pages/vibes-preview-page/vibes-preview-search'

const rootRoute = createRootRoute({
  component: AppLayout
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: NewSessionPage
})

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$sessionId',
  component: SessionPage
})

const vibesPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: VIBES_PREVIEW_PATH,
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound()
    }
  },
  component: lazyRouteComponent(
    () => import('./pages/vibes-preview-page/vibes-preview-page'),
    'VibesPreviewPage'
  ),
  validateSearch: parseVibesPreviewSearch
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionRoute,
  vibesPreviewRoute
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
