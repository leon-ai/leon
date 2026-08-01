import { useNavigate } from '@tanstack/react-router'

import { QueryInput } from '../../components/query-input'

import './new-session-page.sass'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

export function NewSessionPage() {
  const navigate = useNavigate()

  function handleSubmit(): void {
    const navigateToSession = () => navigate({
      to: '/session/$sessionId',
      params: { sessionId: window.crypto.randomUUID() }
    })

    if (
      !('startViewTransition' in document) ||
      window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
    ) {
      void navigateToSession()
      return
    }

    document.startViewTransition(navigateToSession)
  }

  return (
    <div className="new-session-page">
      <div className="new-session-page-composer">
        <QueryInput autoFocus onSubmit={handleSubmit} />
      </div>
    </div>
  )
}
