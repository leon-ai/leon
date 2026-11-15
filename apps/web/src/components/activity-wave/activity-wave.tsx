import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import { observeAnimationVisibility } from '@/utils/animation-visibility'

import './activity-wave.sass'

const ACTIVITY_WAVE_SPEED_PX_PER_SECOND = 120

interface ActivityWaveProps {
  active: boolean
  children: ReactNode
  className?: string
}

/**
 * Copies already-rendered artwork without mounting another component tree. SVG
 * fragment references receive private IDs so the visual copy cannot shadow the
 * real content's definitions or accessible labels.
 */
function copyContent(source: HTMLElement, target: HTMLElement, copyId: string): void {
  const fragment = document.createDocumentFragment()
  const ids = new Map<string, string>()

  fragment.append(...[...source.childNodes].map((node) => node.cloneNode(true)))
  for (const [index, element] of fragment.querySelectorAll('[id]').entries()) {
    const id = element.getAttribute('id')!
    const replacement = `${copyId}-${index}`

    ids.set(id, replacement)
    element.setAttribute('id', replacement)
  }

  if (ids.size > 0) {
    for (const element of fragment.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        let value = attribute.value

        for (const [id, replacement] of ids) {
          if (value === `#${id}`) {
            value = `#${replacement}`
          } else {
            for (const quote of ['', '"', '\'']) {
              value = value.replaceAll(
                `url(${quote}#${id}${quote})`,
                `url(${quote}#${replacement}${quote})`
              )
            }
          }
        }
        if (value !== attribute.value) {
          element.setAttributeNS(attribute.namespaceURI, attribute.name, value)
        }
      }
    }
  }
  // Generated text paints the cached glyphs without duplicating the real label
  // in DOM text consumers. The original text remains selectable and accessible.
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT)
  const labels: Text[] = []

  while (walker.nextNode()) {
    labels.push(walker.currentNode as Text)
  }
  for (const label of labels) {
    if (label.parentElement instanceof SVGElement) {
      continue
    }

    const visualLabel = document.createElement('span')

    visualLabel.className = 'activity-wave-text'
    visualLabel.setAttribute('data-activity-wave-text', label.data)
    label.replaceWith(visualLabel)
  }
  target.replaceChildren(fragment)
}

/**
 * Highlights an active heading with cached glyphs inside a moving, feathered
 * window. Counter-moving the visual copy keeps its text fixed in place while
 * the browser composites the sweep without per-frame SVG gradient layout.
 */
export function ActivityWave({
  active,
  children,
  className
}: ActivityWaveProps) {
  const copyId = useId()
  const headingRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const copyRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const animating = active && visible

  useEffect(() => {
    const heading = headingRef.current

    if (heading === null || !active) {
      return undefined
    }

    return observeAnimationVisibility(heading, setVisible)
  }, [active])

  useLayoutEffect(() => {
    const heading = headingRef.current
    const content = contentRef.current
    const copy = copyRef.current

    if (!animating || heading === null || content === null || copy === null) {
      return undefined
    }

    const observedHeading = heading
    const source = content
    const visualCopy = copy

    function update(): void {
      const { width } = observedHeading.getBoundingClientRect()
      const style = window.getComputedStyle(observedHeading)
      const highlightWidth = Number.parseFloat(
        style.getPropertyValue('--activity-wave-highlight-width')
      )
      const travelFraction = Number.parseFloat(
        style.getPropertyValue('--activity-wave-travel-fraction')
      )

      if (width <= 0 || !Number.isFinite(highlightWidth) ||
        !Number.isFinite(travelFraction) || travelFraction <= 0) {
        return
      }

      const durationSeconds = (width + highlightWidth) /
        ACTIVITY_WAVE_SPEED_PX_PER_SECOND / travelFraction

      // The native content owns React updates, selection and accessibility.
      // Clone only its visual nodes, without mounting duplicate component effects.
      copyContent(source, visualCopy, copyId)
      observedHeading.style.setProperty('--activity-wave-width', `${width}px`)
      observedHeading.style.setProperty('--activity-wave-duration', `${durationSeconds}s`)
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    const contentObserver = new MutationObserver(update)

    resizeObserver.observe(observedHeading)
    // Labels and lazy icon fallbacks can change without changing the heading width.
    // Observe only React-owned content so rebuilding the copy cannot observe itself.
    contentObserver.observe(source, {
      childList: true, subtree: true, characterData: true, attributes: true
    })

    return () => {
      resizeObserver.disconnect()
      contentObserver.disconnect()
      visualCopy.replaceChildren()
    }
  }, [animating, copyId])

  return (
    <span
      ref={headingRef}
      className={clsx('activity-wave', className, {
        'activity-wave-active': animating
      })}
    >
      <span ref={contentRef} className="activity-wave-content">{children}</span>
      {animating && (
        <span className="activity-wave-band" aria-hidden="true" inert>
          <span ref={copyRef} className={clsx(className, 'activity-wave-copy')} />
        </span>
      )}
    </span>
  )
}
