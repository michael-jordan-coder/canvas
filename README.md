# figma-canvas

A reverse engineering of Figma. The canvas is drawn with WebGPU, the panels around it are React.

```
packages/document   the scene: nodes, transforms, paints. plain TypeScript.
packages/renderer   WebGPU renderer and camera.
apps/editor         React editor shell.
```

```
pnpm install
pnpm dev
```

Requires a browser with WebGPU: Chrome, Edge or Safari 26. Firefox needs the flag on macOS.

See `CLAUDE.md` for the architecture and why the layers are separated the way they are.
