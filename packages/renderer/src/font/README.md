# The glyph atlas

`inter-regular.png` and `inter-regular.json` are build output, committed rather than generated,
because nothing in the app imports the generator and a bake that runs on every install would make
a clean checkout depend on a native tool.

## Re-baking

Needs [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen), which is in homebrew-core:

```bash
brew install msdf-atlas-gen
```

Then, from this folder:

```bash
msdf-atlas-gen -font Inter-Regular.ttf -charset charset.txt -type msdf -size 48 -pxrange 4 -pots -yorigin top -format png -imageout inter-regular.png -json inter-regular.json
```

Every flag in that line is load bearing:

- **`-type msdf`** is the whole point. A multi-channel field lets the shader take the median of
  three channels and keep a corner sharp, where a single channel field rounds every corner off.
- **`-yorigin top`** matches the scene, which is y-down with the origin at a node's top left. The
  default is bottom-up, and a bottom-up atlas parses, packs and draws perfectly happily, upside
  down. `parseAtlasMetrics` refuses it for that reason, and `metrics.test.ts` has a test that
  fails on the flip rather than on the flag.
- **`-size 48`** is the em size the field is sampled at. It bounds how much fine detail survives,
  not how sharp the result is: sharpness comes from the field being resolution independent, which
  is why text stays exact at 400% zoom. Dropping to 32 would quarter the atlas and cost only the
  tightest corners.
- **`-pxrange 4`** is the width of the distance field in atlas pixels, and the shader divides by
  it to turn distance into coverage. Change it here and the text goes soft or crunchy, with
  nothing in the code to say why. It travels in the JSON as `atlas.distanceRange` and reaches the
  shader per instance, so the two can never disagree.
- **`-pots`** keeps the texture power of two.

## What it costs

512 x 512, so 172 KB of PNG on disk and **1 MB on the GPU** as `rgba8unorm`, uploaded once at
startup and never touched again. That is the whole memory budget for text.

The texture is emphatically not `rgba8unorm-srgb`: it stores distances, not colour, and letting
the hardware apply a transfer curve to a distance field distorts every edge.

## What is in it

`charset.txt` holds the coverage: ASCII, the Latin-1 supplement, curly quotes, dashes, ellipsis,
bullet, euro and trademark. 203 glyphs.

Two requested code points are not in the font and are absent on purpose:

- **U+00AD**, the soft hyphen, which is an invisible line-break hint rather than a mark.
- **U+FFFD**, the replacement character, which Inter does not draw. That is why the fallback for
  an uncovered code point is a question mark instead. Typing Japanese produces a run of them,
  which is the honest result for a Latin-1 atlas: visible, and clearly not what you typed.

There is **no kerning**. Inter keeps its pairs in GPOS, and the generator only reads the legacy
`kern` table, so `kerning` in the JSON comes back empty. Real kerning needs proper shaping and is
deferred with the rest of it, in `TASKS.md`.

## The font

Inter 4.1 Regular, from the [official release](https://github.com/rsms/inter/releases/tag/v4.1),
under the SIL Open Font License 1.1. `OFL.txt` is the licence as shipped. `Inter-Regular.ttf` is
here only so the bake above can be repeated; nothing loads it at runtime.
