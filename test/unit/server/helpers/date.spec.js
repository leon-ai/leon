import moment from 'moment-timezone'

import { getDateTime, getTimeZone } from '@/helpers/date'

describe('date helper', () => {
  describe('dateTime()', () => {
    test('returns date time with UTC', () => {
      expect(getDateTime()).toBe(moment().tz(global.date.time_zone).format())
    })
  })

  describe('timeZone()', () => {
    test('returns time zone', () => {
      expect(getTimeZone()).toBe(global.date.time_zone)
    })
  })
})
