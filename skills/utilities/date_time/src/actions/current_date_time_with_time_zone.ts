import type { ActionFunction, SpacyLocationCityEntity } from '@sdk/types'
import { leon } from '@sdk/leon'

import { zeroPad } from '../lib/zeroPad'

export const run: ActionFunction = async function (params) {
  let cityEntity: SpacyLocationCityEntity | null = null
  for (const entity of params.current_entities) {
    if (entity.type === 'location:city') {
      cityEntity = entity
      break
    }
  }

  if (cityEntity == null) {
    return await leon.answer({
      key: 'city_not_found'
    })
  }

  const { time_zone } = cityEntity.resolution.data
  const currentDate = new Date(
    new Date().toLocaleString('en', { timeZone: time_zone.id })
  )
  await leon.answer({
    key: 'current_date_time_with_time_zone',
    data: {
      weekday: currentDate.toLocaleString(params.lang, { weekday: 'long' }),
      month: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day: currentDate.getDate(),
      year: currentDate.getFullYear(),
      hours: zeroPad(currentDate.getHours()),
      minutes: zeroPad(currentDate.getMinutes()),
      seconds: zeroPad(currentDate.getSeconds()),
      city: cityEntity.resolution.data.name,
      country: time_zone.country_code
    }
  })
}
