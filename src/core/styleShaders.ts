export const VERTEX = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const PREPARE = `#version 300 es
precision highp float;
uniform sampler2D sourceTex;
uniform mat3 outputToSource;
uniform vec2 sourceSize;
uniform vec2 outputSize;
out vec4 outColor;
void main() {
  // GL framebuffer pixels start at the bottom; canvas pixel coordinates start at the top.
  vec2 outputPixel = vec2(gl_FragCoord.x, outputSize.y - gl_FragCoord.y);
  vec2 sourcePixel = (outputToSource * vec3(outputPixel, 1.0)).xy;
  if (any(lessThan(sourcePixel, vec2(0.0))) || any(greaterThan(sourcePixel, sourceSize))) {
    outColor = vec4(0.0);
    return;
  }
  outColor = texture(sourceTex, vec2(sourcePixel.x / sourceSize.x, 1.0 - sourcePixel.y / sourceSize.y));
}`;

const CORRECTION = `
uniform vec4 correction;
vec3 correctColor(vec3 c) {
  if (all(equal(correction, vec4(1.0, 1.0, 1.0, 0.0)))) return c;
  vec3 linear = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  linear *= correction.x * vec3(1.0 + correction.w * 0.15, 1.0, 1.0 - correction.w * 0.15);
  c = mix(linear * 12.92, 1.055 * pow(max(linear, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linear));
  c = (c - 0.5) * correction.y + 0.5;
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, correction.z);
  return clamp(c, 0.0, 1.0);
}`;

// Threshold each bilinear tap before averaging so small highlights survive the half-size copy.
export const PREFILTER = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceTex;
uniform vec2 srcTexel;
uniform int kind;
out vec4 outColor;
${CORRECTION}
vec3 bright(vec3 c) {
  c = correctColor(c);
  float peak = max(c.r, max(c.g, c.b));
  // Halation only rims the brightest areas.
  float threshold = kind == 4 ? 0.5 : kind == 13 ? 0.62 : 0.48;
  float knee = 0.2;
  float soft = clamp(peak - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  return c * max(soft, peak - threshold) / max(peak, 0.0001);
}
void main() {
  vec3 c = bright(texture(sourceTex, uv + srcTexel * vec2(-1.0, -1.0)).rgb);
  c += bright(texture(sourceTex, uv + srcTexel * vec2(1.0, -1.0)).rgb);
  c += bright(texture(sourceTex, uv + srcTexel * vec2(-1.0, 1.0)).rgb);
  c += bright(texture(sourceTex, uv + srcTexel * vec2(1.0, 1.0)).rgb);
  outColor = vec4(c * 0.25, 1.0);
}`;

// Dual Kawase downsample.
export const DOWN = `#version 300 es
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
export const UP = `#version 300 es
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

export const STYLE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D sourceTex;
uniform sampler2D glowTex;
uniform vec2 texel;
uniform float mediaTime;
uniform float intensity;
uniform float detail;
uniform float grainCell;
uniform vec3 colorA;
uniform vec3 colorB;
uniform int kind;
out vec4 outColor;
${CORRECTION}
// Arithmetic hash: sin()-based hashes band on GPUs with low-precision sin. Callers keep
// inputs small (frame counters wrap) so fract() keeps enough precision.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 readAt(vec2 p) { return correctColor(texture(sourceTex, clamp(p, 0.0, 1.0)).rgb); }
float sCurve(float x, float k) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 0.5 * pow(2.0 * x, k) : 1.0 - 0.5 * pow(2.0 - 2.0 * x, k);
}
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
  // 1.0 at 1080 lines, so scanlines and offsets look the same at any output size.
  float scale = 1.0 / (texel.y * 1080.0);
  float frame = mod(floor(mediaTime * 24.0), 251.0);
  // Geometric styles scale their offsets by intensity; cross-fading a displaced image with
  // the original would only produce a ghost.
  bool geometric = kind == 3 || kind == 5 || kind == 9 || kind == 11 || kind == 15;
  if (kind == 1) {
    // Grade luminance first to keep saturated colours from clipping channel by channel.
    c = base * (sCurve(l, 1.3) / max(l, 0.0001));
    float warm = mix(0.6, 1.4, detail);
    float cool = mix(1.4, 0.6, detail);
    c += vec3(-0.07, 0.015, 0.06) * (1.0 - smoothstep(0.05, 0.55, l)) * cool;
    c += vec3(0.08, 0.02, -0.07) * smoothstep(0.35, 0.95, l) * warm;
    // Richer warm hues (skin), cool hues pulled toward teal.
    float hue = clamp((c.r - c.b) * 3.0, -1.0, 1.0);
    float cl = luma(c);
    c = cl + (c - cl) * (1.0 + 0.3 * max(hue, 0.0) * warm);
    c += vec3(-0.06, 0.02, 0.0) * max(-hue, 0.0) * cool;
    c = c * 0.95 + vec3(0.015, 0.03, 0.04);
  } else if (kind == 2) {
    // Soft clumps from two octaves of value noise plus fine per-pixel noise, mostly mono
    // with a little colour, strongest in the midtones like real emulsion.
    vec2 gp = px / grainCell;
    float n = valueNoise(gp, frame) + 0.5 * valueNoise(gp * 2.03 + 11.0, frame + 101.0)
      + 0.5 * hash(px + frame * 7.0);
    vec3 tint = vec3(valueNoise(gp + 31.0, frame), valueNoise(gp + 57.0, frame), valueNoise(gp + 83.0, frame)) - 0.5;
    vec3 g = vec3(n * 0.5 - 0.5) + tint * 0.25;
    c = base + g * 0.22 * mix(0.3, 1.0, 4.0 * l * (1.0 - l));
  } else if (kind == 3) {
    float amt = intensity;
    float tracking = 0.4 + detail * 1.6;
    // Occasional small vertical hop, like the deck briefly losing sync.
    vec2 q = vec2(uv.x, uv.y + step(0.97, hash(vec2(frame, 21.0))) * texel.y * 2.0 * scale * amt);
    float row = floor(q.y * 240.0);
    float wobble = sin(q.y * 18.0 + mediaTime * 1.7) * 0.0012 + (hash(vec2(row, frame)) - 0.5) * 0.0012;
    // A tracking band rolls up the frame and drags lines sideways; head-switching skew sits
    // on the bottom edge.
    float band = 1.0 - smoothstep(0.0, 0.05, abs(q.y - fract(-mediaTime * 0.07)));
    float tear = band * (hash(vec2(row, frame + 3.0)) - 0.3) * 0.02;
    float head = 1.0 - smoothstep(0.0, 0.03, q.y);
    float headShift = head * (0.01 + hash(vec2(row, frame + 9.0)) * 0.02);
    // Tape crease: now and then a thin band of noise drifts down the frame.
    float creaseTick = floor(mediaTime * 0.5);
    float creaseY = fract(hash(vec2(creaseTick, 8.3)) - mediaTime * 0.15);
    float crease = step(1.0 - 0.25 * detail, hash(vec2(creaseTick, 4.1)))
      * (1.0 - smoothstep(0.0, 0.012, abs(q.y - creaseY)));
    float creaseShift = crease * (hash(vec2(row, frame + 11.0)) - 0.5) * 0.02;
    vec2 p = q + vec2((wobble + tear) * tracking + headShift + creaseShift, 0.0) * amt;
    // Composite video: soft luma with the overshoot halo of a deck's sharpening circuit,
    // chroma smeared wide and lagging to the right.
    vec2 dx = vec2(texel.x * 1.5 * scale, 0.0);
    float yNear = (toYiq(readAt(p - dx)).x + toYiq(readAt(p + dx)).x) * 0.5;
    float yFar = (toYiq(readAt(p - dx * 3.0)).x + toYiq(readAt(p + dx * 3.0)).x) * 0.5;
    float y = mix(toYiq(readAt(p)).x, yNear, 0.5 * amt);
    y += (y - yFar) * 0.6 * amt;
    float bleed = 0.003 + 0.004 * amt;
    vec2 iq = vec2(0.0);
    for (int i = 0; i < 6; i++) iq += toYiq(readAt(p - vec2((float(i) - 1.5) * bleed, 0.0))).yz;
    iq = mix(toYiq(readAt(p)).yz, iq / 6.0, amt) * mix(1.0, 0.82, amt);
    // Chroma noise: blotchy colour streaks stretched along each line.
    vec2 streak = vec2(px.x / (40.0 * scale), row);
    iq += (vec2(valueNoise(streak, frame), valueNoise(streak + 17.0, frame)) - 0.5) * 0.04 * amt;
    c = fromYiq(vec3(y, iq));
    // Tape contrast with lifted blacks, a faint rolling hum bar and frame flicker.
    c = mix(c, (c - 0.5) * 1.06 + 0.53, amt);
    float hum = sin((q.y + mediaTime * 0.12) * 6.2831853);
    c *= 1.0 + (hum * 0.02 + (hash(vec2(frame, 2.0)) - 0.5) * 0.02) * amt;
    float lines = 0.5 + 0.5 * cos(px.y * 6.2831853 / max(4.0 * scale, 2.0));
    c *= 1.0 - 0.12 * amt * lines;
    float noise = (hash(px + frame * 13.0) - 0.5) * 0.05 + (hash(vec2(row, frame + 5.0)) - 0.5) * 0.015;
    c += (noise * (1.0 + head) + crease * (hash(px + frame) - 0.5) * 0.25) * amt;
  } else if (kind == 4) {
    vec3 glow = texture(glowTex, uv).rgb;
    c = 1.0 - (1.0 - base) * (1.0 - clamp(glow * (1.7 + detail), 0.0, 1.0));
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
    float gray = dot(base, vec3(0.34, 0.56, 0.10));
    c = vec3(sCurve(gray, 1.0 + detail * 0.9));
  } else if (kind == 8) {
    float tone = sCurve(l, 1.0 + detail * 1.4);
    tone = clamp(tone + (hash(floor(px) + frame * 7.0) - 0.5) / 255.0, 0.0, 1.0);
    c = mix(colorA, colorB, tone);
  } else if (kind == 9) {
    float amt = intensity;
    float tick = mod(floor(mediaTime * 12.0), 997.0);
    // Glitches come in short bursts; intensity and detail both set how often, so low
    // intensity means rare, small glitches rather than frequent faint ones.
    float burst = step(1.0 - (0.06 + 0.3 * detail) * amt, hash(vec2(tick, 3.7)));
    float rows = floor(mix(12.0, 28.0, hash(vec2(tick, 1.3))));
    float band = floor(uv.y * rows);
    float shift = (hash(vec2(band, tick + 7.0)) - 0.5) * 0.045 * burst
      * step(0.78, hash(vec2(band, tick))) * detail;
    vec2 grid = vec2(28.0, rows * 1.5);
    vec2 cell = floor(uv * grid);
    float cellHash = hash(cell + tick * 13.0);
    vec2 p = uv + vec2(shift * amt, 0.0);
    if (burst > 0.0 && cellHash > 1.0 - 0.025 * detail * amt)
      p.x -= (1.0 + floor(hash(cell + 1.7) * 2.0)) / grid.x * amt;
    float split = (0.0006 + burst * 0.005 * detail * hash(vec2(tick, 9.1))) * amt;
    c = vec3(readAt(p + vec2(split, 0.0)).r, readAt(p).g, readAt(p - vec2(split, split * 0.3)).b);
    if (burst > 0.0 && cellHash > 1.0 - 0.012 * detail * amt)
      c = mix(c, floor(c * 12.0) / 12.0, 0.6 * amt);
  } else if (kind == 10) {
    // Black Pro-Mist: highlights bloom into soft halos and light areas lose micro-contrast,
    // while the blacks stay deep.
    vec3 soft = texture(glowTex, uv).rgb;
    vec3 halo = soft * (1.8 + 1.2 * detail);
    vec2 radius = texel * scale * 1.5;
    vec3 near = readAt(uv + vec2(radius.x, 0.0)) + readAt(uv - vec2(radius.x, 0.0));
    near += readAt(uv + vec2(0.0, radius.y)) + readAt(uv - vec2(0.0, radius.y));
    c = mix(base, near * 0.25, 0.2 * detail * smoothstep(0.35, 0.85, l));
    c = 1.0 - (1.0 - c) * (1.0 - clamp(halo, 0.0, 1.0));
  } else if (kind == 11) {
    float amt = intensity;
    // Gate weave: the film settles slightly differently in the projector gate each frame.
    vec2 weave = (vec2(hash(vec2(frame, 41.0)), hash(vec2(frame, 43.0))) - 0.5) * vec2(0.003, 0.004);
    vec3 s = readAt(uv + weave * amt);
    float sl = luma(s);
    // Faded reversal stock: muted colour, warm cast, lifted blacks and soft highlights.
    vec3 g = (sl + (s - sl) * 0.8) * vec3(1.05, 0.97, 0.82) * 0.92 + vec3(0.06, 0.04, 0.02);
    g += (valueNoise(px / (2.5 * scale), frame) - 0.5) * 0.08;
    g *= 1.0 - 0.45 * smoothstep(0.5, 1.25, length((uv - 0.5) * vec2(1.8, 1.6)));
    // Wear: dark dust specks each frame and now and then a bright vertical scratch.
    vec2 dust = uv * vec2(48.0, 27.0);
    float speck = step(1.0 - 0.006 * detail, hash(floor(dust) + frame * 3.1));
    g *= 1.0 - speck * (1.0 - smoothstep(0.1, 0.35, length(fract(dust) - 0.5))) * 0.7;
    float reel = floor(mediaTime * 2.0);
    float scratch = step(1.0 - 0.5 * detail, hash(vec2(reel, 6.0)));
    g += scratch * (1.0 - smoothstep(0.0, texel.x * 1.5 * scale, abs(uv.x - hash(vec2(reel, 5.0))))) * 0.25;
    g *= 1.0 + (hash(vec2(frame, 47.0)) - 0.5) * 0.06;
    c = mix(s, g, amt);
  } else if (kind == 12) {
    // DV camcorder: edge-enhanced luma, chroma averaged over 4-pixel runs as in 4:1:1
    // sampling, a cool digital cast and hard-clipped highlights.
    vec2 dx = vec2(texel.x * scale, 0.0);
    vec2 dy = vec2(0.0, texel.y * scale);
    float soft = (toYiq(readAt(uv + dx)).x + toYiq(readAt(uv - dx)).x
      + toYiq(readAt(uv + dy)).x + toYiq(readAt(uv - dy)).x) * 0.25;
    float y = toYiq(base).x;
    y += (y - soft) * (0.8 + 2.2 * detail);
    float run = 4.0 * dx.x;
    float x0 = (floor(uv.x / run) + 0.5) * run;
    vec2 iq = vec2(0.0);
    for (int i = 0; i < 4; i++) iq += toYiq(readAt(vec2(x0 + (float(i) - 1.5) * dx.x, uv.y))).yz;
    c = fromYiq(vec3(y, iq * 0.275)) * vec3(0.97, 1.0, 1.05);
    c = min(c * 1.08, vec3(0.97));
    c += (hash(floor(px / (8.0 * scale)) + frame) - 0.5) * 0.02 + (hash(px + frame * 3.0) - 0.5) * 0.02;
  } else if (kind == 13) {
    // Film halation: light reflecting back through the film base leaves a red-orange rim
    // around highlights.
    float spread = luma(texture(glowTex, uv).rgb) * (1.4 + 1.6 * detail);
    vec3 halo = vec3(1.0, 0.32, 0.12) * spread * (1.0 - 0.5 * smoothstep(0.6, 1.0, l));
    c = 1.0 - (1.0 - base) * (1.0 - clamp(halo, 0.0, 1.0));
  } else if (kind == 14) {
    // Pastel matte: softened colour, lifted blacks, rolled-off whites, pink shadows and
    // mint highlights.
    float fade = 0.06 + 0.14 * detail;
    c = (l + (base - l) * 0.65) * (0.94 - fade) + fade;
    c += vec3(0.03, 0.0, 0.025) * (1.0 - smoothstep(0.1, 0.6, l));
    c += vec3(-0.01, 0.02, 0.01) * smoothstep(0.5, 1.0, l);
  } else if (kind == 15) {
    float amt = intensity;
    // Curved glass pulls the picture in at the corners, which fall to black.
    vec2 cc = uv - 0.5;
    float k = mix(0.02, 0.18, detail) * amt;
    vec2 p = 0.5 + cc * (1.0 + 4.0 * k * dot(cc, cc)) / (1.0 + k);
    vec3 s = readAt(p);
    vec2 spread = vec2(texel.x * 2.0 * scale, 0.0);
    s = max(s, (readAt(p + spread) + readAt(p - spread)) * 0.25 + s * 0.5);
    // About 240 scanlines, fewer on small outputs so lines stay at least 3 pixels apart.
    // Bright content widens the beam, as on a real tube.
    float beam = sin(fract(p.y * min(240.0, 1.0 / (3.0 * texel.y))) * 3.14159265);
    float scan = mix(0.5, 1.0, pow(beam, 1.0 + 1.5 * (1.0 - luma(s))));
    float stripe = mod(floor(px.x / max(scale, 1.0)), 3.0);
    vec3 grille = vec3(0.75) + 0.25 * vec3(stripe == 0.0, stripe == 1.0, stripe == 2.0);
    vec3 tube = s * scan * grille * 1.25;
    tube *= 1.0 - 0.35 * smoothstep(0.5, 1.0, length(cc * vec2(1.6, 1.4)));
    bool inside = all(greaterThanEqual(p, vec2(0.0))) && all(lessThanEqual(p, vec2(1.0)));
    c = inside ? mix(s, tube, amt) : vec3(0.0);
  }
  c = clamp(c, 0.0, 1.0);
  outColor = vec4(geometric ? c : mix(base, c, intensity), 1.0);
}`;
