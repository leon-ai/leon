import { Feed } from '../../components/feed'
import { QueryInput } from '../../components/query-input'

import './session-page.sass'

export function SessionPage() {
  return (
    <div className="session-page">
      <Feed />
      <QueryInput />
    </div>
  )
}
