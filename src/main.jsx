import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

const CHUNK_RETRY_KEY = 'plivex:chunk-retry-at'
const CHUNK_RETRY_WINDOW_MS = 90_000

function isChunkLoadError(error) {
  const message = String(error?.message || error || '')
  return /failed to fetch dynamically imported module|importing a module script failed|loading chunk .* failed|chunkloaderror|unable to preload css/i.test(message)
}

// A deployment can briefly leave a browser with an old HTML/module reference.
// Retry one time for chunk-loading failures; if it repeats, show a recovery screen
// instead of leaving the user with an empty white page.
function retryChunkLoadOnce() {
  try {
    const lastAttempt = Number(window.sessionStorage.getItem(CHUNK_RETRY_KEY) || 0)
    if (lastAttempt && Date.now() - lastAttempt < CHUNK_RETRY_WINDOW_MS) return false
    window.sessionStorage.setItem(CHUNK_RETRY_KEY, String(Date.now()))
  } catch {
    // Storage can be unavailable in private/restricted browser modes.
  }

  window.location.reload()
  return true
}

window.addEventListener('vite:preloadError', (event) => {
  if (retryChunkLoadOnce()) event.preventDefault()
})

class AppErrorBoundary extends React.Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[Plivex] App render failed:', error, info)
    if (isChunkLoadError(error)) retryChunkLoadOnce()
  }

  handleRetry = () => {
    try {
      window.sessionStorage.removeItem(CHUNK_RETRY_KEY)
    } catch {
      // Continue with reload if storage is unavailable.
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#F8F7FC',
            color: '#171717',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <section style={{ width: '100%', maxWidth: '420px' }}>
            <div
              aria-hidden="true"
              style={{
                width: '48px',
                height: '48px',
                margin: '0 auto 16px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '14px',
                background: '#6D28D9',
                color: '#fff',
                fontWeight: 800,
                fontSize: '20px',
              }}
            >
              P
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 750 }}>
              Plivex couldn’t load this page
            </h1>
            <p style={{ margin: '0 0 20px', color: '#6B7280', lineHeight: 1.6 }}>
              Your data has not been changed by this screen. Reload Plivex to try opening the page again.
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                minHeight: '44px',
                padding: '10px 20px',
                border: 0,
                borderRadius: '10px',
                background: '#6D28D9',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reload Plivex
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

const rootElement = document.getElementById('root')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  )
} else {
  console.error('[Plivex] Root element #root was not found.')
}
