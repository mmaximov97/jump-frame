import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/jump-frame/',
  plugins: [vue(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts'],
    // *.demo.test.ts files assert nothing — they print, for a human to read.
    // Kept out of the suite so a green `npm test` means something. Run them
    // with `npm run demo`.
    exclude: ['**/node_modules/**', '**/*.demo.test.ts'],
    environment: 'node',
  },
})
