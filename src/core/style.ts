export const STYLE_PRESETS = [
  {
    id: 'none',
    label: 'None',
    detailLabel: '',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'cinematic',
    label: 'Cinematic grade',
    detailLabel: 'Warmth',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'grain',
    label: 'Film grain',
    detailLabel: 'Grain size',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.4,
  },
  {
    id: 'vhs',
    label: 'VHS / retro tape',
    detailLabel: 'Tracking',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'bloom',
    label: 'Bloom / soft glow',
    detailLabel: 'Glow spread',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'aberration',
    label: 'Chromatic aberration',
    detailLabel: 'Separation',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'vignette',
    label: 'Vignette',
    detailLabel: 'Feather',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'mono',
    label: 'Black & white',
    detailLabel: 'Contrast',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'duotone',
    label: 'Duotone',
    detailLabel: 'Contrast',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'glitch',
    label: 'Glitch / RGB split',
    detailLabel: 'Displacement',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
  {
    id: 'diffusion',
    label: 'Soft diffusion / Black Pro-Mist',
    detailLabel: 'Softness',
    detailMin: 0,
    detailMax: 1,
    detailStep: 0.01,
    defaultDetail: 0.5,
  },
] as const;

export type StyleId = (typeof STYLE_PRESETS)[number]['id'];
export interface StyleSettings {
  id: StyleId;
  intensity: number;
  detail: number;
  colorA: string;
  colorB: string;
}

const DEFAULT_STYLE: StyleSettings = {
  id: 'none',
  intensity: 0.7,
  detail: 0.5,
  colorA: '#172448',
  colorB: '#f5bd69',
};
const clamp = (value: unknown, fallback: number, min = 0, max = 1): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const validColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;

export function normalizeStyle(value?: Partial<StyleSettings>): StyleSettings {
  const preset = STYLE_PRESETS.find((item) => item.id === value?.id) ?? STYLE_PRESETS[0];
  return {
    id: preset.id,
    intensity: clamp(value?.intensity, DEFAULT_STYLE.intensity),
    detail: clamp(value?.detail, preset.defaultDetail, preset.detailMin, preset.detailMax),
    colorA: validColor(value?.colorA, DEFAULT_STYLE.colorA),
    colorB: validColor(value?.colorB, DEFAULT_STYLE.colorB),
  };
}

export function hasStyle(value?: StyleSettings): boolean {
  return !!value && value.id !== 'none' && value.intensity > 0;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

export function styleUniforms(value: StyleSettings) {
  const style = normalizeStyle(value);
  return {
    kind: STYLE_PRESETS.findIndex((item) => item.id === style.id),
    intensity: style.intensity,
    detail: style.detail,
    colorA: rgb(style.colorA),
    colorB: rgb(style.colorB),
  };
}

const VERTEX = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// First step of the glow pyramid. Four bilinear taps cover a 4x4 block so the half-size
// copy does not shimmer; bloom keeps only the brights through a soft-knee threshold.
const PREFILTER = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceTex;
uniform vec2 srcTexel;
uniform int kind;
out vec4 outColor;
void main() {
  vec3 c = texture(sourceTex, uv + srcTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, -1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  if (kind == 4) {
    float peak = max(c.r, max(c.g, c.b));
    float threshold = 0.5;
    float knee = 0.25;
    float soft = clamp(peak - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    c *= max(soft, peak - threshold) / max(peak, 0.0001);
  }
  outColor = vec4(c, 1.0);
}`;

// Dual Kawase downsample.
const DOWN = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceTex;
uniform vec2 srcTexel;
out vec4 outColor;
void main() {
  vec3 c = texture(sourceTex, uv).rgb * 4.0;
  c += texture(sourceTex, uv + srcTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, -1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}`;

// Tent upsample of the coarser level, blended with this level's downsample. Higher
// scatter weights the coarse levels more, so the glow spreads wider.
const UP = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceTex;
uniform sampler2D detailTex;
uniform vec2 srcTexel;
uniform float scatter;
out vec4 outColor;
void main() {
  vec3 c = texture(sourceTex, uv).rgb * 4.0;
  c += texture(sourceTex, uv + srcTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture(sourceTex, uv + srcTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture(sourceTex, uv + srcTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture(sourceTex, uv + srcTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, -1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(sourceTex, uv + srcTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(mix(texture(detailTex, uv).rgb, c / 16.0, scatter), 1.0);
}`;

const STYLE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceTex;
uniform sampler2D glowTex;
uniform vec2 texel;
uniform float mediaTime;
uniform float intensity;
uniform float detail;
uniform vec3 colorA;
uniform vec3 colorB;
uniform int kind;
out vec4 outColor;
// Arithmetic hash: sin()-based hashes band on GPUs with low-precision sin. Callers keep
// inputs small (frame counters wrap) so fract() keeps enough precision.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 readAt(vec2 p) { return texture(sourceTex, clamp(p, 0.0, 1.0)).rgb; }
float sCurve(float x, float k) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 0.5 * pow(2.0 * x, k) : 1.0 - 0.5 * pow(2.0 - 2.0 * x, k);
}
vec3 sCurve(vec3 c, float k) { return vec3(sCurve(c.r, k), sCurve(c.g, k), sCurve(c.b, k)); }
float valueNoise(vec2 p, float seed) {
  vec2 i = floor(p) + vec2(seed * 37.0, seed * 17.0);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
vec3 toYiq(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 fromYiq(vec3 c) {
  return vec3(c.x + 0.956 * c.y + 0.621 * c.z, c.x - 0.272 * c.y - 0.647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z);
}
void main() {
  vec3 base = readAt(uv);
  vec3 c = base;
  float l = luma(base);
  vec2 px = uv / texel;
  // 1.0 at 1080 lines, so grain size, scanlines and offsets look the same at any output size.
  float scale = 1.0 / (texel.y * 1080.0);
  float frame = mod(floor(mediaTime * 24.0), 251.0);
  // Geometric styles scale their offsets by intensity; cross-fading a displaced image with
  // the original would only produce a ghost.
  bool geometric = kind == 3 || kind == 5 || kind == 9;
  if (kind == 1) {
    float warm = mix(0.5, 1.5, detail);
    float cool = mix(1.5, 0.5, detail);
    c = mix(base, sCurve(base, 1.35), 0.8);
    float cl = luma(c);
    c += vec3(-0.07, 0.015, 0.06) * (1.0 - smoothstep(0.05, 0.55, cl)) * cool;
    c += vec3(0.08, 0.02, -0.07) * smoothstep(0.35, 0.95, cl) * warm;
    // Richer warm hues (skin), cool hues pulled toward teal.
    float hue = clamp((c.r - c.b) * 3.0, -1.0, 1.0);
    cl = luma(c);
    c = cl + (c - cl) * (1.0 + 0.3 * max(hue, 0.0) * warm);
    c += vec3(-0.06, 0.02, 0.0) * max(-hue, 0.0) * cool;
    c = c * 0.94 + vec3(0.02, 0.04, 0.05);
  } else if (kind == 2) {
    // Soft clumps from two octaves of value noise plus fine per-pixel noise, mostly mono
    // with a little colour, strongest in the midtones like real emulsion.
    vec2 gp = px / max(mix(1.0, 3.0, detail) * scale, 0.75);
    float n = valueNoise(gp, frame) + 0.5 * valueNoise(gp * 2.03 + 11.0, frame + 101.0)
      + 0.5 * hash(px + frame * 7.0);
    vec3 tint = vec3(valueNoise(gp + 31.0, frame), valueNoise(gp + 57.0, frame), valueNoise(gp + 83.0, frame)) - 0.5;
    vec3 g = vec3(n * 0.5 - 0.5) + tint * 0.25;
    c = base + g * 0.22 * mix(0.3, 1.0, 4.0 * l * (1.0 - l));
  } else if (kind == 3) {
    float amt = intensity;
    float row = floor(uv.y * 240.0);
    float tracking = 0.4 + detail * 1.6;
    float wobble = sin(uv.y * 18.0 + mediaTime * 1.7) * 0.0012 + (hash(vec2(row, frame)) - 0.5) * 0.0012;
    // A tracking band rolls up the frame and drags lines sideways; head-switching skew sits
    // on the bottom edge.
    float band = 1.0 - smoothstep(0.0, 0.05, abs(uv.y - fract(-mediaTime * 0.07)));
    float tear = band * (hash(vec2(row, frame + 3.0)) - 0.3) * 0.02;
    float head = 1.0 - smoothstep(0.0, 0.03, uv.y);
    float headShift = head * (0.01 + hash(vec2(row, frame + 9.0)) * 0.02);
    vec2 p = uv + vec2((wobble + tear) * tracking + headShift, 0.0) * amt;
    // Composite video: slightly soft luma, chroma smeared wide and lagging to the right.
    vec2 dx = vec2(texel.x * scale, 0.0);
    float y = toYiq(readAt(p - dx)).x * 0.25 + toYiq(readAt(p)).x * 0.5 + toYiq(readAt(p + dx)).x * 0.25;
    float bleed = 0.003 + 0.004 * amt;
    vec2 iq = vec2(0.0);
    for (int i = 0; i < 6; i++) iq += toYiq(readAt(p - vec2((float(i) - 1.5) * bleed, 0.0))).yz;
    iq = mix(toYiq(readAt(p)).yz, iq / 6.0, amt) * mix(1.0, 0.82, amt);
    c = fromYiq(vec3(y, iq));
    // Tape contrast with lifted blacks, scanlines, and fine noise that varies per line.
    c = mix(c, (c - 0.5) * 1.06 + 0.53, amt);
    float lines = 0.5 + 0.5 * cos(px.y * 6.2831853 / max(4.0 * scale, 2.0));
    c *= 1.0 - 0.12 * amt * lines;
    float noise = (hash(px + frame * 13.0) - 0.5) * 0.05 + (hash(vec2(row, frame + 5.0)) - 0.5) * 0.015;
    c += noise * (1.0 + head) * amt;
  } else if (kind == 4) {
    c = 1.0 - (1.0 - base) * (1.0 - clamp(texture(glowTex, uv).rgb * 2.2, 0.0, 1.0));
  } else if (kind == 5) {
    // Radial fringing, strongest at the corners. Three taps per fringe smear it like a lens
    // instead of leaving a hard ghost.
    vec2 dir = uv - 0.5;
    vec2 off = dir * mix(0.012, 0.05, detail) * intensity * (0.8 + 1.6 * dot(dir, dir));
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float w = float(i) * 0.5;
      acc.r += readAt(uv + off * mix(0.6, 1.0, w)).r;
      acc.g += readAt(uv + off * mix(-0.1, 0.1, w)).g;
      acc.b += readAt(uv - off * mix(0.6, 1.0, w)).b;
    }
    c = acc / 3.0;
  } else if (kind == 6) {
    float d = length((uv - 0.5) * vec2(2.0, 1.8));
    float v = smoothstep(mix(0.75, 0.25, detail), mix(1.1, 1.5, detail), d);
    c *= 1.0 - 0.95 * pow(v, 1.5);
  } else if (kind == 7) {
    // Red-leaning mix, like panchromatic film behind a light yellow filter.
    c = vec3(sCurve(dot(base, vec3(0.35, 0.55, 0.1)), 1.2 + detail * 1.4));
  } else if (kind == 8) {
    c = mix(colorA, colorB, sCurve(l, 1.0 + detail * 1.2));
  } else if (kind == 9) {
    float amt = intensity;
    float tick = mod(floor(mediaTime * 12.0), 997.0);
    // Glitches come in short bursts; intensity and detail both set how often, so low
    // intensity means rare, small glitches rather than frequent faint ones.
    float burst = step(1.0 - (0.06 + 0.3 * detail) * amt, hash(vec2(tick, 3.7)));
    float rows = floor(mix(6.0, 24.0, hash(vec2(tick, 1.3))));
    float band = floor(uv.y * rows);
    float shift = (hash(vec2(band, tick + 7.0)) - 0.5) * 0.06 * burst * step(0.7, hash(vec2(band, tick)));
    vec2 cell = floor(uv * vec2(12.0, rows));
    float cellHash = hash(cell + tick * 13.0);
    vec2 p = uv + vec2(shift * amt, 0.0);
    if (burst > 0.0 && cellHash > 0.96) p += (vec2(hash(cell + 1.7), hash(cell + 2.9)) - 0.5) * 0.05 * amt;
    float split = (0.0015 + burst * 0.008 * hash(vec2(tick, 9.1))) * amt;
    c = vec3(readAt(p + vec2(split, 0.0)).r, readAt(p).g, readAt(p - vec2(split, split * 0.3)).b);
    if (burst > 0.0 && cellHash > 0.985) c = mix(c, floor(c.brg * 4.0) / 4.0, amt);
  } else if (kind == 10) {
    // Black Pro-Mist: highlights bloom into soft halos and light areas lose micro-contrast,
    // while the blacks stay deep.
    vec3 soft = texture(glowTex, uv).rgb;
    vec3 halo = soft * smoothstep(0.3, 0.85, luma(soft)) * (0.7 + 0.8 * detail);
    c = 1.0 - (1.0 - base) * (1.0 - clamp(halo, 0.0, 1.0));
    c = mix(c, max(c, soft), (0.3 + 0.35 * detail) * smoothstep(0.15, 0.75, l));
    c = mix(c, c * 0.95 + 0.03, smoothstep(0.0, 0.4, l));
  }
  c = clamp(c, 0.0, 1.0);
  outColor = vec4(geometric ? c : mix(base, c, intensity), 1.0);
}`;

const GLOW_LEVELS = 5;

function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Video style shader is unavailable.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Video style shader failed.');
    return shader;
  };
  const result = gl.createProgram();
  if (!result) throw new Error('Video style program is unavailable.');
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const pixel = compile(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(result, vertex);
  gl.attachShader(result, pixel);
  gl.linkProgram(result);
  gl.deleteShader(vertex);
  gl.deleteShader(pixel);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(result) ?? 'Video style program failed.');
  return result;
}

interface GlowLevel {
  texture: WebGLTexture;
  buffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export function createStyleRenderer(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const gl = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    alpha: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('Video Style needs WebGL2 in this browser.');
  const source = gl.createTexture();
  if (!source) throw new Error('Video Style could not allocate GPU resources.');
  const prefilter = program(gl, PREFILTER);
  const down = program(gl, DOWN);
  const up = program(gl, UP);
  const styleProgram = program(gl, STYLE);
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const configure = (texture: WebGLTexture) => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  configure(source);
  // downLevels[i] is 1/2^(i+1) of the frame; upLevels[i] matches downLevels[i] in size.
  let downLevels: GlowLevel[] = [];
  let upLevels: GlowLevel[] = [];
  let glowWidth = 0;
  let glowHeight = 0;
  const freeLevels = () => {
    for (const level of [...downLevels, ...upLevels]) {
      gl.deleteTexture(level.texture);
      gl.deleteFramebuffer(level.buffer);
    }
    downLevels = [];
    upLevels = [];
  };
  const level = (width: number, height: number): GlowLevel => {
    const texture = gl.createTexture();
    const buffer = gl.createFramebuffer();
    if (!texture || !buffer) throw new Error('Video Style could not allocate GPU resources.');
    configure(texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Video Style blur buffer is unavailable.');
    return { texture, buffer, width, height };
  };
  const allocateGlow = (width: number, height: number) => {
    if (width === glowWidth && height === glowHeight) return;
    freeLevels();
    glowWidth = width;
    glowHeight = height;
    for (let i = 0; i < GLOW_LEVELS; i++) {
      const w = Math.max(1, Math.ceil(width / 2 ** (i + 1)));
      const h = Math.max(1, Math.ceil(height / 2 ** (i + 1)));
      downLevels.push(level(w, h));
      if (i < GLOW_LEVELS - 1) upLevels.push(level(w, h));
    }
  };
  const uniform = (name: string) =>
    gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram, name);
  const bind = (texture: WebGLTexture | null, unit: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };
  const pass = (target: GlowLevel | null, width: number, height: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.buffer ?? null);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  return {
    draw(
      input: TexImageSource,
      width: number,
      height: number,
      time: number,
      value: StyleSettings,
    ): void {
      if (gl.isContextLost()) throw new Error('Video Style graphics context was lost.');
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.bindVertexArray(vertexArray);
      const mapped = styleUniforms(value);
      const glowing = mapped.kind === 4 || mapped.kind === 10;
      // Allocating binds new textures to the active unit, so it must run before the
      // source frame is bound.
      if (glowing) allocateGlow(width, height);
      bind(source, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
      if (glowing) {
        gl.useProgram(prefilter);
        gl.uniform1i(uniform('sourceTex'), 0);
        gl.uniform2f(uniform('srcTexel'), 1 / width, 1 / height);
        gl.uniform1i(uniform('kind'), mapped.kind);
        pass(downLevels[0]!, downLevels[0]!.width, downLevels[0]!.height);
        gl.useProgram(down);
        gl.uniform1i(uniform('sourceTex'), 0);
        for (let i = 1; i < GLOW_LEVELS; i++) {
          const from = downLevels[i - 1]!;
          bind(from.texture, 0);
          gl.uniform2f(uniform('srcTexel'), 1 / from.width, 1 / from.height);
          pass(downLevels[i]!, downLevels[i]!.width, downLevels[i]!.height);
        }
        gl.useProgram(up);
        gl.uniform1i(uniform('sourceTex'), 0);
        gl.uniform1i(uniform('detailTex'), 1);
        // Bloom spreads wide; diffusion stays tighter so it softens rather than glows.
        gl.uniform1f(
          uniform('scatter'),
          mapped.kind === 4 ? 0.55 + mapped.detail * 0.33 : 0.5 + mapped.detail * 0.3,
        );
        for (let i = GLOW_LEVELS - 2; i >= 0; i--) {
          const from = i === GLOW_LEVELS - 2 ? downLevels[i + 1]! : upLevels[i + 1]!;
          bind(from.texture, 0);
          bind(downLevels[i]!.texture, 1);
          gl.uniform2f(uniform('srcTexel'), 1 / from.width, 1 / from.height);
          pass(upLevels[i]!, upLevels[i]!.width, upLevels[i]!.height);
        }
      }
      gl.useProgram(styleProgram);
      bind(source, 0);
      bind(upLevels[0]?.texture ?? null, 1);
      gl.uniform1i(uniform('sourceTex'), 0);
      gl.uniform1i(uniform('glowTex'), 1);
      gl.uniform2f(uniform('texel'), 1 / width, 1 / height);
      gl.uniform1f(uniform('mediaTime'), time);
      gl.uniform1f(uniform('intensity'), mapped.intensity);
      gl.uniform1f(uniform('detail'), mapped.detail);
      gl.uniform3fv(uniform('colorA'), mapped.colorA);
      gl.uniform3fv(uniform('colorB'), mapped.colorB);
      gl.uniform1i(uniform('kind'), mapped.kind);
      pass(null, width, height);
    },
    destroy(): void {
      freeLevels();
      gl.deleteTexture(source);
      for (const item of [prefilter, down, up, styleProgram]) gl.deleteProgram(item);
      gl.deleteVertexArray(vertexArray);
    },
  };
}
