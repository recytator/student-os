import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'worker/**/*.test.ts'],
    exclude: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
});
