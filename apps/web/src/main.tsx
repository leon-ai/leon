import '@fontsource/source-sans-pro/latin-400.css'
import '@fontsource/source-sans-pro/latin-600.css'
import '@fontsource/source-sans-pro/latin-700.css'
import 'remixicon/fonts/remixicon.css'
import './styles/main.sass'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

import { ToastProvider } from './components/toast'
import { queryClient } from './query-client'
import { router } from './router'
import { applyStoredTheme } from './theme'

applyStoredTheme()

const rootElement = document.querySelector('#root')

if (rootElement === null) {
  throw new Error('Root element not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
)
