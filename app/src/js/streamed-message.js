const streams = new WeakMap()
const TOKEN_CLASS = 'llm-token'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Appends one chunk without replacing spans whose animations are still running.
 */
function appendText(element, text, animate) {
  if (!text) return
  if (!animate) {
    element.appendChild(document.createTextNode(text))
    element.normalize()
    return
  }

  const span = document.createElement('span')
  span.className = TOKEN_CLASS
  span.textContent = text
  element.appendChild(span)
}

/**
 * Releases finished spans so DOM size follows visible structure, not token count.
 */
function settleToken(event) {
  const span = event.target
  if (!span.classList.contains(TOKEN_CLASS)) return
  const parent = span.parentNode
  span.replaceWith(...span.childNodes)
  parent.normalize()
}

/**
 * Keeps stable text/link containers while their text and link targets grow.
 */
function updatePart(part, source, animate) {
  if (source.nodeType !== Node.TEXT_NODE) {
    for (const attribute of [...part.element.attributes]) {
      if (!source.hasAttribute(attribute.name)) part.element.removeAttribute(attribute.name)
    }
    for (const attribute of source.attributes) {
      if (part.element.getAttribute(attribute.name) !== attribute.value) {
        part.element.setAttribute(attribute.name, attribute.value)
      }
    }
  }

  const text = source.textContent
  if (text.startsWith(part.text)) {
    appendText(part.element, text.slice(part.text.length), animate)
  } else {
    // Completing a path delimiter changes displayed text, not just its suffix.
    // Apply that correction without animating old content again.
    part.element.textContent = text
  }
  part.text = text
}

/**
 * Formats live text while allowing each emitted chunk's fade to finish independently.
 */
export function renderStreamedMessage(element, formattedMessage, shouldAnimate = true) {
  let state = streams.get(element)
  if (!state) {
    state = { html: '', parts: [] }
    streams.set(element, state)
    element.addEventListener('animationend', settleToken)
    element.addEventListener('animationcancel', settleToken)
  }
  if (state.html === formattedMessage) return

  const animate = shouldAnimate && !window.matchMedia(REDUCED_MOTION_QUERY).matches
  const appending = formattedMessage.startsWith(state.html)
  const template = document.createElement('template')
  // Ordinary tokens only parse the added suffix. A growing URL can change an
  // earlier href, so reconcile its parts without replacing its active spans.
  template.innerHTML = appending
    ? formattedMessage.slice(state.html.length)
    : formattedMessage
  const sources = [...template.content.childNodes]
  let index = appending ? state.parts.length : 0

  for (const [offset, source] of sources.entries()) {
    const previous = state.parts.at(-1)
    if (appending && offset === 0 && source.nodeType === Node.TEXT_NODE &&
        previous?.name === source.nodeName) {
      appendText(previous.element, source.textContent, animate)
      previous.text += source.textContent
      continue
    }

    let part = state.parts[index]
    if (part && part.name !== source.nodeName) {
      for (const removed of state.parts.splice(index)) removed.element.remove()
      part = undefined
    }
    if (!part) {
      const container = source.nodeType === Node.TEXT_NODE
        ? document.createElement('span')
        : source.cloneNode(false)
      element.appendChild(container)
      part = { name: source.nodeName, element: container, text: '' }
      state.parts.push(part)
    }
    updatePart(part, source, animate)
    index += 1
  }
  if (!appending) {
    for (const removed of state.parts.splice(index)) removed.element.remove()
  }
  state.html = formattedMessage
}
