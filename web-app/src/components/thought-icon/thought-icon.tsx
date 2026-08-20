import { clsx } from 'clsx'

import './thought-icon.sass'

interface ThoughtIconProps {
  className?: string
}

/** Displays the cloud-shaped thought indicator missing from RemixIcon. */
export function ThoughtIcon({ className }: ThoughtIconProps) {
  return (
    <svg
      className={clsx('thought-icon', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.1 15.9c-2.83 0-4.9-1.95-4.9-4.3 0-2 1.45-3.7 3.5-4.25a4 4 0 0 1-.22-1.2c0-2.4 2.1-4.35 4.67-4.35 1.2 0 2.3.42 3.15 1.1a4.95 4.95 0 0 1 3.45-1.3c2.83 0 5.13 2.14 5.13 4.78 0 1.2-.46 2.28-1.22 3.12 1.46.75 2.44 2.18 2.44 3.81 0 2.4-2.08 4.34-4.65 4.34-.82 0-1.59-.2-2.25-.57a5.78 5.78 0 0 1-4.22 1.77c-2.28 0-4.21-1.23-4.88-2.95Z"
        transform="translate(3 .5) scale(.86)"
        stroke="currentColor"
        strokeWidth="2.05"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="5.4"
        cy="19.7"
        r="1.35"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}
