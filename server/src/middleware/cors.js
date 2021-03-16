/**
 * CORS middleware
 */
const corsMidd = (req, res, next) => {
  // Allow only a specific client to request to the API (depending of the env)
  if (process.env.LEON_NODE_ENV !== 'production') {
    res.header('Access-Control-Allow-Origin', `${process.env.LEON_HOST}:3000`)
  }

  // Allow several headers for our requests
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')

  res.header('Access-Control-Allow-Credentials', true)

  next()
}

export default corsMidd
