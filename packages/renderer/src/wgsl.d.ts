/**
 * Shaders are imported as source strings with `?raw`. Declared here rather than pulling in
 * `vite/client`, so the renderer package stays independent of the bundler that happens to
 * build it. Any bundler supporting the `?raw` suffix satisfies this.
 */
declare module '*.wgsl?raw' {
  const source: string
  export default source
}
