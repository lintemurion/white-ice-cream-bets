import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'node',
    // Rules and data tests share one emulator; run files one at a time.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
