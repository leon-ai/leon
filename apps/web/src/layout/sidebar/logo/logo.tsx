import { Link } from '@tanstack/react-router'

import './logo.sass'

interface LogoProps {
  src: string
  width: number
  height: number
  alt?: string
  to?: '/'
}

export function Logo({
  src,
  width,
  height,
  alt = 'Leon',
  to = '/'
}: LogoProps) {
  return (
    <Link className="logo" to={to} aria-label="Leon home">
      <img src={src} width={width} height={height} alt={alt} />
    </Link>
  )
}
