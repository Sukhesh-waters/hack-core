/** @type {import('next').NextConfig} */
// Next 15: instrumentation.ts (the boot-time env guard, src/lib/env.ts) runs
// by default, and `optimizeFonts` no longer exists (fonts are system stacks,
// see globals.css), so neither option is needed any more.
const nextConfig = {};

export default nextConfig;
