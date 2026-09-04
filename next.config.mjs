/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native addon: it must be required at runtime by Node,
  // not traced and bundled by the server compiler.
  serverExternalPackages: ['better-sqlite3']
};

export default nextConfig;
