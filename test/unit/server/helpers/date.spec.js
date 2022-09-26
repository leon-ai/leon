import moment from 'moment-timezone'

import { DateHelper } from '@/helpers/date-helper'

describe('date helper', () => {
  describe('dateTime()', () => {
    test('returns date time with UTC', () => {
      expect(DateHelper.getDateTime()).toBe(
        moment().tz(global.date.time_zone).format()
      )
    })
  })

  describe('timeZone()', () => {
    test('returns time zone', () => {
      expect(DateHelper.getTimeZone()).toBe(global.date.time_zone)
    })
  })
})
