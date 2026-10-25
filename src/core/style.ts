import { DOWN, PREFILTER, STYLE, UP, VERTEX } from './styleShaders';

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
export interface ColorCorrection {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
}
export interface StyleSettings {
  correction?: Partial<ColorCorrection>;
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

export function normalizeStyle(
  value?: Partial<StyleSettings>,
): StyleSettings & { correction: ColorCorrection } {
  const preset = STYLE_PRESETS.find((item) => item.id === value?.id) ?? STYLE_PRESETS[0];
  return {
    id: preset.id,
    intensity: clamp(value?.intensity, DEFAULT_STYLE.intensity),
    detail: clamp(value?.detail, preset.defaultDetail, preset.detailMin, preset.detailMax),
    colorA: validColor(value?.colorA, DEFAULT_STYLE.colorA),
    colorB: validColor(value?.colorB, DEFAULT_STYLE.colorB),
    correction: {
      exposure: clamp(value?.correction?.exposure, 0, -3, 3),
      contrast: clamp(value?.correction?.contrast, 1, 0, 2),
      saturation: clamp(value?.correction?.saturation, 1, 0, 2),
      temperature: clamp(value?.correction?.temperature, 0, -1, 1),
    },
  };
}

export function hasStyle(value?: StyleSettings): boolean {
  return !!value && value.id !== 'none' && value.intensity > 0;
}

export function hasColorCorrection(value?: StyleSettings): boolean {
  const c = normalizeStyle(value).correction;
  return c.exposure !== 0 || c.contrast !== 1 || c.saturation !== 1 || c.temperature !== 0;
}

export function hasStyleEffects(value?: StyleSettings): boolean {
  return hasStyle(value) || hasColorCorrection(value);
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
    kind: hasStyle(style) ? STYLE_PRESETS.findIndex((item) => item.id === style.id) : 0,
    intensity: style.intensity,
    detail: style.detail,
    colorA: rgb(style.colorA),
    colorB: rgb(style.colorB),
    correction: [
      2 ** style.correction.exposure,
      style.correction.contrast,
      style.correction.saturation,
      style.correction.temperature,
    ],
  };
}

export function grainCellSize(detail: number, height: number): number {
  return Math.max(1, ((3 + 6 * detail) * height) / 1080);
}

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
  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  let currentProgram: WebGLProgram;
  const useProgram = (value: WebGLProgram) => {
    currentProgram = value;
    gl.useProgram(value);
  };
  const uniform = (name: string) => {
    let names = locations.get(currentProgram);
    if (!names) {
      names = new Map();
      locations.set(currentProgram, names);
    }
    if (!names.has(name)) names.set(name, gl.getUniformLocation(currentProgram, name));
    return names.get(name)!;
  };
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
      reference: { width: number; height: number } = { width, height },
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
        useProgram(prefilter);
        gl.uniform1i(uniform('sourceTex'), 0);
        gl.uniform2f(uniform('srcTexel'), 1 / reference.width, 1 / reference.height);
        gl.uniform1i(uniform('kind'), mapped.kind);
        gl.uniform4fv(uniform('correction'), mapped.correction);
        pass(downLevels[0]!, downLevels[0]!.width, downLevels[0]!.height);
        useProgram(down);
        gl.uniform1i(uniform('sourceTex'), 0);
        for (let i = 1; i < GLOW_LEVELS; i++) {
          const from = downLevels[i - 1]!;
          bind(from.texture, 0);
          gl.uniform2f(
            uniform('srcTexel'),
            1 / Math.max(1, Math.ceil(reference.width / 2 ** i)),
            1 / Math.max(1, Math.ceil(reference.height / 2 ** i)),
          );
          pass(downLevels[i]!, downLevels[i]!.width, downLevels[i]!.height);
        }
        useProgram(up);
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
          gl.uniform2f(
            uniform('srcTexel'),
            1 / Math.max(1, Math.ceil(reference.width / 2 ** (i + 2))),
            1 / Math.max(1, Math.ceil(reference.height / 2 ** (i + 2))),
          );
          pass(upLevels[i]!, upLevels[i]!.width, upLevels[i]!.height);
        }
      }
      useProgram(styleProgram);
      bind(source, 0);
      bind(upLevels[0]?.texture ?? null, 1);
      gl.uniform1i(uniform('sourceTex'), 0);
      gl.uniform1i(uniform('glowTex'), 1);
      gl.uniform2f(uniform('texel'), 1 / reference.width, 1 / reference.height);
      gl.uniform1f(uniform('mediaTime'), time);
      gl.uniform1f(uniform('intensity'), mapped.intensity);
      gl.uniform1f(uniform('detail'), mapped.detail);
      gl.uniform1f(uniform('grainCell'), grainCellSize(mapped.detail, reference.height));
      gl.uniform3fv(uniform('colorA'), mapped.colorA);
      gl.uniform3fv(uniform('colorB'), mapped.colorB);
      gl.uniform1i(uniform('kind'), mapped.kind);
      gl.uniform4fv(uniform('correction'), mapped.correction);
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
