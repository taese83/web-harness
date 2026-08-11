import {existsSync} from 'node:fs'
import {relative, resolve, sep} from 'node:path'
import react from '@vitejs/plugin-react'
import {defineConfig, loadEnv, type Plugin} from 'vite'
import {toWebRequest, writeWebResponse} from './dev/node-adapter'

const apiRoot = resolve(import.meta.dirname, 'api')

const resolveHandler = (pathname: string): string | null => {
  const route = pathname.replace(/^\/api\/?/, '')
  if (!route || !/^[a-z0-9/-]+$/i.test(route)) return null
  const candidate = resolve(apiRoot, `${route}.ts`)
  const offset = relative(apiRoot, candidate)
  if (offset === '..' || offset.startsWith(`..${sep}`) || !existsSync(candidate)) return null
  return candidate
}

const apiPlugin = (): Plugin => ({
  name: 'golden-api-middleware',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://vite.local').pathname
      if (!pathname.startsWith('/api/')) return next()
      const handlerPath = resolveHandler(pathname)
      if (!handlerPath) return next()
      try {
        const module = await server.ssrLoadModule(handlerPath)
        const handler = module.default?.fetch
        if (typeof handler !== 'function') throw new TypeError('API module must default-export {fetch}')
        await writeWebResponse(await handler(toWebRequest(request)), response)
      } catch (error) {
        if (!response.headersSent) {
          response.statusCode = 500
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({error: {code: 'internal_error'}}))
        }
        server.config.logger.error(error instanceof Error ? error.stack ?? error.message : String(error))
      }
    })
  },
})

export default defineConfig(({mode}) => {
  const environment = loadEnv(mode, process.cwd(), '')
  for (const [name, value] of Object.entries(environment)) {
    if (!process.env[name]) process.env[name] = value
  }
  return {
    cacheDir: '.vite',
    plugins: [react(), apiPlugin()],
    test: {exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'tests/production-boundary.ts']},
  }
})
