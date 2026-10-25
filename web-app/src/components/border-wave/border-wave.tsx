import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'

import {
  createBorderWaveRenderer,
  type BorderWaveBounds,
  type BorderWaveRenderer
} from './border-wave-renderer'

import './border-wave.sass'

interface BorderWaveProps {
  bounds: BorderWaveBounds
  className: string
  strokeWidth: number
  durationMs?: number
  speedPxPerSecond?: number
  repeat?: boolean
  repeatPauseMs?: number
  paused?: boolean
  onComplete?: () => void
}

/**
 * Hosts a single canvas while animation frames remain outside React rendering.
 */
export function BorderWave({
  bounds,
  className,
  strokeWidth,
  durationMs = 1_000,
  speedPxPerSecond,
  repeat = false,
  repeatPauseMs = 0,
  paused = false,
  onComplete
}: BorderWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<BorderWaveRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const renderer = createBorderWaveRenderer(canvas)

    rendererRef.current = renderer

    return () => {
      rendererRef.current = null
      renderer?.dispose()
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.update({
      bounds,
      strokeWidth,
      durationMs,
      speedPxPerSecond,
      repeat,
      repeatPauseMs,
      paused
    })
  }, [bounds, strokeWidth, durationMs, speedPxPerSecond, repeat, repeatPauseMs, paused])

  return (
    <canvas
      ref={canvasRef}
      className={clsx('border-wave', className, {
        'border-wave-repeating': repeat
      })}
      aria-hidden="true"
      style={{ animationDuration: `${durationMs}ms` }}
      onAnimationEnd={onComplete}
    />
  )
}
