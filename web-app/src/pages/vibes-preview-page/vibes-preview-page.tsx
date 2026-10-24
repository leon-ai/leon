import { useEffect } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

import {
  VIBE_SEASONS,
  VIBE_SOLAR_PHASES,
  VIBE_WEATHER_CONDITIONS,
  resolveVibeScene
} from '@/components/vibes'
import { applyTheme, getStoredTheme } from '@/theme'
import {
  getVibesPreviewConfiguration,
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH,
  type VibesPreviewSearch
} from './vibes-preview-search'

import './vibes-preview-page.sass'

type VibesPreviewSearchKey = keyof VibesPreviewSearch

function formatOption(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function VibesPreviewPage() {
  const navigate = useNavigate()
  const routeSearch = useSearch({ strict: false })
  const search = parseVibesPreviewSearch(routeSearch)
  const { environment } = getVibesPreviewConfiguration(search)
  const resolution = resolveVibeScene(environment)

  useEffect(() => {
    return () => {
      void applyTheme(getStoredTheme())
    }
  }, [])

  useEffect(() => {
    void applyTheme(search.theme)
  }, [search.theme])

  function updateSearch<Key extends VibesPreviewSearchKey>(
    key: Key,
    value: VibesPreviewSearch[Key]
  ): void {
    void navigate({
      replace: true,
      to: VIBES_PREVIEW_PATH,
      search: (previous) => ({
        ...parseVibesPreviewSearch(previous),
        [key]: value
      })
    })
  }

  function handleSelectChange(
    key: VibesPreviewSearchKey,
    event: ChangeEvent<HTMLSelectElement>
  ): void {
    updateSearch(
      key,
      event.target.value as VibesPreviewSearch[typeof key]
    )
  }

  return (
    <section className="vibes-preview-page">
      <header className="vibes-preview-header">
        <div>
          <h1 className="vibes-preview-title">Vibes preview</h1>
          <p className="vibes-preview-resolution">
            Resolved to <strong>{resolution.sceneId}</strong>
            {!resolution.isExactMatch && ' using the closest available artwork'}
          </p>
        </div>
      </header>

      <fieldset className="vibes-preview-controls">
        <legend className="vibes-preview-legend">Environment</legend>

        <label className="vibes-preview-field">
          <span>Season</span>
          <select
            value={search.season}
            onChange={(event) => handleSelectChange('season', event)}
          >
            {VIBE_SEASONS.map((season) => (
              <option key={season} value={season}>{formatOption(season)}</option>
            ))}
          </select>
        </label>

        <label className="vibes-preview-field">
          <span>Time</span>
          <select
            value={search.solarPhase}
            onChange={(event) => handleSelectChange('solarPhase', event)}
          >
            {VIBE_SOLAR_PHASES.map((solarPhase) => (
              <option key={solarPhase} value={solarPhase}>
                {formatOption(solarPhase)}
              </option>
            ))}
          </select>
        </label>

        <label className="vibes-preview-field">
          <span>Weather</span>
          <select
            value={search.weather}
            onChange={(event) => handleSelectChange('weather', event)}
          >
            {VIBE_WEATHER_CONDITIONS.map((weather) => (
              <option key={weather} value={weather}>{formatOption(weather)}</option>
            ))}
          </select>
        </label>

        <label className="vibes-preview-field">
          <span>Theme</span>
          <select
            value={search.theme}
            onChange={(event) => handleSelectChange('theme', event)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>

      </fieldset>
    </section>
  )
}
