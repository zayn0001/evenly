import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every page is a client page behind sign-in, so there's nothing for Cache Components to cache.
  poweredByHeader: false,
  // The repo root has its own package-lock (the Supabase CLI); the app lives here.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
