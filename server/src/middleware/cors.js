'use strict'

/**
 * CORS middleware
 */
const corsMidd = (req, res, next) => {
  // Allow only a specific client to request to the API (depending of the env)
  res.header('Access-Control-Allow-Origin', `http://${process.env.LEON_WEBAPP_HOST}:${process.env.LEON_WEBAPP_PORT}`)

  // Allow several headers for our requests
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')

  res.header('Access-Control-Allow-Credentials', true)

  next()
}

export default corsMidd
