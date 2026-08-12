// The selection overlay: an outline around what is selected, and eight resize handles.
//
// Everything here is measured in CSS pixels rather than world units, which is the whole
// point. A handle must be the same size on screen at 10% and at 3000%, and a one pixel
// outline must stay one pixel. Geometry built in world space cannot do that, so this
// pipeline takes a pixels to clip matrix and never sees the camera at all.

struct Screen {
  clipFromPixels: mat3x3f,
}

@group(0) @binding(0) var<uniform> screen: Screen;

struct Instance {
  // x, y, width, height in CSS pixels.
  @location(0) rect: vec4f,
  @location(1) fill: vec4f,
  @location(2) stroke: vec4f,
  // Stroke width, corner radius.
  @location(3) params: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) half: vec2f,
  @location(2) @interpolate(flat) fill: vec4f,
  @location(3) @interpolate(flat) stroke: vec4f,
  @location(4) @interpolate(flat) params: vec2f,
}

const CORNERS = array(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) index: u32, instance: Instance) -> VertexOutput {
  let half = instance.rect.zw * 0.5;
  let centre = instance.rect.xy + half;

  // A stroke sits centred on the boundary, so half of it falls outside the rect. The quad
  // is grown to cover that plus a pixel and a half for the antialiasing to fade into,
  // otherwise the outer edge of every outline is clipped flat.
  let pad = instance.params.x * 0.5 + 1.5;
  let local = (CORNERS[index] * 2.0 - 1.0) * (half + pad);

  let clip = screen.clipFromPixels * vec3f(centre + local, 1.0);

  var out: VertexOutput;
  out.position = vec4f(clip.xy, 0.0, 1.0);
  out.local = local;
  out.half = half;
  out.fill = instance.fill;
  out.stroke = instance.stroke;
  out.params = instance.params.xy;
  return out;
}

fn sdRoundedBox(p: vec2f, half: vec2f, r: f32) -> f32 {
  let clamped = min(r, min(half.x, half.y));
  let q = abs(p) - half + vec2f(clamped);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - clamped;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let d = sdRoundedBox(in.local, in.half, in.params.y);
  let w = max(fwidth(d), 1e-6);

  let fillCoverage = clamp(0.5 - d / w, 0.0, 1.0);
  // A stroke is the band where the distance is near zero, which is why an outline costs the
  // same as a fill here: abs(d) - width/2 is the distance to the band instead of to the shape.
  let strokeCoverage = clamp(0.5 - (abs(d) - in.params.x * 0.5) / w, 0.0, 1.0);

  let fillAlpha = in.fill.a * fillCoverage;
  let strokeAlpha = in.stroke.a * strokeCoverage;

  // Stroke composited over fill, straight alpha.
  let alpha = strokeAlpha + fillAlpha * (1.0 - strokeAlpha);
  if alpha <= 0.0 {
    discard;
  }
  let rgb =
    (in.stroke.rgb * strokeAlpha + in.fill.rgb * fillAlpha * (1.0 - strokeAlpha)) / alpha;

  return vec4f(rgb, alpha);
}
