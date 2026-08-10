import { useNavigate } from '@tanstack/react-router'

import { QueryInput } from '../../components/query-input'
import { setMockSessionInitialQuery } from '../../data/mock-session-store'

import './new-session-page.sass'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

export function NewSessionPage() {
  const navigate = useNavigate()

  function handleSubmit(query: string): void {
    const sessionId = window.crypto.randomUUID()
    setMockSessionInitialQuery(sessionId, query)

    const navigateToSession = () => navigate({
      to: '/session/$sessionId',
      params: { sessionId }
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
