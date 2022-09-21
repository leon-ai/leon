import moment from 'moment-timezone'

import { DATE } from '@/helpers/date'

describe('date helper', () => {
  describe('dateTime()', () => {
    test('returns date time with UTC', () => {
      expect(DATE.getDateTime()).toBe(
        moment().tz(global.date.time_zone).format()
      )
    })
  })

  describe('timeZone()', () => {
    test('returns time zone', () => {
      expect(DATE.getTimeZone()).toBe(global.date.time_zone)
    })
  })
})
