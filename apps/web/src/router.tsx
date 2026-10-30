import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent
} from '@tanstack/react-router'

import { AppLayout } from '@/layout/app-layout'
import {
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from '@/pages/vibes-preview-page/vibes-preview-search'

const rootRoute = createRootRoute({
  component: AppLayout
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(
    () => import('@/pages/new-session-page/new-session-page'),
    'NewSessionPage'
  )
})

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$sessionId',
  component: lazyRouteComponent(
    () => import('@/pages/session-page/session-page'),
    'SessionPage'
  )
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionRoute,
  ...(import.meta.env.DEV
    ? [createRoute({
        getParentRoute: () => rootRoute,
        path: VIBES_PREVIEW_PATH,
        component: lazyRouteComponent(
          () => import('@/pages/vibes-preview-page/vibes-preview-page'),
          'VibesPreviewPage'
        ),
        validateSearch: parseVibesPreviewSearch
      })]
    : [])
])

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
