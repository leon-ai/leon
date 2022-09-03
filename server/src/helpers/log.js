import fs from 'fs'

import date from '@/helpers/date'

const log = {}

log.success = (value) => console.log('\x1b[32m✅ %s\x1b[0m', value)

log.info = (value) => console.info('\x1b[36mℹ️  %s\x1b[0m', value)

log.error = (value) => {
  const path = `${__dirname}/../../../logs/errors.log`
  const errMessage = 'Not able to log the error'
  const data = `${date.dateTime()} - ${value}`

  if (process.env.LEON_NODE_ENV !== 'testing') {
    /* istanbul ignore next */
    if (!fs.existsSync(path)) {
      fs.writeFile(path, data, { flags: 'wx' }, (err) => {
        if (err) log.warning(errMessage)
      })
    } else {
      fs.appendFile(path, `\n${data}`, (err) => {
        if (err) log.warning(errMessage)
      })
    }
  }

  return console.error('\x1b[31m🚨 %s\x1b[0m', value)
}

log.warning = (value) => console.warn('\x1b[33m⚠️  %s\x1b[0m', value)

log.debug = (value) => console.info('\u001b[35m🐞 [DEBUG] %s\x1b[0m', value)

log.title = (value) =>
  console.log('\n\n\x1b[7m.: %s :.\x1b[0m', value.toUpperCase())

log.default = (value) => console.log('%s', value)

export default log
