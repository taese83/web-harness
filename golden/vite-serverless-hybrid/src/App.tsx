import {useState, useSyncExternalStore, type MouseEvent} from 'react'

export const formatApiStatus = (status: unknown): string =>
  status === 'ok' ? 'API: ok' : 'API: invalid response'

function Home() {
  const [status, setStatus] = useState('API: not checked')

  const checkApi = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE ?? '/api'}/health`)
      const body: unknown = await response.json()
      const value = typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).status
        : null
      setStatus(response.ok ? formatApiStatus(value) : `API: HTTP ${response.status}`)
    } catch {
      setStatus('API: unavailable')
    }
  }

  return (
    <section>
      <h2>Home</h2>
      <button type="button" onClick={checkApi}>Check API</button>
      <p role="status">{status}</p>
    </section>
  )
}

const subscribeToLocation = (notify: () => void): (() => void) => {
  window.addEventListener('popstate', notify)
  return () => window.removeEventListener('popstate', notify)
}

const currentPath = (): string => window.location.pathname

function LocalLink({href, children}: {href: string; children: string}) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return <a href={href} onClick={navigate}>{children}</a>
}

export function App() {
  const pathname = useSyncExternalStore(subscribeToLocation, currentPath)

  return (
    <main>
      <h1>Golden vite-serverless-hybrid</h1>
      <nav aria-label="주요">
        <LocalLink href="/">Home</LocalLink> <LocalLink href="/about">About</LocalLink>
      </nav>
      {pathname === '/' && <Home />}
      {pathname === '/about' && <h2>About</h2>}
      {!['/', '/about'].includes(pathname) && <h2>Not found</h2>}
    </main>
  )
}
