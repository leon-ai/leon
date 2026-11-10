import { lazy, Suspense } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { SETTINGS_SECTIONS } from '@/data/settings-sections'
import { Icon } from '@/components/icon'
import { Button } from '@/components/button'
import { ScrollList } from '@/components/scroll-list'
import { Loader } from '@/components/loader'
import { useTheme } from '@/hooks/use-theme'
import { saveTheme } from '@/theme'
import { useProfile } from '@/data/profile'
import { NotFoundPage } from '@/pages/not-found-page'
import './settings-page.sass'

const ToolsConnections = lazy(() => import('./tools-connections'))
const SkillsSettings = lazy(() => import('./skills-settings'))

/**
 * Routes settings independently from conversations; only the selected section's
 * optional management UI is loaded. Unimplemented settings have no fake controls.
 */
export function SettingsPage() {
  const params = useParams({ strict: false })
  const sectionId = params.section ?? 'tools'
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === sectionId)
  const theme = useTheme({ includeRequested: true })
  const profile = useProfile()
  if (!section) {
    return <NotFoundPage />
  }

  return <div className="settings-page">
    <header className="settings-heading"><h1>Settings</h1><Button to="/" iconName="arrow-left-s" size="sm">Back to chat</Button></header>
    <div className="settings-layout">
      <ScrollList className="settings-navigation" aria-label="Settings navigation">
        <nav aria-label="Settings">{SETTINGS_SECTIONS.map((entry) => <Link key={entry.id}
          to="/settings/$section" params={{ section: entry.id }}
          className={`settings-navigation-item${sectionId === entry.id ? ' settings-navigation-active' : ''}`}
          aria-current={sectionId === entry.id ? 'page' : undefined}>
          <Icon name={entry.icon} /><span>{entry.label}</span>
        </Link>)}</nav>
      </ScrollList>
      <section className="settings-content" aria-labelledby="settings-section-title">
        <header><h2 id="settings-section-title">{section.label}</h2><p>{section.description}</p></header>
        {sectionId === 'tools' ? <Suspense fallback={<Loader size="md" label="Getting your tools ready…" />}><ToolsConnections key={profile} /></Suspense> :
          sectionId === 'skills' ? <Suspense fallback={<Loader size="md" label="Getting your skills ready…" />}><SkillsSettings key={profile} /></Suspense> :
          sectionId === 'appearance' ? <div className="settings-theme" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((value) => <Button key={value} ariaPressed={theme === value}
              variant={theme === value ? 'secondary' : 'ghost'} iconName={value === 'light' ? 'sun' : 'moon'}
              onClick={() => saveTheme(value)}>{value === 'light' ? 'Light' : 'Dark'}</Button>)}
          </div> : <p className="settings-placeholder">This section is being prepared. Your current preferences haven’t changed.</p>}
      </section>
    </div>
  </div>
}
