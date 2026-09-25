import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },

  plugins: [react(), svgr(), cssInjectedByJsPlugin()],

  build: {
    target: 'es2020',
    minify: true,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/index.jsx'),
      fileName: () => 'admin.js',
      formats: ['es'],
    },
    rolldownOptions: {
      output: { minify: true },
    },
  },

  server: {
    port: 9010,
  },
});
