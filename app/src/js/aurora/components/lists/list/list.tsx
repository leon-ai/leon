import type React from 'react'

import './list.sass'

interface Props {
  children: React.ReactNode
}

export function List({ children }: Props) {
  return <ul className="aurora-list">{children}</ul>
}
