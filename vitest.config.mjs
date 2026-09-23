import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://rmc:rmc_dev_password@localhost:5432/rmc_crypto',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
