import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { BookOpen, Code2, Map } from 'lucide-react'
import type { ReactNode } from 'react'

import { source } from '@/lib/source'

export default function Layout({
  children
}: {
  children: ReactNode
}): ReactNode {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <span className="font-semibold">
            Leon <span className="text-fd-muted-foreground">Docs</span>
          </span>
        )
      }}
      links={[
        {
          text: 'GitHub',
          url: 'https://github.com/leon-ai/leon',
          icon: <Code2 />
        },
        {
          text: 'Roadmap',
          url: '/docs/roadmap/priorities',
          icon: <Map />
        },
        {
          text: 'Blog',
          url: 'https://blog.getleon.ai',
          icon: <BookOpen />
        }
      ]}
    >
      {children}
    </DocsLayout>
  )
}
