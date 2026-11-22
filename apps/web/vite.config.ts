import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': apiTarget,
      '/api': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  optimizeDeps: { include: ['@hiveflow/shared'] },
  build: { commonjsOptions: { include: [/node_modules/, /shared[\\/]dist/] } },
});
