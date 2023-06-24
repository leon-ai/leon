interface GetTimeDifferenceBetweenDatesResult {
  millisecondsDifference: number
  years: number
  months: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

const MILLISECONDS_PER_SECOND = 1_000
const MILLISECONDS_PER_MINUTE = 60 * 1_000
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR
const MILLISECONDS_PER_MONTH = 30 * MILLISECONDS_PER_DAY
const MILLISECONDS_PER_YEAR = 365 * MILLISECONDS_PER_DAY

export const getTimeDifferenceBetweenDates = (
  date1: Date,
  date2: Date
): GetTimeDifferenceBetweenDatesResult => {
  const millisecondsDifference = date1.getTime() - date2.getTime()
  const years = Math.floor(millisecondsDifference / MILLISECONDS_PER_YEAR)
  const months = Math.floor(
    (millisecondsDifference % MILLISECONDS_PER_YEAR) / MILLISECONDS_PER_MONTH
  )
  const days = Math.floor(
    (millisecondsDifference % MILLISECONDS_PER_MONTH) / MILLISECONDS_PER_DAY
  )
  const hours = Math.floor(
    (millisecondsDifference % MILLISECONDS_PER_DAY) / MILLISECONDS_PER_HOUR
  )
  const minutes = Math.floor(
    (millisecondsDifference % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE
  )
  const seconds = Math.floor(
    (millisecondsDifference % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND
  )
  return {
    millisecondsDifference,
    years,
    months,
    days,
    hours,
    minutes,
    seconds
  }
}
