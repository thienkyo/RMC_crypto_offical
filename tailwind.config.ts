import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Finance terminal palette
        surface: {
          DEFAULT: '#0a0e1a',  // page background
          1: '#0f1421',        // panel background
          2: '#141929',        // elevated card
          3: '#1a2035',        // hover state
          border: '#1e2a3d',   // dividers
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#4a5568',
          price: '#f0f4ff',    // monospace prices
        },
        up: '#10b981',         // green — price up
        down: '#ef4444',       // red — price down
        warn: '#f59e0b',       // amber — warning/stale
        accent: '#3b82f6',     // blue — primary accent
      },
      animation: {
        'pulse-fast': 'pulse 0.5s cubic-bezier(0.4, 0, 0.6, 1) 1',
      },
    },
  },
  plugins: [],
};

export default config;
