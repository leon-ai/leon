import type React from 'react'
import classNames from 'classnames'

import { Text } from '..'
import { type Size } from '../../lib/types'

import './link.sass'

interface Props {
  href: string
  children: React.ReactNode
  fontSize?: Size
}

export function Link({ href, children, fontSize }: Props) {
  return (
    <a className={classNames('aurora-link')} href={href} target="_blank">
      <Text fontSize={fontSize}>{children}</Text>
    </a>
  )
}
