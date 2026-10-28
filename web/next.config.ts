import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every page is a client page behind sign-in, so there's nothing for Cache Components to cache.
  poweredByHeader: false,
  // The repo root has its own package-lock (the Supabase CLI); the app lives here.
  turbopack: { root: path.join(__dirname) },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Browsers must always fetch the latest service worker, or updates never reach installed apps.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
