import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent
} from '@tanstack/react-router'

import { AppLayout } from '@/layout/app-layout'
import { NotFoundPage } from '@/pages/not-found-page'
import { queryClient } from '@/query-client'
import { PROFILE_AUTH_QUERY_KEY } from '@/data/profile'
import { prefetchConversation, prepareConversationForNavigation } from '@/data/conversation-queries'
import {
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH
} from '@/pages/vibes-preview-page/vibes-preview-search'

const rootRoute = createRootRoute({
  component: AppLayout,
  notFoundComponent: NotFoundPage
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
  beforeLoad: ({ params, preload }) => {
    const auth = queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)
    if (auth?.profile_name) {
      if (preload) {
        void prefetchConversation(auth.profile_name, params.sessionId)
        return
      }
      prepareConversationForNavigation(auth.profile_name, params.sessionId)
    }
  },
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
  defaultPreloadDelay: 100,
  basepath: import.meta.env.BASE_URL
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
