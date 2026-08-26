import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080,
    // Let dev-server tunnels through (Telegram Mini App testing via
    // cloudflared/ngrok); tighten or remove for anything beyond dev.
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
