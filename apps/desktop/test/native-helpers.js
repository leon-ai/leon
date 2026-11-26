// Shared WebView diagnostics use normal DOM events and report only to the host.
window.leonDiagnostics = (() => {
  const lookupStats = { calls: 0, clonedRoots: 0 }
  /**
   * Waits for an observable native-WebView state with a bounded deadline.
   */
  async function waitFor(read, description, timeout = 20_000) {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const result = await read()
      if (result) {
        return result
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${description}`)
  }

  /**
   * Matches a control's visible label while excluding hidden shortcut hints.
   */
  function button(label) {
    lookupStats.calls++
    return [...document.querySelectorAll('button, a')].find((element) => {
      const accessibleLabel = element.getAttribute('aria-label')
      if (accessibleLabel !== null) {
        return accessibleLabel === label
      }
      return visibleText(element).trim() === label
    })
  }

  // Read labels without cloning SVGs or creating detached DOM during polling.
  function visibleText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent
    }
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') {
      return ''
    }
    let text = ''
    for (const child of node.childNodes) {
      text += visibleText(child)
    }
    return text
  }

  /**
   * Updates controlled inputs through the native value setter and input event.
   */
  function fill(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    // React observes native value changes; assigning its tracked instance
    // property would leave the controlled input state unchanged.
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  }

  /**
   * Publishes diagnostics through the local host without contacting the Leon server.
   */
  async function report(value) {
    const response = await fetch('/__desktop/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    })
    if (!response.ok) {
      throw new Error('The host could not save its diagnostic report')
    }
  }

  return { waitFor, button, fill, report, lookupStats }
})()
