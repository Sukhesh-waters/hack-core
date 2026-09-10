/** @type {import('next').NextConfig} */
const nextConfig = {
  optimizeFonts: false,
  // Next 14.2 gates instrumentation.ts (used for the boot-time env guard,
  // src/lib/env.ts) behind this flag; it becomes the stable default in
  // Next 15 and this flag can be dropped then.
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
