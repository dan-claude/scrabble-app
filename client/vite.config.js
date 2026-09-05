import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Raw LAN IPs are allowed by Vite automatically; a Bonjour/mDNS hostname
    // (e.g. your-mac-name.local) needs to be explicitly allow-listed or Vite
    // rejects it with "Blocked request. This host is not allowed."
    allowedHosts: ['.local'],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
      },
    },
  },
})
