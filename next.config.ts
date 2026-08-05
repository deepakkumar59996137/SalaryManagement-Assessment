import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — it must be require()d at runtime rather
  // than bundled, or the .node binary is lost during the server build.
  serverExternalPackages: ['better-sqlite3'],

  typedRoutes: true,
};

export default nextConfig;
