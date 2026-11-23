import '@fontsource/source-sans-pro/latin-400.css'
import '@fontsource/source-sans-pro/latin-600.css'
import '@fontsource/source-sans-pro/latin-700.css'
import './styles/main.sass'

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

import { ToastProvider } from './components/toast'
import { queryClient } from './query-client'
import { router } from './router'
import { applyStoredTheme, getStoredAccent } from './theme'
import { RequestErrorToasts } from './data/request-error-toasts'
import { initializeProfileAuthentication, PROFILE_AUTH_QUERY_KEY  } from './data/profile-query'
import { SoundActivation } from './components/sound-activation/sound-activation'
import { DesktopCoreBoundary } from './components/desktop-setup/desktop-core-boundary'
import { DESKTOP_BOOTSTRAP_META_NAME, DESKTOP_NOTIFICATION_EVENT, type DesktopTurnNotification } from '../../../bridges/runtime/contracts/desktop-client'

applyStoredTheme()
document.documentElement.dataset['accent'] = getStoredAccent()
if (document.querySelector<HTMLMetaElement>(`meta[name="${DESKTOP_BOOTSTRAP_META_NAME}"]`)?.content !== 'pending') {
  initializeProfileAuthentication(queryClient)
}

function DesktopNotificationNavigation() {
  useEffect(() => {
    const navigate = (event: Event): void => {
      const value = (event as CustomEvent<DesktopTurnNotification>).detail
      const auth = queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)
      if (value?.profile === auth?.profile_name && typeof value?.sessionId === 'string') {
        void router.navigate({ to: '/session/$sessionId', params: { sessionId: value.sessionId } })
      }
    }
    window.addEventListener(DESKTOP_NOTIFICATION_EVENT, navigate)
    return () => window.removeEventListener(DESKTOP_NOTIFICATION_EVENT, navigate)
  }, [])
  return null
}

const rootElement = document.querySelector('#root')

if (rootElement === null) {
  throw new Error('Root element not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DesktopCoreBoundary>
          <RequestErrorToasts />
          <SoundActivation />
          <DesktopNotificationNavigation />
          <RouterProvider router={router} />
        </DesktopCoreBoundary>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
)
