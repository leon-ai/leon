import { useEffect, useId, useRef, type KeyboardEvent } from 'react'

import { Dropdown } from '@/components/dropdown'
import { ScrollList } from '@/components/scroll-list'
import type {
  ModelOption,
  ModelProvider,
  ModelReasoning,
  ModelSettings,
  ModelSpeed
} from '@/data/model-catalog'

import './model-settings-selector.sass'

const SELECTOR_WIDTH_PX = 320
const MAXIMUM_SELECTOR_HEIGHT_PX = 480
const OPTION_HEIGHT_PX = 40
// Mirrors the compact spacing in the shared list layout.
const OPTION_GAP_PX = 1
// Two section headings plus popup padding, borders and the section divider.
const SECTIONS_HEIGHT_PX = 107
const REASONING_LABELS: Record<ModelReasoning, string> = {
  auto: 'Managed',
  on: 'On',
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}
const SPEED_LABELS: Record<ModelSpeed, string> = {
  auto: 'Auto',
  normal: 'Normal',
  fast: 'Fast'
}

// These describe Leon's existing adapter behavior, not every tier a provider
// might offer. Only OpenAI's exposed control has a native Auto choice.
const SERVICE_TIER_POLICIES: Record<string, {
  automatic: boolean
  normal: string
  fast: string
}> = {
  openai: {
    automatic: true,
    normal: 'Standard processing',
    fast: 'Priority processing'
  },
  anthropic: {
    automatic: false,
    normal: 'Standard inference speed',
    fast: 'Fast inference speed, separate from capacity tiers'
  },
  openrouter: {
    automatic: false,
    normal: 'Standard provider routing',
    fast: 'Prefer higher-throughput providers, not a priority tier'
  }
}

interface SettingsOption<TValue extends string> {
  value: TValue
  label: string
  description?: string
  icon?: string
}

interface SettingsSectionProps<TValue extends string> {
  title: string
  options: SettingsOption<TValue>[]
  selected: TValue | undefined
  onChange: (value: TValue) => void
}

interface ModelSettingsSelectorProps {
  provider: ModelProvider
  model: ModelOption
  settings: ModelSettings
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (settings: Partial<ModelSettings>) => void
}

interface ModelSettingsMenuProps extends Omit<ModelSettingsSelectorProps, 'onOpenChange'> {
  reasoningOptions: SettingsOption<ModelReasoning>[]
  speedOptions: SettingsOption<ModelSpeed>[]
}

/**
 * Presents a supported setting as a keyboard-accessible, single-choice list.
 */
function SettingsSection<TValue extends string>({
  title,
  options,
  selected,
  onChange
}: SettingsSectionProps<TValue>) {
  const titleId = useId()
  const selectedIndex = options.findIndex((option) => option.value === selected)

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % buttons.length
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = buttons.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    buttons[nextIndex]?.focus()
    buttons[nextIndex]?.click()
  }

  return (
    <section className="model-settings-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="model-settings-section-title">{title}</h3>
      {options.length === 0 ? (
        <p className="model-settings-managed">Managed</p>
      ) : (
        <div
          className="list-items"
          role="radiogroup"
          aria-labelledby={titleId}
          onKeyDown={handleKeyDown}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className="dropdown-item model-settings-choice"
              role="radio"
              aria-checked={selected === option.value}
              tabIndex={index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1}
              title={option.description}
              onClick={() => onChange(option.value)}
            >
              <span className="dropdown-item-label">{option.label}</span>
              {option.icon !== undefined && <i className={option.icon} aria-hidden="true" />}
              {selected === option.value && (
                <i className="ri-check-fill" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Resolves Leon's automatic policy without inventing an effort for unknown models.
 */
function getEffectiveReasoning(model: ModelOption, settings: ModelSettings): ModelReasoning {
  return settings.reasoning === 'auto'
    ? model.defaultReasoningEffort ?? 'auto'
    : settings.reasoning
}

/**
 * Distinguishes a native automatic tier from an omitted speed/routing override.
 */
function getEffectiveSpeed(provider: ModelProvider, settings: ModelSettings): ModelSpeed {
  const policy = SERVICE_TIER_POLICIES[provider.id]

  return settings.speed === 'auto' && policy !== undefined && !policy.automatic
    ? 'normal'
    : settings.speed
}

function ModelSettingsMenu({
  provider,
  model,
  settings,
  open,
  reasoningOptions,
  speedOptions,
  onChange
}: ModelSettingsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      const menu = menuRef.current
      const selected = menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      const first = menu?.querySelector<HTMLButtonElement>('[role="radio"]')
      const target = selected ?? first

      target?.focus()
    }
  }, [open])

  return (
    <div ref={menuRef} className="model-settings-menu">
      <ScrollList className="model-settings-list">
        <SettingsSection
          title="Reasoning effort"
          options={reasoningOptions}
          selected={getEffectiveReasoning(model, settings)}
          onChange={(reasoning) => onChange({ reasoning })}
        />
        <SettingsSection
          title="Service tier"
          options={speedOptions}
          selected={getEffectiveSpeed(provider, settings)}
          onChange={(speed) => onChange({ speed })}
        />
      </ScrollList>
    </div>
  )
}

/**
 * Adjusts the chosen model's supported overrides independently of model browsing.
 */
export function ModelSettingsSelector({
  provider,
  model,
  settings,
  disabled = false,
  open,
  onOpenChange,
  onChange
}: ModelSettingsSelectorProps) {
  const policy = SERVICE_TIER_POLICIES[provider.id]
  const reasoningOptions = model.reasoning
    .filter((reasoning) => reasoning !== 'auto')
    .map((reasoning) => ({ value: reasoning, label: REASONING_LABELS[reasoning] }))
  const speedOptions: SettingsOption<ModelSpeed>[] = policy === undefined ? [] : model.speed
    .filter((speed) => speed !== 'auto' || policy.automatic)
    .map((speed) => ({
      value: speed,
      label: SPEED_LABELS[speed],
      description: speed === 'auto' ? 'Use the project service-tier setting' : policy[speed],
      ...(speed === 'fast' ? { icon: 'ri-flashlight-fill' } : {})
    }))
  const menuHeight = Math.min(
    MAXIMUM_SELECTOR_HEIGHT_PX,
    SECTIONS_HEIGHT_PX +
      (Math.max(1, reasoningOptions.length) + Math.max(1, speedOptions.length)) * OPTION_HEIGHT_PX +
      (Math.max(0, reasoningOptions.length - 1) + Math.max(0, speedOptions.length - 1)) * OPTION_GAP_PX
  )
  const reasoningLabel = REASONING_LABELS[getEffectiveReasoning(model, settings)]
  const reasoningDescription = settings.reasoning === 'auto'
    ? model.defaultReasoningLabel : reasoningLabel
  const speed = getEffectiveSpeed(provider, settings)
  const speedLabel = speedOptions.length === 0
    ? 'Managed' : SPEED_LABELS[speed]
  const description = 'Reasoning: ' + reasoningDescription + ', service tier: ' + speedLabel

  return (
    <Dropdown
      className="model-settings-dropdown"
      contentLabel="Model settings"
      width={SELECTOR_WIDTH_PX}
      height={menuHeight}
      preferredPlacement="top"
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      content={(_close, open) => (
        <ModelSettingsMenu
          provider={provider}
          model={model}
          settings={settings}
          open={open}
          reasoningOptions={reasoningOptions}
          speedOptions={speedOptions}
          onChange={onChange}
        />
      )}
    >
      {(open, contentId) => (
        <button
          type="button"
          className="button button-ghost button-md button-composer model-settings-trigger"
          disabled={disabled}
          title={'Model settings · ' + description}
          aria-label={'Model settings, ' + description}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
        >
          <span className="button-label model-settings-label">{reasoningLabel}</span>
          {settings.speed === 'fast' && (
            <i className="ri-flashlight-fill model-settings-fast" aria-hidden="true" />
          )}
        </button>
      )}
    </Dropdown>
  )
}
