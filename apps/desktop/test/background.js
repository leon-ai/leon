// Hidden diagnostics never change the owner's system motion preference. Skip
// view transitions whose promises reject when a document is not visible.
if (window.leonDiagnosticConfig?.background && !window.leonDiagnosticConfig.native_motion) {
  const nativeMatchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query) => {
    const media = nativeMatchMedia(query)
    if (query === '(prefers-reduced-motion: reduce)') {
      Object.defineProperty(media, 'matches', {
        get: () => window.leonDiagnosticConfig.simulated_reduced_motion ?? true,
        configurable: true
      })
    }
    return media
  }
}
