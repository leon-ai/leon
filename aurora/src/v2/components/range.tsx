import type { InputHTMLAttributes } from 'react'
import { clsx } from 'clsx'

import './range.sass'

/**
 * Retains native range semantics with the same accent and focus treatment in
 * generated HTML and React interfaces. The associated label remains host-owned.
 */
export function Range({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'style'>) {
  return <input {...props} type="range" className={clsx('aurora-range', className)} />
}
