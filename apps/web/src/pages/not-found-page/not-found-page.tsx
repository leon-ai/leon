import { Button } from '@/components/button'

import './not-found-page.sass'

/**
 * Keeps unknown URLs inside the familiar app shell with a clear route home.
 */
export function NotFoundPage() {
  return (
    <section className="not-found-page" aria-labelledby="not-found-heading">
      <div className="not-found-page-content">
        <div className="not-found-page-mark" role="img" aria-label="404: Page not found">
          <span aria-hidden="true">4</span>
          <span className="not-found-page-logo" aria-hidden="true" />
          <span aria-hidden="true">4</span>
        </div>
        <h1 id="not-found-heading">A little detour.</h1>
        <p>I couldn’t find this page. Let’s head back and make something.</p>
        <Button to="/" variant="secondary">Back home</Button>
      </div>
    </section>
  )
}
