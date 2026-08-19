/**
 * Baked font assets are loaded by URL and fetched at startup. Declared here rather than
 * pulling in `vite/client`, for the same reason `wgsl.d.ts` does it: the renderer package
 * stays independent of the bundler that happens to build it.
 */
declare module '*.png?url' {
  const url: string
  export default url
}

declare module '*.json?url' {
  const url: string
  export default url
}
