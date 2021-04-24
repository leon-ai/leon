import dotenv from 'dotenv'

dotenv.config()

// Map necessary Leon's env vars as Vite only expose VITE_*
process.env.VITE_LEON_NODE_ENV = process.env.LEON_NODE_ENV
process.env.VITE_LEON_HOST = process.env.LEON_HOST
process.env.VITE_LEON_PORT = process.env.LEON_PORT

export default {
  root: 'app/src',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
}
