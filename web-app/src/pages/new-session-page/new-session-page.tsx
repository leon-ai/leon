import { QueryInput } from '../../components/query-input'

import './new-session-page.sass'

export function NewSessionPage() {
  return (
    <div className="new-session-page">
      <div className="new-session-page-composer">
        <QueryInput autoFocus />
      </div>
    </div>
  )
}
