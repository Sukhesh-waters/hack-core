/**
 * Test stub for the `server-only` marker package. The real package throws on
 * import outside a React Server Components bundler; under Vitest (node) the
 * marker is meaningless, so it resolves here instead. Production bundles
 * still get the real guard.
 */
export {};
