import type { FacePresence } from "./use-face-presence";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

type MotionInput = {
  state: AvatarState;
  mouthLevel: number;
  presence?: FacePresence;
};

const vertexSource = /* glsl */ `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// The eye and lip coordinates match interviewer-portrait.webp.
const fragmentSource = /* glsl */ `
precision mediump float;
uniform sampler2D portrait;
uniform vec4 crop;
uniform vec4 pose;
uniform vec4 expression;
varying vec2 uv;

float falloff(vec2 point, vec2 center, vec2 radius) {
  vec2 offset = (point - center) / radius;
  return exp(-dot(offset, offset));
}

vec2 animateEye(vec2 point, vec2 center, float slope, float blink, vec2 glance) {
  vec2 offset = point - center;
  float lid = offset.y - offset.x * slope;
  float eyelid = exp(-pow(abs(offset.x) / 0.027, 4.0))
    * (1.0 - smoothstep(0.006, 0.016, abs(lid)));
  point.y += clamp(lid * 3.5, -0.012, 0.012) * eyelid * blink;
  float iris = falloff(point, center, vec2(0.013, 0.008));
  return point - glance * iris * (1.0 - blink);
}

void main() {
  vec2 source = uv * crop.xy + crop.zw;
  vec2 pivot = vec2(0.505, 0.553);
  float angle = pose.x;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 moved = rotation * (source - pivot) + pivot - pose.yz;
  vec2 area = abs((source - vec2(0.51, 0.34)) / vec2(0.29, 0.36));
  float head = exp(-pow(area.x, 4.0) - pow(area.y, 4.0));
  vec2 point = mix(source, moved, head);
  point.y -= pose.w * falloff(source, vec2(0.51, 0.78), vec2(0.47, 0.18));

  vec2 glance = expression.yz;
  point = animateEye(point, vec2(0.4542, 0.3250), -0.055, expression.x, glance);
  point = animateEye(point, vec2(0.5794, 0.3074), -0.255, expression.x, glance);
  vec2 mouth = point - vec2(0.545, 0.4607);
  mouth.y += mouth.x * 0.171 - 1.9 * mouth.x * mouth.x;
  float opening = expression.w;
  float lowerLip = exp(-pow(abs(mouth.x) / 0.062, 4.0) - pow((mouth.y - 0.012) / 0.048, 2.0));
  point.y -= opening * (0.010 * lowerLip * smoothstep(-0.005, 0.012, mouth.y)
    + 0.0045 * falloff(point, vec2(0.54, 0.516), vec2(0.089, 0.074)));
  point.y += opening * 0.002 * falloff(point, vec2(0.543, 0.451), vec2(0.055, 0.017));
  vec3 color = texture2D(portrait, clamp(point, 0.0, 1.0)).rgb;

  vec2 openingShape = (mouth - vec2(0.0, opening * 0.0035))
    / vec2(0.047, 0.0008 + opening * 0.0075);
  float interior = (1.0 - smoothstep(0.53, 1.03, dot(openingShape, openingShape)))
    * smoothstep(0.10, 0.38, opening);
  gl_FragColor = vec4(mix(color, vec3(0.25, 0.083, 0.076), interior * 0.77), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (program && gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function animateInterviewer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  current: () => MotionInput,
  onReady: () => void,
) {
  const gl = canvas.getContext("webgl", { alpha: false });
  if (!gl) return;
  const program = createProgram(gl);
  if (!program) return;

  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const crop = gl.getUniformLocation(program, "crop");
  const pose = gl.getUniformLocation(program, "pose");
  const expression = gl.getUniformLocation(program, "expression");
  const imageAspect = image.naturalWidth / image.naturalHeight;
  let width = 0;
  let height = 0;
  let frame = 0;
  let visible = true;
  let ready = false;
  let previousFrame = 0;
  let lastState: AvatarState = "idle";
  let stateSince = 0;
  let thinking = 0;
  let gaze = 0;
  let mouth = 0;
  let nextBlink = 2.4;
  let blinkStarted = -1;
  const started = performance.now();
  const resize = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
  });
  resize.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  visibility.observe(canvas);

  const render = (now: number) => {
    frame = requestAnimationFrame(render);
    if (document.hidden || !visible || !width || !height || canvas.hidden || gl.isContextLost()) return;
    const elapsed = now - previousFrame;
    if (elapsed < 31) return;
    previousFrame = now;
    const time = (now - started) / 1000;
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    const pixelsWide = Math.round(width * pixelRatio);
    const pixelsHigh = Math.round(height * pixelRatio);
    if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
      canvas.width = pixelsWide;
      canvas.height = pixelsHigh;
      gl.viewport(0, 0, pixelsWide, pixelsHigh);
    }
    const stageAspect = width / height;
    const cropWidth = Math.min(1, stageAspect / imageAspect);
    const cropHeight = Math.min(1, imageAspect / stageAspect);
    gl.uniform4f(crop, cropWidth, cropHeight, (1 - cropWidth) * 0.5, (1 - cropHeight) * 0.25);

    const { state, mouthLevel, presence } = current();
    if (state !== lastState) {
      lastState = state;
      stateSince = time;
    }
    const stateAge = time - stateSince;
    const listenerNod = state === "listening" ? clamp(1 - Math.abs(stateAge - 0.55) / 0.36) : 0;
    const responseNod = state === "speaking" ? clamp(1 - Math.abs(stateAge - 0.22) / 0.22) : 0;
    const cameraNodAge = presence?.nodAt ? (now - presence.nodAt) / 1000 : 1;
    const cameraNod = Math.sin(Math.PI * clamp(cameraNodAge / 0.72));
    const easing = 1 - Math.exp(-Math.min(elapsed, 120) / 150);
    const targetGaze = presence?.face ? Math.max(-1, Math.min(1, -presence.yaw * 2)) : Math.sin(time * 0.71) * 0.18;
    thinking += ((state === "thinking" ? 1 : 0) - thinking) * easing;
    gaze += (targetGaze - gaze) * easing;
    const targetMouth = state === "speaking"
      ? mouthLevel >= 0 ? clamp(mouthLevel * 1.2) : 0.23 + 0.62 * Math.pow(Math.sin(time * 12), 2)
      : 0;
    mouth += (targetMouth - mouth) * (targetMouth > mouth ? 0.63 : 0.39);
    if (time >= nextBlink) {
      blinkStarted = time;
      nextBlink = time + 3.1 + Math.random() * 1.8;
    }
    const blinkAge = time - blinkStarted;
    const blink = blinkAge < 0.18 ? Math.sin(Math.PI * blinkAge / 0.18) : 0;
    const nod = listenerNod * 0.010 + responseNod * 0.008 + cameraNod * 0.009;
    gl.uniform4f(
      pose,
      0.009 * Math.sin(time * 0.92) - thinking * 0.037 + gaze * 0.012,
      0.003 * Math.sin(time * 0.74) + thinking * 0.012,
      nod - thinking * 0.005,
      0.0022 * Math.sin(time * 1.7),
    );
    gl.uniform4f(expression, blink, gaze * 0.004 + thinking * 0.007, thinking * -0.0035, mouth);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!ready) {
      ready = true;
      onReady();
    }
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    visibility.disconnect();
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
}
