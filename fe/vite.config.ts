import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import type { Connect } from 'vite';

const home: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url?.split('?')[0] !== '/') return next();
  res.writeHead(302, { Location: `/templates/index.html${req.url.slice(1)}` });
  res.end();
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.WALKERS_BACKEND_URL;
  const proxy = target ? {
    '^/(auth|user|experiences|device-pairings|recordings|walking-analyses|fashion-styles|fashion-images|fashion-analyses)(/|\\?|$)': { target, changeOrigin: true },
    '/ws/': { target, changeOrigin: true, ws: true },
  } : undefined;

  return {
    plugins: [{
      name: 'walkers-home',
      configureServer(server) { server.middlewares.use(home); },
      configurePreviewServer(server) { server.middlewares.use(home); },
    }],
    server: {
      proxy,
      open: '/templates/index.html',
    },
    preview: { proxy },
    build: {
      assetsDir: 'static',
      rollupOptions: { input: fileURLToPath(new URL('./templates/index.html', import.meta.url)) },
    },
  };
});
