import { app } from '../server/index.js'

export default function handler(req, res) {
  const incoming = new URL(req.url, 'http://vercel.local')
  const routedPath = incoming.searchParams.get('__path')
  if (routedPath) {
    incoming.searchParams.delete('__path')
    req.url = `${routedPath}${incoming.search}`
  }
  app(req, res)
}
