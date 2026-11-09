import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useProfile } from '@/data/profile'
import { useTheme } from '@/hooks/use-theme'
import { Loader } from '@/components/loader'

import './visual-layout.sass'

const MAXIMUM_LAYOUTS = 256
const MAXIMUM_LAYOUT_KEY_CHARACTERS = 1_024
const heights = new Map<string, number>()

/**
 * Reserves the last settled geometry while optional content prepares off-flow.
 * Only dimensions are retained; executable documents and rendered trees are not.
 */
export function VisualLayout({ identity, estimatedHeight = '360px', ready, label = 'Getting this ready…', children }: {
  identity: string
  estimatedHeight?: string
  ready: boolean
  label?: string
  children: ReactNode
}) {
  const profile = useProfile()
  const theme = useTheme()
  const container = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [fontsReady, setFontsReady] = useState(document.fonts.status === 'loaded')
  const visible = ready && fontsReady

  useLayoutEffect(() => {
    let active = true
    // Resolve the subtree's font usage before checking the document font set.
    content.current?.getBoundingClientRect()
    if (document.fonts.status !== 'loaded') {
      setFontsReady(false)
      void document.fonts.ready.then(() => {
        if (active) {
          setFontsReady(true)
        }
      })
    } else {
      setFontsReady(true)
    }

    return () => {
      active = false
    }
  }, [ready, identity])

  useLayoutEffect(() => {
    const box = container.current!
    const body = content.current!

    function update(): void {
      const width = Math.round(box.getBoundingClientRect().width)
      if (!width) {
        return
      }
      const key = JSON.stringify([profile, identity, theme, width])
      const height = Math.ceil(body.getBoundingClientRect().height)
      if (visible && height > 0 && key.length <= MAXIMUM_LAYOUT_KEY_CHARACTERS) {
        heights.delete(key)
        while (heights.size >= MAXIMUM_LAYOUTS) {
          heights.delete(heights.keys().next().value!)
        }
        heights.set(key, height)
      }
      const reserved = heights.get(key)
      const next = visible ? '' : reserved === undefined ? estimatedHeight : `${reserved}px`
      if (box.style.height !== next) {
        box.style.height = next
      }
    }

    const observer = new ResizeObserver(update)
    observer.observe(box)
    observer.observe(body)
    update()

    return () => observer.disconnect()
  }, [profile, identity, theme, estimatedHeight, visible])

  return <div className="visual-layout" ref={container} data-visual-pending={!visible || undefined} aria-busy={!visible}>
    <div className="visual-layout-content" ref={content} inert={!visible}>{children}</div>
    {!visible && <div className="visual-layout-placeholder"><Loader size="sm" label={label} /></div>}
  </div>
}
