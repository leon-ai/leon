import { createMDX } from 'fumadocs-mdx/next'

const config = {
  reactStrictMode: true,
  turbopack: {
    root: import.meta.dirname
  },
  async rewrites() {
    return [
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/docs/:path*'
      }
    ]
  }
}

const withMDX = createMDX()

export default withMDX(config)
