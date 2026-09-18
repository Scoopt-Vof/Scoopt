/** @type {import('next').NextConfig} */
const nextConfig = {
  // The repo root has a stray package-lock.json, so Turbopack (the default
  // bundler since Next.js 16) would otherwise guess the wrong project root.
  turbopack: { root: __dirname },
};
module.exports = nextConfig;
