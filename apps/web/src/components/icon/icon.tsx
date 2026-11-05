import { memo, useEffect, useState } from 'react'
import { clsx } from 'clsx'

import { COMMON_ICONS, ICON_VARIANT_ARTWORK, SOFT_ICON_NAMES, TOOL_ICON_NAMES, type IconDefinition } from './icon-definitions'
import { getIconVariant, resolveIconName } from './icon-name'
import { BRAND_ICONS } from './brand-icons'
import { ICON_MORPHS } from './icon-morphs'
import { MorphPaths } from './morph-paths'

import './icon.sass'

interface IconProps {
  name: string
  fallbackName?: string | undefined
  className?: string
  ariaLabel?: string | undefined
  selected?: boolean | undefined
  state?: string | undefined
  morph?: boolean
}

const COMMON: Readonly<Record<string, IconDefinition>> = COMMON_ICONS
const MORPH_TARGETS: Readonly<Record<string, readonly [string, string]>> = {
  sun: ['theme', 'sun'], moon: ['theme', 'moon'],
  'volume-up': ['sound', 'on'], 'volume-mute': ['sound', 'off'],
  'sidebar-fold': ['sidebar', 'fold'], 'sidebar-unfold': ['sidebar', 'unfold'],
  'send-ins': ['composer', 'send'], 'stop-mini': ['composer', 'stop'],
  pushpin: ['pin', 'pinned'], unpin: ['pin', 'unpinned']
}
let toolArtwork: Readonly<Record<string, IconDefinition>> | undefined
let toolArtworkRequest: Promise<void> | undefined

function loadToolArtwork(): Promise<void> {
  toolArtworkRequest ??= import('./tool-icons').then((module) => {
    toolArtwork = module.TOOL_ICONS
  }).catch(() => {
    // The immediately available fallback remains usable; a later mount can retry.
    toolArtworkRequest = undefined
  })

  return toolArtworkRequest
}

function getArtwork(catalog: Readonly<Record<string, IconDefinition>> | undefined, name: string): IconDefinition | undefined {
  return catalog && Object.hasOwn(catalog, name) ? catalog[name] : undefined
}

/**
 * Shares path painting between application icons and trusted local design studies.
 */
export function IconPaths({ definition }: { definition: IconDefinition }) {
  return definition.map((part, index) => (
    <path key={index} d={part.d} className={part.part ? `icon-part-${part.part}` : undefined}
      fill={part.fill ? 'currentColor' : 'none'} fillOpacity={part.fillOpacity}
      stroke={part.fill ? 'none' : 'currentColor'} />
  ))
}

/**
 * Displays trusted local artwork, with immediate fallbacks for unknown runtime names.
 */
export const Icon = memo(function Icon({ name, fallbackName = 'tools', className, ariaLabel, selected, state, morph: morphEnabled = false }: IconProps) {
  const resolved = resolveIconName(name)
  const fallback = resolveIconName(fallbackName)
  const variant = getIconVariant(name)
  const explicit = variant ? getArtwork(ICON_VARIANT_ARTWORK, `${resolved}-${variant}`) : undefined
  const common = explicit ?? getArtwork(COMMON, resolved)
  const brand = getArtwork(BRAND_ICONS, resolved)
  const tool = getArtwork(toolArtwork, resolved)
  const isTool = !common && !brand && (TOOL_ICON_NAMES.has(resolved) || TOOL_ICON_NAMES.has(fallback))
  const [, setLoaded] = useState(false)

  useEffect(() => {
    if (!isTool || toolArtwork !== undefined) {
      return
    }

    let cancelled = false
    void loadToolArtwork().then(() => {
      if (!cancelled) {
        setLoaded(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isTool, resolved, fallback])

  const shared = {
    className: clsx('app-icon', className),
    'data-icon': resolved,
    'aria-hidden': ariaLabel === undefined ? true as const : undefined,
    'aria-label': ariaLabel,
    role: ariaLabel === undefined ? undefined : 'img'
  }

  const category = getArtwork(COMMON, fallback) ?? getArtwork(BRAND_ICONS, fallback) ?? getArtwork(toolArtwork, fallback)
  const definition = common ?? brand ?? tool ?? category ?? COMMON_ICONS.tools
  const artworkName = common || brand || tool ? resolved : category ? fallback : 'tools'
  const selectionFamily = selected !== undefined
    ? resolved === 'list-check' ? 'list-selection' : resolved === 'layout-column' ? 'column-selection' : undefined
    : undefined
  const morph = resolved === 'file-copy' && state !== undefined
    ? ['copy', state] as const
    : selectionFamily ? [selectionFamily, selected ? 'selected' : 'idle'] as const
      : morphEnabled && !explicit && Object.hasOwn(MORPH_TARGETS, resolved) ? MORPH_TARGETS[resolved] : undefined
  const frames = morph ? ICON_MORPHS[morph[0]] : undefined

  return (
    <svg {...shared} data-icon-fallback={!common && !brand && !tool ? category ? fallback : 'tools' : undefined}
      data-icon-artwork={SOFT_ICON_NAMES.has(artworkName) ? 'soft-b' : 'original'}
      data-icon-variant={variant}
      data-selected={selected} viewBox="0 0 24 24" fill="none" strokeWidth="2.1"
      strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {frames && morph && frames[morph[1]] ? (
        <MorphPaths key={morph[0]} frames={frames} state={morph[1]} />
      ) : <IconPaths definition={definition} />}
    </svg>
  )
})
