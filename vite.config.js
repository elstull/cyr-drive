import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const deployHash = (() => {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  return 'local';
})();

function buildInfoPlugin() {
  return {
    name: 'build-info',
    apply: 'build',
    closeBundle() {
      const payload = JSON.stringify({
        sha: deployHash,
        builtAt: new Date().toISOString(),
      });
      writeFileSync(resolve('dist', 'build-info.json'), payload);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildInfoPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEPLOY_HASH__: JSON.stringify(deployHash),
  },
  server: { port: 3000 },
});
