import React from 'react'
// import classNames from 'classnames'

import './loader.sass'

interface Props {
  // size?: 'sm' | 'md'
}

export function Loader({}: // size
Props) {
  return (
    <span className="aurora-loader" />
    /*<span
      className={classNames('aurora-loader', {
        [`aurora-loader--${size}`]: size
      })}
    />*/
  )
}
