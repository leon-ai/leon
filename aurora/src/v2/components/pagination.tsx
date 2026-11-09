import { Button } from './button/button'

/**
 * Shares bounded-page navigation without introducing another scroll viewport.
 * The caller owns filtering and clamps the current zero-based page.
 */
export function Pagination({ label, page, pages, onPageChange }: {
  label: string
  page: number
  pages: number
  onPageChange: (page: number) => void
}) {
  if (pages <= 1) {
    return null
  }

  return <nav className="aurora-pagination" aria-label={`${label} pages`}>
    <Button size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}>Previous</Button>
    <span className="aurora-feedback" role="status">{page + 1} / {pages}</span>
    <Button size="sm" disabled={page + 1 >= pages} onClick={() => onPageChange(page + 1)}>Next</Button>
  </nav>
}
