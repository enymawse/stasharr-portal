import { defineConfig } from 'vitest/config';
import { inlineAngularComponentResources } from './vitest.angular-resources';

export default defineConfig({
  plugins: [inlineAngularComponentResources()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts'],
    isolate: false,
    sequence: {
      setupFiles: 'list',
    },
    setupFiles: ['./src/test-setup.ts'],
  },
});
