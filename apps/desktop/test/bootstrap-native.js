void (async () => {
  const { waitFor, button, report } = window.leonDiagnostics
  const marker = 'leon-bootstrap-diagnostic'
  try {
    if (!sessionStorage.getItem(marker)) {
      if (location.pathname !== '/web-app/' || button('Get started') || button('Choose existing installation')) {
        throw new Error('Desktop must open the shared root without an installation choice')
      }
      const unauthorized = await fetch('/__desktop/bootstrap/state', { credentials: 'omit' })
      if (unauthorized.status !== 401) {
        throw new Error('Setup controls must require the local desktop cookie')
      }
      await waitFor(() => document.querySelector('progress[value]'), 'automatic measured setup download')
      const steps = [...document.querySelectorAll('.setup-step')]
      if (!steps.length || steps.some((step) => !step.querySelector('details'))) {
        throw new Error('Every operation must expose details')
      }
      button('Cancel setup').click()
      await waitFor(() => button('Retry setup'), 'cancelled setup')
      sessionStorage.setItem(marker, 'retrying')
      button('Retry setup').click()
      // Server readiness automatically reloads the root with its matching assets.
      return
    }
    await waitFor(() => document.querySelector('textarea[aria-label="Message Leon"]'), 'new session after automatic server connection', 90_000)
    const state = await fetch('/__desktop/bootstrap/state').then((response) => response.json())
    if (state.phase !== 'complete' || state.service || state.steps.some((step) => step.phase !== 'complete' || !step.details.length)) {
      throw new Error('Preparation must finish with details and keep sign-in startup opt-in')
    }
    if (document.querySelector('.setup progress') || document.querySelector('.desktop-startup') || button('Open Leon')) {
      throw new Error('Completed startup must release preparation UI automatically')
    }
    await report({ passed: true, phase: 'complete', checks: ['Root opens without installation choices', 'Automatic measured download',
      'Cancellation and retry', 'Per-step details', 'No settled startup loaders', 'Startup opt-in', 'Gateway session isolation',
      'Managed server connected to shared frontend'] })
  } catch (error) {
    await report({ passed: false, phase: 'complete', error: String(error), text: document.body.innerText,
      state: await fetch('/__desktop/bootstrap/state').then((response) => response.json()).catch(() => null) })
  }
})()
