import { Outlet } from '@tanstack/react-router'

import { Vibes } from '../../components/vibes'
import { PageContainer } from '../page-container'
import { Sidebar } from '../sidebar'

import './app-layout.sass'

export function AppLayout() {
  return (
    <div className="app-layout">
      <Vibes />
      <Sidebar />
      <main className="app-main">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </main>
    </div>
  )
}
