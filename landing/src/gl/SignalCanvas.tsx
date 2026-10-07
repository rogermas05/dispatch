import { useEffect, useRef } from "react";
import { damp, segmentAt } from "../lib/math";
import { onFrame, scrollState } from "../lib/scroll";
import { isPhaseName, mixParams, phaseParams, PHASES, type SignalParams } from "./phases";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";

const MAX_PIXEL_RATIO = 1.5;
const MAX_PIXELS = 2_600_000;
const STILL_FRAME_TIME = 14;
const UNIFORMS = [
  "uRes", "uTime", "uMouse", "uMouseOn", "uAmp", "uChaos", "uSplit", "uQuant",
  "uRing", "uBright", "uY", "uVel", "uIntro", "uColA", "uColB",
] as const;

type UniformName = (typeof UNIFORMS)[number];

interface Props {
  /** The entrance has finished: let the signal bloom from a flat dial tone. */
  ready: boolean;
  reducedMotion: boolean;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed to compile");
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("could not create program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program failed to link");
  }
  return program;
}

/** The section nearest the middle of the viewport decides what the signal is doing. */
function targetParams(sections: readonly HTMLElement[]): SignalParams {
  const middle = window.innerHeight / 2;
  const centers = sections.map((section) => {
    const rect = section.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const { index, t } = segmentAt(centers, middle);
  const portrait = window.innerWidth < window.innerHeight;
  const nameAt = (i: number) => {
    const name = sections[Math.min(i, sections.length - 1)]?.dataset.phase;
    return phaseParams(isPhaseName(name) ? name : "hero", portrait);
  };
  return mixParams(nameAt(index), nameAt(index + 1), t);
}

export function SignalCanvas({ ready, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(ready);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
    let program: WebGLProgram | null = null;
    try {
      if (gl) program = createProgram(gl);
    } catch (error) {
      console.error("[signal] shader setup failed; using the static backdrop.", error);
    }
    if (!gl || !program) {
      canvas.classList.add("signal--fallback");
      return;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const linked = program;
    const location = Object.fromEntries(
      UNIFORMS.map((name) => [name, gl.getUniformLocation(linked, name)]),
    ) as Record<UniformName, WebGLUniformLocation | null>;

    const resize = () => {
      const { innerWidth: width, innerHeight: height } = window;
      const budget = Math.sqrt(MAX_PIXELS / (width * height));
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, budget);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, on: 0, targetOn: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.targetX = event.clientX / window.innerWidth;
      pointer.targetY = 1 - event.clientY / window.innerHeight;
      pointer.targetOn = event.pointerType === "mouse" ? 1 : 0;
    };
    const onPointerLeave = () => {
      pointer.targetOn = 0;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);

    const sections = () => Array.from(document.querySelectorAll<HTMLElement>("[data-phase]"));
    let current: SignalParams = PHASES.hero;
    let intro = reducedMotion ? 1 : 0;
    let velocity = 0;
    let time = 0;

    const stop = onFrame((delta) => {
      if (document.hidden) return;
      time += delta;
      current = mixParams(current, targetParams(sections()), damp(3.5, delta));
      intro += ((readyRef.current ? 1 : 0) - intro) * damp(0.9, delta);
      velocity += (scrollState.velocity - velocity) * damp(6, delta);
      pointer.x += (pointer.targetX - pointer.x) * damp(5, delta);
      pointer.y += (pointer.targetY - pointer.y) * damp(5, delta);
      pointer.on += (pointer.targetOn - pointer.on) * damp(3, delta);

      gl.uniform2f(location.uRes, canvas.width, canvas.height);
      gl.uniform1f(location.uTime, reducedMotion ? STILL_FRAME_TIME : time);
      gl.uniform2f(location.uMouse, pointer.x, pointer.y);
      gl.uniform1f(location.uMouseOn, reducedMotion ? 0 : pointer.on);
      gl.uniform1f(location.uAmp, current.amp);
      gl.uniform1f(location.uChaos, current.chaos);
      gl.uniform1f(location.uSplit, current.split);
      gl.uniform1f(location.uQuant, current.quant);
      gl.uniform1f(location.uRing, current.ring);
      gl.uniform1f(location.uBright, current.bright);
      gl.uniform1f(location.uY, current.y);
      gl.uniform1f(location.uVel, reducedMotion ? 0 : velocity);
      gl.uniform1f(location.uIntro, intro);
      gl.uniform3f(location.uColA, ...current.colA);
      gl.uniform3f(location.uColB, ...current.colB);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="signal" aria-hidden="true" />;
}
