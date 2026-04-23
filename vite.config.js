import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const vercelUrl = process.env.VERCEL_URL || '';
const deployHash = (() => {
  const match = vercelUrl.match(/-([a-z0-9]+)-[^-]+-[^.]+\.vercel\.app$/);
  if (match) return match[1];
  const dplId = process.env.VERCEL_DEPLOYMENT_ID || '';
  if (dplId) return dplId.replace(/^dpl_/, '').slice(0, 8);
  return 'local';
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEPLOY_HASH__: JSON.stringify(deployHash),
  },
  server: { port: 3000 },
});
