import path from 'node:path';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },

  plugins: [vue()],

  build: {
    target: 'es2020',
    cssTarget: ['chrome105', 'edge105', 'firefox110', 'safari16', 'ios16'],
    minify: true,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/index.ts'),
      fileName: () => 'line.js',
      formats: ['es'],
    },
    rolldownOptions: {
      output: { minify: true, comments: false },
    },
  },
});
