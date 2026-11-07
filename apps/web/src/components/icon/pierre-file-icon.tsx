import { useLayoutEffect } from 'react'
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from '@pierre/trees'
import { FileIconFallback, type FileIconProps } from './file-icon'

import './pierre-file-icon.sass'

const SPRITE_ID = 'leon-pierre-file-icons'
const resolver = createFileTreeIconResolver({ set: 'complete', colored: true })

function mountSprite(): void {
  if (document.getElementById(SPRITE_ID)) {
    return
  }

  const container = document.createElement('div')
  container.id = SPRITE_ID
  container.className = 'pierre-file-sprite'
  container.setAttribute('aria-hidden', 'true')
  // This bounded, trusted package sprite is shared for the document's lifetime;
  // retaining it avoids duplicate symbol IDs when messages mount and unmount.
  container.innerHTML = getBuiltInSpriteSheet('complete')
  document.body.appendChild(container)
}

/**
 * Resolves file artwork through the same registry used by Pierre's workspace tree.
 */
export default function PierreFileIcon(props: FileIconProps) {
  const { fileName, ariaLabel, fallbackLabel } = props
  const icon = resolver.resolveIcon('file-tree-icon-file', fileName)
  useLayoutEffect(mountSprite, [])

  if (icon.token === 'default' && fallbackLabel) {
    return <FileIconFallback {...props} />
  }

  return <svg className="app-icon pierre-file-icon" viewBox={icon.viewBox ?? '0 0 16 16'}
    data-file-icon={icon.token} role={ariaLabel ? 'img' : undefined}
    aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}
    focusable="false" style={{ color: `var(--trees-file-icon-color-${icon.token}, currentColor)` }}>
    <use href={`#${icon.name}`} />
  </svg>
}
