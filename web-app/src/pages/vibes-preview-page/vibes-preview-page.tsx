import { useEffect } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

import {
  VIBE_CUP_STATES,
  VIBE_SEASONS,
  VIBE_SOLAR_PHASES,
  VIBE_WEATHER_CONDITIONS,
  resolveVibeScene
} from '../../components/vibes'
import { applyTheme, getStoredTheme } from '../../theme'
import {
  getVibesPreviewConfiguration,
  parseVibesPreviewSearch,
  VIBES_PREVIEW_PATH,
  type VibesPreviewSearch
} from './vibes-preview-search'

import './vibes-preview-page.sass'

type VibesPreviewSearchKey = keyof VibesPreviewSearch
type VibesPreviewSelectKey = Exclude<
  VibesPreviewSearchKey,
  'lampIntensity' | 'lampOn'
>

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
      applyTheme(getStoredTheme())
    }
  }, [])

  useEffect(() => {
    applyTheme(search.theme)
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
    key: VibesPreviewSelectKey,
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

        <label className="vibes-preview-field">
          <span>Cup</span>
          <select
            value={search.cupState}
            onChange={(event) => handleSelectChange('cupState', event)}
          >
            {VIBE_CUP_STATES.map((cupState) => (
              <option key={cupState} value={cupState}>
                {formatOption(cupState)}
              </option>
            ))}
          </select>
        </label>

        <label className="vibes-preview-field">
          <span>Lamp</span>
          <select
            value={String(search.lampOn)}
            onChange={(event) => updateSearch(
              'lampOn',
              event.target.value === 'true'
            )}
          >
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        </label>

        <label className="vibes-preview-field vibes-preview-intensity">
          <span>Intensity {Math.round(search.lampIntensity * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={search.lampIntensity}
            disabled={!search.lampOn}
            onChange={(event) => updateSearch(
              'lampIntensity',
              Number(event.target.value)
            )}
          />
        </label>
      </fieldset>
    </section>
  )
}
