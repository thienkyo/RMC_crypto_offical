import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  // Allow Binance API calls from server-side route handlers
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
