import { defineConfig } from 'vitest/config'

/**
 * Config for `npm run demo` — the hand-run playgrounds under
 * `src/lib/*.demo.test.ts`, which print rather than assert.
 *
 * They live in their own config so the main suite's `include`/`exclude` can
 * stay strict: a green `npm test` should only ever mean real assertions
 * passed. No Vue or Tailwind plugin here — the playgrounds import plain
 * TypeScript from `src/lib`, nothing that needs a component pipeline.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.demo.test.ts'],
    environment: 'node',
  },
})
