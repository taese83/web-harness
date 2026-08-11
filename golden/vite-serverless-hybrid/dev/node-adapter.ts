import type {IncomingMessage, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'

export const toWebRequest = (request: IncomingMessage): Request => {
  const host = request.headers.host ?? '127.0.0.1'
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const method = request.method ?? 'GET'
  const init: RequestInit & {duplex?: 'half'} = {method, headers}
  if (!['GET', 'HEAD'].includes(method)) {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>
    init.duplex = 'half'
  }
  return new Request(new URL(request.url ?? '/', `http://${host}`), init)
}

export const writeWebResponse = async (response: Response, target: ServerResponse): Promise<void> => {
  target.statusCode = response.status
  response.headers.forEach((value, name) => target.setHeader(name, value))
  target.end(Buffer.from(await response.arrayBuffer()))
}
