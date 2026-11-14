import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Vite builds static assets before Wrangler deploys the Worker. Wrangler vars
// are therefore not automatically available as import.meta.env during build.
// Use explicit VITE_* environment values first, then the public allowlisted
// values in the edition-specific Wrangler config so clean CI builds match the Worker configuration.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const edition = env.VITE_APP_EDITION || process.env.VITE_APP_EDITION || 'india'
  const wranglerFile = edition === 'global' ? './wrangler.global.jsonc' : './wrangler.jsonc'
  const wranglerPath = fileURLToPath(new URL(wranglerFile, import.meta.url))
  let workerConfig
  try {
    workerConfig = JSON.parse(readFileSync(wranglerPath, 'utf8'))
  } catch {
    throw new Error(`Could not read the public Vite build configuration from ${wranglerFile}`)
  }

  const workerVars = workerConfig.vars || {}
  const publicBuildEnv = {
    VITE_APP_EDITION: edition,
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || workerVars.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY || workerVars.VITE_SUPABASE_ANON_KEY,
    VITE_API_BASE_URL: env.VITE_API_BASE_URL || workerVars.VITE_API_BASE_URL,
    VITE_ASSISTANT_API_BASE_URL: env.VITE_ASSISTANT_API_BASE_URL || workerVars.VITE_ASSISTANT_API_BASE_URL,
  }

  if (!publicBuildEnv.VITE_SUPABASE_URL || !publicBuildEnv.VITE_SUPABASE_ANON_KEY) {
    throw new Error('Missing required public VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY build configuration')
  }

  const define = Object.fromEntries(
    Object.entries(publicBuildEnv)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  )

  return {
    define,
    plugins: [
      react(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'pdf': ['jspdf', 'html2canvas'],
            'charts': ['recharts'],
            'three': ['three'],
            'motion': ['framer-motion']
          }
        }
      }
    }
  }
})
