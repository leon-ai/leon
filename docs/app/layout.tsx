import 'fumadocs-ui/style.css'
import './global.css'

import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: {
    default: 'Leon Docs',
    template: '%s | Leon Docs'
  },
  description:
    'Documentation for Leon 2.0, the open-source personal AI assistant built around tools, memory, context, and owner control.'
}

export default function RootLayout({
  children
}: {
  children: ReactNode
}): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider
          theme={{
            attribute: 'class',
            defaultTheme: 'dark',
            enableSystem: false
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  )
}
