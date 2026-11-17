import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': 'http://localhost:3000',
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  optimizeDeps: { include: ['@hiveflow/shared'] },
  build: { commonjsOptions: { include: [/node_modules/, /shared[\\/]dist/] } },
});
