import log from '@/helpers/log'

/**
 * Just a middleware
 */
const otherMidd = (req, res, next) => {
  // Disable from the header, else it makes hacker's life easier to know more about our system
  res.removeHeader('X-Powered-By')

  log.title('Requesting')
  log.info(`${req.method} ${req.url}`)

  // Add next() to continue
  next()
}

export default otherMidd
