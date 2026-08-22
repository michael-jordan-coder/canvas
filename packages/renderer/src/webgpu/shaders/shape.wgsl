// Every rectangle, rounded rectangle, frame and ellipse in the document, drawn as one quad
// each in a single instanced draw call. The quad is always the same four corners. What the
// shape actually is gets decided per pixel in the fragment stage by a signed distance
// function, which is why nothing here is ever re-tessellated and why edges stay exact at
// any zoom.
//
// A stroke is a second instance of the same shape rather than an extra field on the first.
// Given the distance function an outline is just a band around d = 0, so the only thing a
// stroke instance carries beyond a fill is its weight and where the band sits. Nodes without
// a stroke pay nothing for the feature, and the stroke lands in painter's order next to the
// fill it belongs to.

struct Camera {
  clipFromWorld: mat3x3f,
}

@group(0) @binding(0) var<uniform> camera: Camera;

// One entry per clipping frame in view. `parent` chains outward, so a node inside two
// nested clipping frames is tested against both by walking the chain rather than by the
// CPU intersecting rectangles, which would be wrong the moment a frame is scaled.
//
// Laid out to mirror an instance: the linear part of a transform, then origin and size, then
// the four corner radii. A `mat3x3f` here would spend five of the sixteen floats on the
// padding its columns require, and the matrix is cheap to rebuild from vectors below.
struct Clip {
  // a, b, c, d of the frame's inverse world transform.
  linearInverse: vec4f,
  // Its translation in xy, the frame's size in zw.
  originSize: vec4f,
  radii: vec4f,
  // The enclosing clip in x, or -1. The rest is the padding a vec4f wants anyway.
  parent: vec4f,
}

@group(1) @binding(0) var<storage, read> clips: array<Clip>;

// The baked glyph atlas. Text is not a separate pipeline: a glyph is one more instance in
// the same buffer, so it lands in painter's order beside the shapes it is drawn among and a
// rectangle on top of a word actually covers it.
@group(2) @binding(0) var atlas: texture_2d<f32>;
@group(2) @binding(1) var atlasSampler: sampler;

// A malformed chain must not hang the GPU. Nothing real nests this deep.
const MAX_CLIP_DEPTH = 8;

// What an instance is, read from params.y: 0 rectangular, 1 elliptical, 2 a glyph. Tested by
// midpoint below rather than by equality, so a future kind cannot alias onto an existing one.

struct Instance {
  // The linear part of the node's world transform: a, b, c, d.
  @location(0) linear: vec4f,
  // Translation in xy, the node's size in zw.
  @location(1) originSize: vec4f,
  @location(2) color: vec4f,
  // A spare slot, shape kind, stroke weight, stroke offset. Weight 0 means a fill. The
  // spare held the corner radius until there were four of them; it is reserved for the
  // index of this instance's gradient.
  //
  // A glyph reuses the three slots that mean nothing to it: params.x and params.z are the
  // top left of its patch of the atlas and params.w is the right edge, with the bottom edge
  // and the distance range over in flags. That is the whole reason text needs no second
  // vertex format and no second draw call.
  @location(3) params: vec4f,
  // Index into `clips`, or -1. Then, for a glyph, the atlas bottom edge and distance range.
  // flags.w is a bitfield of the features this instance uses, zero for all of them today.
  @location(4) flags: vec4f,
  // Corner radii, already resolved on the CPU: top left, top right, bottom right, bottom
  // left, clockwise from the origin. Zero on an ellipse and on a glyph.
  @location(5) radii: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  // Position inside the shape in its own units, 0 to size for a fill and reaching past both
  // ends for an outward stroke. The SDF is evaluated in this space, so it is unaffected by
  // where the node sits or how far the view is zoomed.
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) size: vec2f,
  @location(2) @interpolate(flat) color: vec4f,
  @location(3) @interpolate(flat) params: vec4f,
  // World position, so the fragment stage can ask where this pixel falls inside a clipping
  // frame. Interpolated rather than recovered from the local position, which would mean
  // rebuilding the node's matrix per pixel.
  @location(4) world: vec2f,
  @location(5) @interpolate(flat) clip: f32,
  // Where in the atlas this pixel falls. Meaningless on a shape instance, which never reads it.
  @location(6) uv: vec2f,
  // Width of the glyph's distance field, in atlas pixels. Also meaningless on a shape.
  @location(7) @interpolate(flat) pxRange: f32,
  @location(8) @interpolate(flat) radii: vec4f,
  // The feature bitfield, carried as a float and read as a u32. Nothing sets a bit yet, so
  // nothing reads it yet either; it is forwarded now because the alternative is a stride
  // change later, and this is the phase that pays for one.
  @location(9) @interpolate(flat) bits: f32,
}

const CORNERS = array(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 1.0),
);

// How far the band reaches past the shape's edge: half a weight for a centred stroke, a
// whole one for an outside stroke, nothing for an inside one or a fill.
fn outset(params: vec4f) -> f32 {
  // A glyph's quad is exactly its patch of the atlas, and the slots this reads hold texture
  // coordinates rather than a stroke. Padding by them would grow every letter by a fraction
  // of its own size, which looks like imprecision rather than like a bug.
  if params.y > 1.5 {
    return 0.0;
  }
  return max(0.0, params.w + params.z * 0.5);
}

@vertex
fn vs(@builtin(vertex_index) index: u32, instance: Instance) -> VertexOutput {
  let size = instance.originSize.zw;
  // The quad has to cover everything the fragment stage will draw, and an outward stroke
  // reaches past the node's own box. Growing the quad instead of the shape keeps `size` the
  // node's real size, so the SDF below is unchanged.
  let pad = outset(instance.params);
  let local = CORNERS[index] * (size + 2.0 * pad) - pad;

  let worldFromLocal = mat3x3f(
    vec3f(instance.linear.xy, 0.0),
    vec3f(instance.linear.zw, 0.0),
    vec3f(instance.originSize.xy, 1.0),
  );
  let world = worldFromLocal * vec3f(local, 1.0);
  let clip = camera.clipFromWorld * world;

  var out: VertexOutput;
  out.position = vec4f(clip.xy, 0.0, 1.0);
  out.local = local;
  out.size = size;
  out.color = instance.color;
  out.params = instance.params;
  out.world = world.xy;
  out.clip = instance.flags.x;
  // Interpolated across the quad rather than unpacked per pixel, so the fragment stage never
  // has to know which slots the atlas rect was folded into.
  let uv0 = vec2f(instance.params.x, instance.params.z);
  let uv1 = vec2f(instance.params.w, instance.flags.y);
  out.uv = mix(uv0, uv1, CORNERS[index]);
  out.pxRange = instance.flags.z;
  out.radii = instance.radii;
  out.bits = instance.flags.w;
  return out;
}

// Distance from p to a box of half extent `half`, negative inside. `radii` is top left, top
// right, bottom right, bottom left, resolved on the CPU so no two of them overlap.
//
// Picking the corner before the abs below is the whole trick: abs folds all four quadrants
// onto one and takes the only evidence of which corner this pixel is nearest with it. Both
// selects compile to a bitwise select rather than a branch, so there is no divergence and
// this stays callable from inside the clip walk.
fn sdRoundedBox(p: vec2f, half: vec2f, radii: vec4f) -> f32 {
  let pair = select(radii.wz, radii.xy, p.y < 0.0);   // top (tl, tr) or bottom (bl, br)
  var r = select(pair.y, pair.x, p.x < 0.0);          // its left member or its right one
  // Last-ditch guard, and the reason it lives here rather than at the call sites: a radius
  // past the shortest half extent puts the arc's centre outside the box and turns the corner
  // inside out. It used to be written out at both callers and inside the TypeScript twin,
  // three copies agreeing by accident.
  r = min(r, min(half.x, half.y));
  let q = abs(p) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Approximate, because the exact distance to an ellipse needs a quartic root. The error is
// a fraction of a pixel at the boundary, which is the only place the coverage test looks.
fn sdEllipse(p: vec2f, r: vec2f) -> f32 {
  let k2 = length(p / (r * r));
  // Dead centre: k1 and k2 are both zero and the ratio below is 0/0.
  if k2 == 0.0 {
    return -min(r.x, r.y);
  }
  let k1 = length(p / r);
  return (k1 - 1.0) * k1 / k2;
}

/**
 * How much of this pixel survives every clipping frame it sits inside.
 *
 * `dx` and `dy` are how far the world position moves between neighbouring pixels, taken once
 * by the caller. They have to come from outside: derivatives are only defined in uniform
 * control flow, and this walk is anything but. Pushing them through each frame's inverse
 * gives the pixel's footprint in that frame's own units, which is what fwidth would have
 * returned had it been legal to call here.
 */
fn clipCoverage(start: f32, world: vec2f, dx: vec2f, dy: vec2f) -> f32 {
  var coverage = 1.0;
  var index = i32(start);

  for (var depth = 0; depth < MAX_CLIP_DEPTH; depth += 1) {
    if index < 0 {
      break;
    }
    let clip = clips[index];
    let half = clip.originSize.zw * 0.5;
    // Rebuilt per iteration from vectors the loop is loading anyway, which costs nothing the
    // compiler does not hoist and saves the record five floats of column padding.
    let worldInverse = mat3x3f(
      vec3f(clip.linearInverse.xy, 0.0),
      vec3f(clip.linearInverse.zw, 0.0),
      vec3f(clip.originSize.xy, 1.0),
    );

    let p = (worldInverse * vec3f(world, 1.0)).xy - half;
    // Directions, so the translation column is left out.
    let lx = (worldInverse * vec3f(dx, 0.0)).xy;
    let ly = (worldInverse * vec3f(dy, 0.0)).xy;

    let d = sdRoundedBox(p, half, clip.radii);
    let fw = max(length(lx) + length(ly), 1e-6);
    coverage *= clamp(0.5 - d / fw, 0.0, 1.0);

    index = i32(clip.parent.x);
  }

  return coverage;
}

/** The true distance, from three channels that each carry the distance to a different edge. */
fn median(v: vec3f) -> f32 {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

/**
 * Coverage for one pixel of a glyph.
 *
 * A single channel field rounds off anything sharper than its own radius, which is why the
 * corner of a letter reads as soft at high zoom. Taking the median of three recovers the
 * corner, and it is the whole reason the atlas is baked multi-channel.
 *
 * `footprint` is how far the texture coordinate moves between neighbouring pixels, taken by
 * the caller for the same reason the clip walk takes its own: this runs inside a branch, and
 * a derivative there is not defined. `textureSampleLevel` rather than `textureSample` for
 * exactly the same reason, since the plain one would compute a derivative internally. It
 * also wants no mipmaps, and level 0 says so.
 */
fn glyphCoverage(uv: vec2f, pxRange: f32, footprint: vec2f) -> f32 {
  let distance = median(textureSampleLevel(atlas, atlasSampler, uv, 0.0).rgb);

  // How many screen pixels the distance range covers here. This is the only place the zoom
  // enters: the field itself is resolution independent, and this converts it to the scale
  // the view happens to be at. Clamped at one, below which a glyph is smaller than the field
  // is wide and would otherwise dissolve rather than just look small.
  let unitRange = vec2f(pxRange) / vec2f(textureDimensions(atlas, 0));
  let screenPerTexel = vec2f(1.0) / max(footprint, vec2f(1e-8));
  let range = max(0.5 * dot(unitRange, screenPerTexel), 1.0);

  return clamp((distance - 0.5) * range + 0.5, 0.0, 1.0);
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  // Every derivative in this function is taken here, at the top, before anything branches.
  // They are only defined in uniform control flow, and all three are needed from inside one:
  // the clip walk is a loop, and the glyph path below is a branch on an interpolated value,
  // which the compiler treats as non-uniform however uniform it is in practice.
  let dWorldX = dpdx(in.world);
  let dWorldY = dpdy(in.world);
  let uvFootprint = abs(dpdx(in.uv)) + abs(dpdy(in.uv));

  let half = in.size * 0.5;
  let p = in.local - half;

  var d = 0.0;
  if in.params.y < 0.5 {
    d = sdRoundedBox(p, half, in.radii);
  } else if in.params.y < 1.5 {
    d = sdEllipse(p, half);
  }

  // fwidth is how much d changes between neighbouring pixels, which is the width of one
  // screen pixel expressed in the shape's own units. Dividing the distance by it converts
  // distance into coverage at whatever zoom the view happens to be at, so the same shader
  // antialiases correctly at 2% and at 6400% with nothing to recompute.
  //
  // Taken here, on the raw distance, rather than after the band is folded below. abs() has
  // a crease down the middle of the band where the gradient flips, and fwidth across that
  // one row of pixels reads as enormous, which would draw a soft seam along the centre of
  // every thick stroke.
  let fw = max(fwidth(d), 1e-6);

  var coverage: f32;
  if in.params.y > 1.5 {
    coverage = glyphCoverage(in.uv, in.pxRange, uvFootprint);
  } else {
    let weight = in.params.z;
    if weight > 0.0 {
      // Keep the outer edge exactly where the quad was padded for and let a sub-pixel stroke
      // grow inward instead. Widening both ways would push the band past the quad at low zoom
      // and slice the outside of a hairline off.
      let outer = in.params.w + weight * 0.5;
      let thickness = max(weight, fw);
      d = abs(d - (outer - thickness * 0.5)) - thickness * 0.5;
    }
    coverage = clamp(0.5 - d / fw, 0.0, 1.0);
  }

  coverage *= clipCoverage(in.clip, in.world, dWorldX, dWorldY);

  // Premultiplied, and the pipeline's blend state expects it. Straight alpha survives a
  // source-over blend but is wrong for every other one: `screen` reads the colour channels
  // directly, so an antialiased edge at half coverage would contribute its full colour and
  // draw a dark fringe around every shape.
  let a = in.color.a * coverage;
  return vec4f(in.color.rgb * a, a);
}
