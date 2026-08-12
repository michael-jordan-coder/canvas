// Every rectangle, rounded rectangle, frame and ellipse in the document, drawn as one quad
// each in a single instanced draw call. The quad is always the same four corners. What the
// shape actually is gets decided per pixel in the fragment stage by a signed distance
// function, which is why nothing here is ever re-tessellated and why edges stay exact at
// any zoom.

struct Camera {
  clipFromWorld: mat3x3f,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct Instance {
  // The linear part of the node's world transform: a, b, c, d.
  @location(0) linear: vec4f,
  // Translation in xy, the node's size in zw.
  @location(1) originSize: vec4f,
  @location(2) color: vec4f,
  // Corner radius, then shape kind: 0 rectangular, 1 elliptical.
  @location(3) params: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  // Position inside the shape in its own units, 0 to size. The SDF is evaluated in this
  // space, so it is unaffected by where the node sits or how far the view is zoomed.
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) size: vec2f,
  @location(2) @interpolate(flat) color: vec4f,
  @location(3) @interpolate(flat) params: vec2f,
}

const CORNERS = array(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) index: u32, instance: Instance) -> VertexOutput {
  let size = instance.originSize.zw;
  let local = CORNERS[index] * size;

  let worldFromLocal = mat3x3f(
    vec3f(instance.linear.xy, 0.0),
    vec3f(instance.linear.zw, 0.0),
    vec3f(instance.originSize.xy, 1.0),
  );
  let clip = camera.clipFromWorld * worldFromLocal * vec3f(local, 1.0);

  var out: VertexOutput;
  out.position = vec4f(clip.xy, 0.0, 1.0);
  out.local = local;
  out.size = size;
  out.color = instance.color;
  out.params = instance.params.xy;
  return out;
}

// Distance from p to a box of half extent `half` with corner radius r. Negative inside.
fn sdRoundedBox(p: vec2f, half: vec2f, r: f32) -> f32 {
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

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let half = in.size * 0.5;
  let p = in.local - half;

  var d: f32;
  if in.params.y > 0.5 {
    d = sdEllipse(p, half);
  } else {
    // A radius larger than the shortest side would turn the corners inside out.
    d = sdRoundedBox(p, half, min(in.params.x, min(half.x, half.y)));
  }

  // fwidth is how much d changes between neighbouring pixels, which is the width of one
  // screen pixel expressed in the shape's own units. Dividing the distance by it converts
  // distance into coverage at whatever zoom the view happens to be at, so the same shader
  // antialiases correctly at 2% and at 6400% with nothing to recompute.
  let coverage = clamp(0.5 - d / max(fwidth(d), 1e-6), 0.0, 1.0);

  return vec4f(in.color.rgb, in.color.a * coverage);
}
