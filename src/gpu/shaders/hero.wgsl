struct Params {
  time: f32,
  intensity: f32,
  mouse: vec2f,
  texel: vec2f,
  mouseVelocity: vec2f,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let smoothValue = local * local * (3.0 - 2.0 * local);
  let lower = mix(hash(cell), hash(cell + vec2f(1.0, 0.0)), smoothValue.x);
  let upper = mix(hash(cell + vec2f(0.0, 1.0)), hash(cell + vec2f(1.0, 1.0)), smoothValue.x);
  return mix(lower, upper, smoothValue.y);
}

fn turbulence(point: vec2f) -> f32 {
  let first = noise(point);
  let second = noise(point * 2.03 + vec2f(4.2, -1.6));
  let third = noise(point * 4.07 + vec2f(-2.4, 3.8));
  return first * 0.56 + second * 0.29 + third * 0.15;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = params.texel.y / max(params.texel.x, 0.0001);
  let centered = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let pointer = (params.mouse - vec2f(0.5)) * vec2f(aspect, 1.0);
  let pointerVelocity = params.mouseVelocity * vec2f(aspect, 1.0);
  let time = params.time * 0.08;
  let distanceToPointer = centered - pointer;
  let pointerDistance = length(distanceToPointer);
  let pointerField = exp(-pointerDistance * 3.0) * params.intensity;
  let velocityStrength = length(pointerVelocity);
  let velocityDirection = pointerVelocity / max(velocityStrength, 0.0001);
  let velocityWake = exp(-pointerDistance * 2.1) * min(velocityStrength * 5.0, 1.0);
  let swirl = vec2f(-distanceToPointer.y, distanceToPointer.x) * pointerField * (0.72 + velocityStrength * 1.7);
  let streak = velocityDirection * velocityWake * 0.24;
  let drift = vec2f(sin(time * 0.72), cos(time * 0.55)) * 0.07;
  let warped = centered + drift + swirl + streak + vec2f(sin(centered.y * 7.0 + time), cos(centered.x * 6.0 - time)) * 0.035;
  let grain = turbulence(warped * 3.7 + vec2f(time * 1.3, -time * 0.9));
  let ribbons = turbulence(warped * 7.0 + vec2f(-time * 0.75, time * 0.5));
  let pointerGlow = exp(-pointerDistance * 5.0) * (0.42 + velocityWake * 0.8) * params.intensity;
  let coreGlow = exp(-distance(warped, vec2f(0.12, -0.04)) * 5.0) * 0.24;
  let scan = smoothstep(0.04, 0.0, abs(fract(uv.y * 5.0 + time * 0.08) - 0.5)) * 0.018;

  let cyan = vec3f(0.02, 0.42, 0.7);
  let blue = vec3f(0.04, 0.09, 0.32);
  let violet = vec3f(0.3, 0.08, 0.56);
  let magenta = vec3f(0.68, 0.04, 0.38);
  let verticalBlend = smoothstep(-0.7, 0.72, warped.y);
  let colorBand = mix(mix(cyan, blue, verticalBlend), mix(violet, magenta, verticalBlend), grain * 1.15);
  let color = colorBand * (0.96 + ribbons * 1.2 + velocityWake * 0.7) + (cyan + magenta) * (pointerGlow + coreGlow + scan);
  let vignette = smoothstep(1.05, 0.12, length(centered * vec2f(0.75, 0.9)));

  return vec4f(color * vignette * params.intensity * 2.45, 1.0);
}