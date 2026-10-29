import { useEffect, useState } from 'react'

import { Dropdown } from '@/components/dropdown'
import { LLMProviderIcon } from '@/components/llm-provider-icon'
import {
  modelProviders,
  type ModelChoice,
  type ModelSettings
} from '@/data/model-catalog'

import { ModelSelectorMenu } from './model-selector-menu'
import { ModelSettingsSelector } from './model-settings-selector'

import './model-selector.sass'

const SELECTOR_WIDTH_PX = 352
const SELECTOR_HEIGHT_PX = 540
const DEFAULT_SETTINGS: ModelSettings = { reasoning: 'auto', speed: 'auto' }
const MAXIMUM_RECENT_MODELS = 3
const MAXIMUM_MODEL_HISTORY = MAXIMUM_RECENT_MODELS + 1
const RECENT_MODELS_STORAGE_KEY = 'leon.web-app.recent-models'

interface ModelSelectorProps {
  disabled?: boolean
}

function readModelHistory(): ModelChoice[] {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_MODELS_STORAGE_KEY) ?? '[]'
    )

    if (!Array.isArray(stored)) {
      return []
    }

    const choices: ModelChoice[] = []

    for (const target of stored) {
      if (target === null || typeof target !== 'object') {
        continue
      }

      const provider = modelProviders.find((candidate) => candidate.id === target.provider)
      const model = provider?.models.find((candidate) => candidate.model === target.model)
      const alreadyIncluded = choices.some((choice) =>
        choice.provider.id === provider?.id && choice.model.model === model?.model
      )

      // Stored IDs can outlive catalog entries; never restore stale options.
      if (provider !== undefined && model !== undefined && !alreadyIncluded) {
        choices.push({ provider, model })
      }

      if (choices.length === MAXIMUM_MODEL_HISTORY) {
        break
      }
    }

    return choices
  } catch {
    // Blocked storage and invalid browser data must not prevent model selection.
    return []
  }
}

function getInitialChoice(): ModelChoice {
  const provider = modelProviders[0]
  const model = provider?.models.find((candidate) => candidate.recommended) ??
    provider?.models[0]

  if (provider === undefined || model === undefined) {
    throw new Error('The model selector requires a cataloged model.')
  }

  return { provider, model }
}

/**
 * Previews a model and its supported settings without mutating the agent config.
 */
export function ModelSelector({ disabled = false }: ModelSelectorProps) {
  const [modelHistory, setModelHistory] = useState(readModelHistory)
  const [choice, setChoice] = useState(() => modelHistory[0] ?? getInitialChoice())
  const [settingsByModel, setSettingsByModel] = useState<Record<string, ModelSettings>>({})
  const targetKey = `${choice.provider.id}/${choice.model.model}`
  const settings = settingsByModel[targetKey] ?? DEFAULT_SETTINGS
  const recentModels = modelHistory.filter((recent) =>
    recent.provider.id !== choice.provider.id || recent.model.model !== choice.model.model
  ).slice(0, MAXIMUM_RECENT_MODELS)

  useEffect(() => {
    try {
      window.localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(
        modelHistory.map((recent) => ({
          provider: recent.provider.id,
          model: recent.model.model
        }))
      ))
    } catch {
      // Keep this tab's history usable when browser storage is unavailable.
    }
  }, [modelHistory])

  function chooseModel(next: ModelChoice): void {
    setChoice(next)
    setModelHistory((current) => {
      // The initially active model also becomes a recent when switching away.
      const previous = current.length === 0 ? [choice] : current

      return [
        next,
        ...previous.filter((recent) =>
          recent.provider.id !== next.provider.id || recent.model.model !== next.model.model
        )
      ].slice(0, MAXIMUM_MODEL_HISTORY)
    })
  }

  return (
    <>
      <Dropdown
        className="model-selector-dropdown"
        contentLabel="Choose a model"
        width={SELECTOR_WIDTH_PX}
        height={SELECTOR_HEIGHT_PX}
        preferredPlacement="top"
        disabled={disabled}
        content={(close, open) => (
          <ModelSelectorMenu
            choice={choice}
            recentModels={recentModels}
            open={open}
            onChoose={chooseModel}
            onClose={close}
          />
        )}
      >
        {(open, contentId) => (
          <button
            type="button"
            className="button button-ghost button-md model-selector-trigger"
            disabled={disabled}
            aria-label={`Choose model, current: ${choice.provider.label}, ${choice.model.label}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? contentId : undefined}
          >
            <LLMProviderIcon provider={choice.provider.id} />
            <span className="model-selector-trigger-label">{choice.model.label}</span>
            <i className="ri-arrow-down-s-line model-selector-chevron" aria-hidden="true" />
          </button>
        )}
      </Dropdown>
      <ModelSettingsSelector
        provider={choice.provider}
        model={choice.model}
        settings={settings}
        disabled={disabled}
        onChange={(next) => {
          setSettingsByModel((current) => ({
            ...current,
            [targetKey]: { ...(current[targetKey] ?? DEFAULT_SETTINGS), ...next }
          }))
        }}
      />
    </>
  )
}
