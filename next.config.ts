import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — it must be require()d at runtime rather
  // than bundled, or the .node binary is lost during the server build.
  serverExternalPackages: ['better-sqlite3'],

  // typedRoutes is deliberately off. This app puts directory state in the URL,
  // so most navigation targets are built at runtime as `${pathname}${query}` —
  // which typedRoutes cannot check. Keeping it on would mean an `as Route` cast
  // at every call site: all of the friction, none of the safety.
};

export default nextConfig;
