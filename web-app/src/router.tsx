import {
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router'

import { AppLayout } from './layout/app-layout'
import { NewSessionPage } from './pages/new-session-page'
import { SessionPage } from './pages/session-page'

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

const routeTree = rootRoute.addChildren([indexRoute, sessionRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
