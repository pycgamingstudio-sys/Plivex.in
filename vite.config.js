import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
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
});
