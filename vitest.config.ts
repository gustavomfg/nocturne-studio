import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['tests/renderer/**', '**/node_modules/**', '**/.git/**'],
    // Real SQLite FULL-sync and native workers compete for the hosted Windows
    // volume. Serialize files, not the deliberately concurrent operations/peers
    // inside adversarial tests. Keep assertions and per-test deadlines unchanged.
    fileParallelism: process.platform !== 'win32',
  },
})
