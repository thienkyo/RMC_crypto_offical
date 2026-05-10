import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // @ts-ignore - allowedDevOrigins is a new property for network dev access
  allowedDevOrigins: ['192.168.1.24', 'localhost:7070'],

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
