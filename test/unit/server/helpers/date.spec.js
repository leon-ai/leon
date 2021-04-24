import moment from 'moment-timezone'

import date from '@/helpers/date'

describe('date helper', () => {
  describe('dateTime()', () => {
    test('returns date time with UTC', () => {
      expect(date.dateTime()).toBe(moment().tz(global.date.time_zone).format())
    })
  })

  describe('timeZone()', () => {
    test('returns time zone', () => {
      expect(date.timeZone()).toBe(global.date.time_zone)
    })
  })
})
