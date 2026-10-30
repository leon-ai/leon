import { useState, useEffect } from 'react'

import { CircularProgress, Flexbox, Text } from '@aurora'

interface TimerProps {
  initialTime: number
  interval: number
  totalTimeContent: string
  initialProgress?: number
  onEnd?: () => void
}

function formatTime(seconds: number): string {
  const minutes = seconds >= 60 ? Math.floor(seconds / 60) : 0
  const remainingSeconds = seconds % 60
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes
  const formattedSeconds =
    remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds

  return `${formattedMinutes}:${formattedSeconds}`
}

export function Timer({
  initialTime,
  initialProgress,
  interval,
  totalTimeContent,
  onEnd
}: TimerProps) {
  const [progress, setProgress] = useState(initialProgress || 0)
  const [timeLeft, setTimeLeft] = useState(initialTime)

  useEffect(() => {
    setTimeLeft(initialTime)
    setProgress(progress)
  }, [initialTime])

  useEffect(() => {
    if (timeLeft <= 0) {
      return
    }

    const timer = setInterval(() => {
      setTimeLeft((prevTime) => {
        const newTime = prevTime - 1

        if (newTime <= 0 && onEnd) {
          onEnd()
        }

        return newTime
      })
      setProgress((prevProgress) => prevProgress + 100 / initialTime)
    }, interval)

    return () => clearInterval(timer)
  }, [initialTime, interval, timeLeft])

  return (
    <CircularProgress value={progress} size="lg">
      <Flexbox gap="xs" alignItems="center" justifyContent="center">
        <Text fontSize="lg" fontWeight="semi-bold">
          {formatTime(timeLeft)}
        </Text>
        <Text fontSize="xs" secondary>
          {totalTimeContent}
        </Text>
      </Flexbox>
    </CircularProgress>
  )
}
