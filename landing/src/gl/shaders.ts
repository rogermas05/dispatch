/** Fullscreen triangle: no vertex buffer layout to get wrong, no diagonal seam. */
export const VERTEX_SHADER = /* glsl */ `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * The signal: a handful of glowing voice lines over a slow nebula.
 *
 * Each line is a distance field. The same field can be measured against a flat
 * line (a waveform) or a circle (the closing orb); uRing blends between the two
 * distances, which is what makes the lines appear to wrap into a ring.
 */
export const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseOn;
uniform float uAmp;
uniform float uChaos;
uniform float uSplit;
uniform float uQuant;
uniform float uRing;
uniform float uBright;
uniform float uY;
uniform float uVel;
uniform float uIntro;
uniform vec3 uColA;
uniform vec3 uColB;

const float LINES = 6.0;
const float QUANT_STEPS = 30.0;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 17.0;
    amplitude *= 0.5;
  }
  return value;
}

// Speech comes in bursts: an envelope travels along the line and gates the wave.
float voice(float x, float i, float t) {
  float envelope = 0.3 + 0.7 * smoothstep(0.25, 0.75, noise(vec2(x * 0.9 - t * 0.35, i * 3.1 + t * 0.05)));
  float wave = sin(x * 2.6 + t * 0.8 + i * 1.3) * 0.55
             + sin(x * 5.9 - t * 1.25 + i * 2.7) * 0.3
             + sin(x * 12.4 + t * 2.1 + i * 0.6) * 0.15 * uChaos;
  float grit = (noise(vec2(x * 2.2 + i * 5.3, t * 0.6 + i)) - 0.5) * 1.4 * uChaos;
  return (wave + grit) * envelope;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec2 mouse = (uMouse - 0.5) * vec2(aspect, 1.0);

  // Deep field: two warped noise layers tinted by the current palette.
  vec3 color = vec3(0.010, 0.013, 0.017);
  float cloud = fbm(uv * 1.3 + vec2(t * 0.02, -t * 0.015));
  float cloudFine = fbm(uv * 2.6 - vec2(t * 0.03, 0.0) + cloud);
  color += uColA * 0.055 * smoothstep(0.35, 0.9, cloudFine) * uBright;
  color += uColB * 0.035 * smoothstep(0.5, 1.0, cloud) * uBright;

  // Sparse stars with a slow twinkle.
  vec2 starGrid = gl_FragCoord.xy / uRes.y * 90.0;
  float starSeed = hash(floor(starGrid));
  float star = step(0.992, starSeed) * smoothstep(0.35, 0.0, length(fract(starGrid) - 0.5));
  color += star * (0.5 + 0.5 * sin(t * 1.5 + starSeed * 40.0)) * 0.3;

  float x = mix(uv.x, (floor(uv.x * QUANT_STEPS) + 0.5) / QUANT_STEPS, uQuant);
  float angle = atan(uv.y, uv.x);
  // On a portrait screen the ring would spill past the sides, so it scales to the narrow axis.
  float radius = length(uv) / min(1.0, aspect * 0.92);
  vec2 onCircle = vec2(cos(angle), sin(angle));

  float mouseBump = uMouseOn * exp(-pow((uv.x - mouse.x) * 2.2, 2.0));
  float amplitude = uAmp * (0.2 + 0.8 * uIntro) * (1.0 + min(abs(uVel) * 0.012, 0.6));
  float pixel = 1.5 / uRes.y;

  vec3 lines = vec3(0.0);
  for (float i = 0.0; i < LINES; i += 1.0) {
    float fi = i / (LINES - 1.0);
    float spread = (fi - 0.5) * 0.11 * (1.0 + uSplit * 1.6);

    float wave = voice(x * 1.15, i, t) * amplitude * (1.0 + mouseBump * 0.9);
    float flatDistance = uv.y - uY - spread - wave - mouseBump * (mouse.y - uY) * 0.22;

    float ringWave = (sin(angle * 3.0 + t * 0.7 + i) * 0.5
                    + sin(angle * 7.0 - t * 1.1 + i * 2.0) * 0.3
                    + (noise(onCircle * 1.8 + vec2(i * 3.0, t * 0.4)) - 0.5) * 1.2) * amplitude * 0.42;
    float ringDistance = radius - (0.25 + fi * 0.075) - ringWave;

    float d = abs(mix(flatDistance, ringDistance, uRing));
    float core = smoothstep(pixel * 1.6, 0.0, d);
    float halo = 0.0016 / (d + 0.0035);
    float aura = exp(-d * 9.0) * 0.05;

    float side = mix(fi, step(0.5, fi), uSplit);
    vec3 lineColor = mix(uColA, uColB, side);
    float weight = 0.55 + 0.45 * sin(i * 1.7 + t * 0.3);
    lines += lineColor * (core * 0.9 + halo + aura) * weight;
  }
  color += lines * uBright * (0.3 + 0.7 * uIntro);

  color *= 1.0 - 0.55 * smoothstep(0.45, 1.25, length(uv * vec2(0.8, 1.1)));
  color = 1.0 - exp(-color * 1.5);
  color += (hash(gl_FragCoord.xy + fract(t) * 100.0) - 0.5) * 0.022;

  gl_FragColor = vec4(color, 1.0);
}
`;
