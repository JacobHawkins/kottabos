import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist', sourcemap: false },
  plugins: [{
    name: 'remove-development-ui',
    transformIndexHtml(html) {
      return html.replace(/<details id="diagnostics"[\s\S]*?<\/details>/, '');
    },
  }],
});
