(function () {
  "use strict";

  const defaults = {
    mandelbrot: { cx: -0.5, cy: 0, scale: 3.2 },
    julia: { cx: 0, cy: 0, scale: 3.2 }
  };

  const state = {
    maxIter: 350,
    paletteSpeed: 8.0,
    smoothColoring: true,
    showCrosshair: true,
    c: { re: -0.74543, im: 0.11301 },
    renderStats: { mandelbrotMs: 0, juliaMs: 0 },
    gpuAvailable: true,
    maxGpuIterCap: 2048
  };

  const dom = {
    iterSlider: document.getElementById("iterSlider"),
    iterInput: document.getElementById("iterInput"),
    iterValue: document.getElementById("iterValue"),
    paletteSlider: document.getElementById("paletteSlider"),
    paletteValue: document.getElementById("paletteValue"),
    smoothToggle: document.getElementById("smoothToggle"),
    axesToggle: document.getElementById("axesToggle"),
    resetAllBtn: document.getElementById("resetAllBtn"),
    resetMandelBtn: document.getElementById("resetMandelBtn"),
    resetJuliaBtn: document.getElementById("resetJuliaBtn"),
    juliaFitBtn: document.getElementById("juliaFitBtn"),
    mandelbrotMeta: document.getElementById("mandelbrotMeta"),
    juliaMeta: document.getElementById("juliaMeta"),
    mandelbrotCenter: document.getElementById("mandelbrotCenter"),
    mandelbrotScale: document.getElementById("mandelbrotScale"),
    juliaCenter: document.getElementById("juliaCenter"),
    juliaScale: document.getElementById("juliaScale"),
    cValue: document.getElementById("cValue"),
    cMembership: document.getElementById("cMembership"),
    juliaEq: document.getElementById("juliaEq"),
    renderStatus: document.getElementById("renderStatus")
  };

  const VERTEX_SHADER_SOURCE = [
    "attribute vec2 a_pos;",
    "void main() {",
    "  gl_Position = vec4(a_pos, 0.0, 1.0);",
    "}"
  ].join("\n");

  const GPU_LOOP_CAP_CANDIDATES = [4096, 3072, 2048, 1024];

  function buildFragmentShaderSource(loopCap) {
    return [
    "precision highp float;",
    "uniform vec2 u_resolution;",
    "uniform vec2 u_center;",
    "uniform float u_scale;",
    "uniform vec2 u_c;",
    "uniform float u_paletteSpeed;",
    "uniform float u_block;",
    "uniform float u_kind;",
    "uniform float u_smooth;",
    "uniform int u_maxIter;",
    "const int LOOP_CAP = " + String(loopCap) + ";",
    "float TAU = 6.283185307179586;",
    "vec3 palette(float t, float boost) {",
    "  float a = 0.5 + 0.5 * cos(TAU * (t + 0.00));",
    "  float b = 0.5 + 0.5 * cos(TAU * (t + 0.12));",
    "  float c = 0.5 + 0.5 * cos(TAU * (t + 0.28));",
    "  return vec3(a, b, c) * boost;",
    "}",
    "void main() {",
    "  vec2 frag = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);",
    "  if (u_block > 1.0) {",
    "    frag = floor((frag - vec2(0.5, 0.5)) / u_block) * u_block + vec2(0.5 * u_block);",
    "  }",
    "  float w = u_resolution.x;",
    "  float h = u_resolution.y;",
    "  float hScale = u_scale * (h / w);",
    "  vec2 z0 = vec2(",
    "    u_center.x + ((frag.x - 0.5 * w) / w) * u_scale,",
    "    u_center.y - ((frag.y - 0.5 * h) / h) * hScale",
    "  );",
    "  vec2 z = (u_kind < 0.5) ? vec2(0.0, 0.0) : z0;",
    "  vec2 c = (u_kind < 0.5) ? z0 : u_c;",
    "  float mag2 = dot(z, z);",
    "  bool escaped = false;",
    "  int iterCount = 0;",
    "  for (int i = 0; i < LOOP_CAP; ++i) {",
    "    if (i >= u_maxIter) {",
    "      break;",
    "    }",
    "    float x = z.x * z.x - z.y * z.y + c.x;",
    "    float y = 2.0 * z.x * z.y + c.y;",
    "    z = vec2(x, y);",
    "    mag2 = dot(z, z);",
    "    iterCount = i + 1;",
    "    if (mag2 > 4.0) {",
    "      escaped = true;",
    "      break;",
    "    }",
    "  }",
    "  if (!escaped) {",
    "    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);",
    "    return;",
    "  }",
    "  float iterF = float(iterCount);",
    "  if (u_smooth > 0.5) {",
    "    float logZn = 0.5 * log(max(mag2, 1e-12));",
    "    float nu = log(max(logZn / log(2.0), 1e-12)) / log(2.0);",
    "    iterF = iterF + 1.0 - nu;",
    "  }",
    "  float tRaw = (iterF / max(float(u_maxIter), 1.0)) * u_paletteSpeed;",
    "  float t = fract(tRaw);",
    "  float boost = min(1.0, 0.35 + 0.95 * pow(clamp(iterF / max(float(u_maxIter), 1.0), 0.0, 1.0), 0.35));",
    "  vec3 color = palette(t, boost);",
    "  gl_FragColor = vec4(color, 1.0);",
    "}"
    ].join("\n");
  }

  const interactions = new Map();
  let resizeObserver = null;
  let membershipCacheKey = "";
  let membershipCacheValue = "";

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function copyView(view) {
    return { cx: view.cx, cy: view.cy, scale: view.scale };
  }

  function formatNum(n, digits) {
    if (digits == null) digits = 6;
    if (!Number.isFinite(n)) return "NaN";
    const abs = Math.abs(n);
    if (abs > 0 && (abs < 1e-6 || abs >= 1e7)) {
      return n.toExponential(clamp(Math.round(digits * 0.6), 4, 12));
    }
    return n.toFixed(digits).replace(/\.?0+$/, "");
  }

  function formatComplex(re, im, digits) {
    if (digits == null) digits = 6;
    const sign = im >= 0 ? "+" : "-";
    return formatNum(re, digits) + " " + sign + " " + formatNum(Math.abs(im), digits) + "i";
  }

  function digitsFromScale(scale, extra, minDigits, maxDigits) {
    if (extra == null) extra = 6;
    if (minDigits == null) minDigits = 8;
    if (maxDigits == null) maxDigits = 16;
    const safeScale = Math.max(Math.abs(scale), 1e-300);
    const estimated = Math.floor(-Math.log10(safeScale)) + extra;
    return clamp(estimated, minDigits, maxDigits);
  }

  function getPixelRatio() {
    return clamp(window.devicePixelRatio || 1, 1, 2.5);
  }

  function ensureCanvasSize(canvas, width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
    }
    return false;
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(shader) || "Shader compile failed";
      gl.deleteShader(shader);
      throw new Error(msg);
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(program) || "Program link failed";
      gl.deleteProgram(program);
      throw new Error(msg);
    }
    return program;
  }

  function createGpuRenderer() {
    const canvas = document.createElement("canvas");
    let gl = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        premultipliedAlpha: false
      }) || canvas.getContext("experimental-webgl");
    } catch (err) {
      gl = null;
    }
    if (!gl) return null;

    try {
      let program = null;
      let loopCap = GPU_LOOP_CAP_CANDIDATES[GPU_LOOP_CAP_CANDIDATES.length - 1];
      let lastErr = null;
      for (let i = 0; i < GPU_LOOP_CAP_CANDIDATES.length; i++) {
        const candidate = GPU_LOOP_CAP_CANDIDATES[i];
        try {
          program = createProgram(gl, VERTEX_SHADER_SOURCE, buildFragmentShaderSource(candidate));
          loopCap = candidate;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!program) throw lastErr || new Error("No supported shader loop cap");

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
          -1,  1,
           1, -1,
           1,  1
        ]),
        gl.STATIC_DRAW
      );

      const uniforms = {
        resolution: gl.getUniformLocation(program, "u_resolution"),
        center: gl.getUniformLocation(program, "u_center"),
        scale: gl.getUniformLocation(program, "u_scale"),
        c: gl.getUniformLocation(program, "u_c"),
        paletteSpeed: gl.getUniformLocation(program, "u_paletteSpeed"),
        block: gl.getUniformLocation(program, "u_block"),
        kind: gl.getUniformLocation(program, "u_kind"),
        smooth: gl.getUniformLocation(program, "u_smooth"),
        maxIter: gl.getUniformLocation(program, "u_maxIter")
      };

      const attribs = {
        pos: gl.getAttribLocation(program, "a_pos")
      };

      return {
        canvas,
        gl,
        program,
        loopCap,
        quad,
        uniforms,
        attribs
      };
    } catch (err) {
      try {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch (_unused) {}
      return null;
    }
  }

  function makePane(kind) {
    const wrap = document.getElementById(kind + "Wrap");
    const canvas = document.getElementById(kind + "Canvas");
    const overlay = document.getElementById(kind + "Overlay");
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    const octx = overlay.getContext("2d");
    const snapshotCanvas = document.createElement("canvas");
    const snapshotCtx = snapshotCanvas.getContext("2d", { alpha: false });
    const continuityCanvas = document.createElement("canvas");
    const continuityCtx = continuityCanvas.getContext("2d", { alpha: false });
    const gpu = createGpuRenderer();
    if (!gpu) state.gpuAvailable = false;

    return {
      kind,
      wrap,
      canvas,
      overlay,
      ctx,
      octx,
      snapshotCanvas,
      snapshotCtx,
      continuityCanvas,
      continuityCtx,
      continuityView: null,
      continuityHasPixels: false,
      gpu,
      view: copyView(defaults[kind]),
      defaultView: copyView(defaults[kind]),
      renderToken: 0,
      renderQueued: false,
      rendering: false,
      pendingRequest: null,
      deferredFullTimer: null,
      wheelZoomSettleTimer: null,
      wheelZoomActive: false,
      activePointer: null,
      lastRenderStartedAt: 0,
      hasPixels: false,
      lastExactView: null
    };
  }

  const panes = {
    mandelbrot: makePane("mandelbrot"),
    julia: makePane("julia")
  };

  state.maxGpuIterCap = (function getMinGpuLoopCap() {
    let minCap = Infinity;
    let hasGpu = false;
    const paneList = [panes.mandelbrot, panes.julia];
    for (let i = 0; i < paneList.length; i++) {
      const gpu = paneList[i].gpu;
      if (gpu && gpu.loopCap) {
        hasGpu = true;
        minCap = Math.min(minCap, gpu.loopCap);
      }
    }
    return hasGpu ? minCap : 2048;
  })();

  function fillBlack(pane) {
    pane.ctx.save();
    pane.ctx.setTransform(1, 0, 0, 1, 0, 0);
    pane.ctx.fillStyle = "#000";
    pane.ctx.fillRect(0, 0, pane.canvas.width, pane.canvas.height);
    pane.ctx.restore();
  }

  function clearOverlay(pane) {
    pane.octx.clearRect(0, 0, pane.overlay.width, pane.overlay.height);
  }

  function drawCrosshair(pane) {
    const ctx = pane.octx;
    clearOverlay(pane);
    if (!state.showCrosshair) return;
    const w = pane.overlay.width;
    const h = pane.overlay.height;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 + 0.5, 0);
    ctx.lineTo(w / 2 + 0.5, h);
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function pixelToComplex(pane, px, py) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    const heightScale = pane.view.scale * (h / w);
    return {
      re: pane.view.cx + ((px - w / 2) / w) * pane.view.scale,
      im: pane.view.cy - ((py - h / 2) / h) * heightScale
    };
  }

  function complexToPixel(pane, re, im) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    const heightScale = pane.view.scale * (h / w);
    return {
      x: ((re - pane.view.cx) / pane.view.scale) * w + w / 2,
      y: h / 2 - ((im - pane.view.cy) / heightScale) * h
    };
  }

  function drawMandelbrotMarker() {
    const pane = panes.mandelbrot;
    const ctx = pane.octx;
    if (!ctx) return;
    if (!state.showCrosshair) clearOverlay(pane);

    const p = complexToPixel(pane, state.c.re, state.c.im);
    const w = pane.overlay.width;
    const h = pane.overlay.height;
    if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "rgba(81, 194, 255, 0.95)";
    ctx.fillStyle = "rgba(81, 194, 255, 0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-4, 0);
    ctx.moveTo(4, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -4);
    ctx.moveTo(0, 4);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.restore();
  }

  function estimateFloatStepQuantizationRatio(base, step) {
    const absStep = Math.abs(step);
    if (!(absStep > 0) || !Number.isFinite(absStep) || !Number.isFinite(base)) return 1;
    const f0 = Math.fround(base);
    const f1 = Math.fround(base + step);
    const actual = Math.abs(f1 - f0);
    return actual / absStep;
  }

  function getPanePrecisionWarning(pane) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (!(w > 0 && h > 0)) return null;

    const xStep = pane.view.scale / w;
    const yStep = (pane.view.scale * (h / w)) / h;
    const xHalfSpan = 0.5 * pane.view.scale;
    const yHalfSpan = 0.5 * pane.view.scale * (h / w);

    const ratios = [
      estimateFloatStepQuantizationRatio(pane.view.cx, xStep),
      estimateFloatStepQuantizationRatio(pane.view.cx - xHalfSpan, xStep),
      estimateFloatStepQuantizationRatio(pane.view.cx + xHalfSpan, xStep),
      estimateFloatStepQuantizationRatio(pane.view.cy, yStep),
      estimateFloatStepQuantizationRatio(pane.view.cy - yHalfSpan, yStep),
      estimateFloatStepQuantizationRatio(pane.view.cy + yHalfSpan, yStep)
    ];

    let minRatio = Infinity;
    for (let i = 0; i < ratios.length; i++) {
      const r = ratios[i];
      if (Number.isFinite(r)) minRatio = Math.min(minRatio, r);
    }
    if (!Number.isFinite(minRatio)) return null;
    if (minRatio >= 0.85) return null;

    const severe = minRatio <= 0.25;
    return {
      severe,
      minRatio,
      text: severe
        ? "Warning: GPU float precision distortion"
        : "Warning: GPU float precision degrading"
    };
  }

  function drawPanePrecisionWarning(pane) {
    const warning = getPanePrecisionWarning(pane);
    if (!warning) return;
    const ctx = pane.octx;
    if (!ctx) return;

    const w = pane.overlay.width;
    const x = 10;
    const y = 10;
    const padX = 8;
    const padY = 5;
    const lineH = 13;
    const ratioPct = Math.max(0, Math.min(999, Math.round(warning.minRatio * 100)));
    const line1 = warning.text;
    const line2 = "pixel-step quantization ~" + ratioPct + "%";

    ctx.save();
    ctx.font = "11px IBM Plex Sans, system-ui, sans-serif";
    const width = Math.ceil(Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width)) + padX * 2;
    const height = lineH * 2 + padY * 2;
    const boxW = Math.max(80, Math.min(width, Math.max(80, w - 20)));
    ctx.fillStyle = warning.severe ? "rgba(164, 41, 26, 0.88)" : "rgba(143, 95, 31, 0.88)";
    ctx.strokeStyle = warning.severe ? "rgba(255, 195, 188, 0.7)" : "rgba(255, 227, 172, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x + 0.5, y + 0.5, boxW, height, 8);
    } else {
      ctx.rect(x + 0.5, y + 0.5, boxW, height);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.textBaseline = "top";
    ctx.fillText(line1, x + padX, y + padY);
    ctx.fillText(line2, x + padX, y + padY + lineH);
    ctx.restore();
  }

  function drawJuliaOverlay() {
    if (!state.showCrosshair) {
      clearOverlay(panes.julia);
      return;
    }
    drawCrosshair(panes.julia);
  }

  function drawOverlays() {
    drawCrosshair(panes.mandelbrot);
    drawMandelbrotMarker();
    drawJuliaOverlay();
    drawPanePrecisionWarning(panes.mandelbrot);
    drawPanePrecisionWarning(panes.julia);
  }

  function getPointerPos(event, pane) {
    const rect = pane.overlay.getBoundingClientRect();
    const dprX = pane.overlay.width / rect.width;
    const dprY = pane.overlay.height / rect.height;
    return {
      x: (event.clientX - rect.left) * dprX,
      y: (event.clientY - rect.top) * dprY
    };
  }

  function panByPixels(pane, dx, dy) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    const heightScale = pane.view.scale * (h / w);
    pane.view.cx -= (dx / w) * pane.view.scale;
    pane.view.cy += (dy / h) * heightScale;
  }

  function zoomAt(pane, px, py, zoomFactor) {
    const before = pixelToComplex(pane, px, py);
    pane.view.scale = clamp(pane.view.scale * zoomFactor, 1e-14, 20);
    const after = pixelToComplex(pane, px, py);
    pane.view.cx += before.re - after.re;
    pane.view.cy += before.im - after.im;
  }

  function resizePane(pane) {
    const rect = pane.wrap.getBoundingClientRect();
    const dpr = getPixelRatio();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    const changed =
      ensureCanvasSize(pane.canvas, w, h) |
      ensureCanvasSize(pane.overlay, w, h) |
      ensureCanvasSize(pane.snapshotCanvas, w, h) |
      ensureCanvasSize(pane.continuityCanvas, w, h);

    if (pane.gpu) ensureCanvasSize(pane.gpu.canvas, w, h);

    if (changed) pane.hasPixels = false;
    if (changed) pane.continuityHasPixels = false;
    return Boolean(changed);
  }

  function resizeAll() {
    resizePane(panes.mandelbrot);
    resizePane(panes.julia);
    fillBlack(panes.mandelbrot);
    fillBlack(panes.julia);
    drawOverlays();
    scheduleRender(panes.mandelbrot, { reason: "resize", quality: "full" });
    scheduleRender(panes.julia, { reason: "resize", quality: "full" });
    updateHud();
  }

  function computeViewTransform(oldView, newView, w, h) {
    const scale = oldView.scale / newView.scale;
    const tx =
      ((oldView.cx - newView.cx) / newView.scale) * w +
      w / 2 -
      scale * (w / 2);
    const ty =
      h / 2 -
      ((oldView.cy - newView.cy) * w) / newView.scale -
      scale * (h / 2);
    return { scale, tx, ty };
  }

  function normalizeRect(rect, w, h) {
    const x0 = clamp(Math.floor(rect.x), 0, w);
    const y0 = clamp(Math.floor(rect.y), 0, h);
    const x1 = clamp(Math.ceil(rect.x + rect.w), 0, w);
    const y1 = clamp(Math.ceil(rect.y + rect.h), 0, h);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function normalizeRects(rects, w, h) {
    if (!rects || !rects.length) return [];
    const out = [];
    for (let i = 0; i < rects.length; i++) {
      const r = normalizeRect(rects[i], w, h);
      if (r) out.push(r);
    }
    return out;
  }

  function fullPaneRect(pane) {
    return { x: 0, y: 0, w: pane.canvas.width, h: pane.canvas.height };
  }

  function computeExposedRects(w, h, tx, ty) {
    const overlapX0 = clamp(Math.floor(Math.max(tx, 0)), 0, w);
    const overlapY0 = clamp(Math.floor(Math.max(ty, 0)), 0, h);
    const overlapX1 = clamp(Math.ceil(Math.min(tx + w, w)), 0, w);
    const overlapY1 = clamp(Math.ceil(Math.min(ty + h, h)), 0, h);
    const hasOverlap = overlapX1 > overlapX0 && overlapY1 > overlapY0;

    if (!hasOverlap) return [{ x: 0, y: 0, w: w, h: h }];

    const rects = [];
    if (overlapY0 > 0) rects.push({ x: 0, y: 0, w: w, h: overlapY0 });
    if (overlapY1 < h) rects.push({ x: 0, y: overlapY1, w: w, h: h - overlapY1 });
    const middleH = overlapY1 - overlapY0;
    if (middleH > 0) {
      if (overlapX0 > 0) rects.push({ x: 0, y: overlapY0, w: overlapX0, h: middleH });
      if (overlapX1 < w) rects.push({ x: overlapX1, y: overlapY0, w: w - overlapX1, h: middleH });
    }
    return rects;
  }

  function continuityCacheUsefulForView(pane, targetView) {
    if (!pane.continuityHasPixels || !pane.continuityView) return false;
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (!(w > 0 && h > 0)) return false;
    const t = computeViewTransform(pane.continuityView, targetView, w, h);
    if (!(t.scale > 1.001)) return false;
    const x0 = t.tx;
    const y0 = t.ty;
    const x1 = t.tx + w * t.scale;
    const y1 = t.ty + h * t.scale;
    const overlapW = Math.max(0, Math.min(x1, w) - Math.max(x0, 0));
    const overlapH = Math.max(0, Math.min(y1, h) - Math.max(y0, 0));
    return overlapW >= w * 0.35 && overlapH >= h * 0.35;
  }

  function captureContinuityFrame(pane, view, options) {
    if (!pane.hasPixels || !pane.continuityCtx) return;
    const opts = options || {};
    const targetView = view || pane.view;
    if (opts.preserveUsefulWider && continuityCacheUsefulForView(pane, targetView)) return;
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (w <= 0 || h <= 0) return;
    ensureCanvasSize(pane.continuityCanvas, w, h);
    pane.continuityCtx.save();
    pane.continuityCtx.setTransform(1, 0, 0, 1, 0, 0);
    pane.continuityCtx.imageSmoothingEnabled = false;
    pane.continuityCtx.clearRect(0, 0, w, h);
    pane.continuityCtx.drawImage(pane.canvas, 0, 0);
    pane.continuityCtx.restore();
    pane.continuityView = copyView(targetView);
    pane.continuityHasPixels = true;
  }

  function drawContinuityCache(pane, targetView, w, h) {
    if (!pane.continuityHasPixels || !pane.continuityView) return false;
    if (!pane.continuityCanvas.width || !pane.continuityCanvas.height) return false;
    const t = computeViewTransform(pane.continuityView, targetView, w, h);
    const dw = pane.continuityCanvas.width * t.scale;
    const dh = pane.continuityCanvas.height * t.scale;
    if (!(dw > 0 && dh > 0)) return false;
    const pad = 1;
    pane.ctx.save();
    pane.ctx.setTransform(1, 0, 0, 1, 0, 0);
    pane.ctx.imageSmoothingEnabled = true;
    pane.ctx.drawImage(
      pane.continuityCanvas,
      0, 0, pane.continuityCanvas.width, pane.continuityCanvas.height,
      t.tx - pad, t.ty - pad, dw + pad * 2, dh + pad * 2
    );
    pane.ctx.restore();
    return true;
  }

  function reprojectCurrentFrame(pane, oldView, newView) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (w <= 0 || h <= 0) return [];
    if (!pane.hasPixels) {
      fillBlack(pane);
      return [fullPaneRect(pane)];
    }

    pane.snapshotCtx.save();
    pane.snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
    pane.snapshotCtx.imageSmoothingEnabled = false;
    pane.snapshotCtx.drawImage(pane.canvas, 0, 0);
    pane.snapshotCtx.restore();

    const t = computeViewTransform(oldView, newView, w, h);
    const panOnly = Math.abs(t.scale - 1) < 1e-9;
    const frac = Math.abs(t.tx - Math.round(t.tx)) + Math.abs(t.ty - Math.round(t.ty));

    pane.ctx.save();
    pane.ctx.setTransform(1, 0, 0, 1, 0, 0);
    pane.ctx.fillStyle = "#000";
    pane.ctx.fillRect(0, 0, w, h);
    drawContinuityCache(pane, newView, w, h);
    pane.ctx.imageSmoothingEnabled = !panOnly || frac > 1e-6;
    pane.ctx.setTransform(t.scale, 0, 0, t.scale, t.tx, t.ty);
    pane.ctx.drawImage(pane.snapshotCanvas, 0, 0);
    pane.ctx.restore();

    drawOverlays();

    if (panOnly) {
      return computeExposedRects(w, h, t.tx, t.ty);
    }
    return [fullPaneRect(pane)];
  }

  function cancelActiveRender(pane) {
    pane.renderToken++;
    pane.rendering = false;
  }

  function scheduleDeferredFullRender(pane, delayMs) {
    if (delayMs == null) delayMs = 140;
    if (pane.deferredFullTimer) clearTimeout(pane.deferredFullTimer);
    pane.deferredFullTimer = setTimeout(function () {
      pane.deferredFullTimer = null;
      scheduleRender(pane, { reason: "deferred-full", quality: "full" });
    }, delayMs);
  }

  function clearDeferredFullRender(pane) {
    if (pane.deferredFullTimer) {
      clearTimeout(pane.deferredFullTimer);
      pane.deferredFullTimer = null;
    }
  }

  function clearWheelZoomSettle(pane) {
    if (pane.wheelZoomSettleTimer) {
      clearTimeout(pane.wheelZoomSettleTimer);
      pane.wheelZoomSettleTimer = null;
    }
  }

  function endWheelZoomGesture(pane) {
    clearWheelZoomSettle(pane);
    if (!pane.wheelZoomActive) return;
    pane.wheelZoomActive = false;
    scheduleRender(pane, {
      reason: "wheel-zoom-settle-preview",
      quality: "preview",
      blocks: [16, 8, 4, 2]
    });
    scheduleDeferredFullRender(pane, 120);
    updateHud();
  }

  function beginWheelZoomGesture(pane) {
    if (pane.wheelZoomActive) return;
    pane.wheelZoomActive = true;
    clearDeferredFullRender(pane);
    cancelActiveRender(pane);
    captureContinuityFrame(pane, pane.view);
  }

  function scheduleWheelZoomSettle(pane, delayMs) {
    clearWheelZoomSettle(pane);
    pane.wheelZoomSettleTimer = setTimeout(function () {
      pane.wheelZoomSettleTimer = null;
      endWheelZoomGesture(pane);
    }, delayMs == null ? 140 : delayMs);
  }

  function buildRenderBlocks(request) {
    if (request.blocks && request.blocks.length) return request.blocks.slice();
    if (request.quality === "preview") {
      return request.partial ? [8, 4, 2] : [16, 8, 4, 2];
    }
    return request.partial ? [4, 2, 1] : [16, 8, 4, 2, 1];
  }

  function scheduleRender(pane, options) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (w <= 0 || h <= 0) return;

    const opts = options || {};
    const rects = opts.rects ? normalizeRects(opts.rects, w, h) : null;
    if (opts.rects && (!rects || rects.length === 0)) return;

    pane.pendingRequest = {
      reason: opts.reason || "render",
      quality: opts.quality || "full",
      rects: rects,
      partial: Boolean(rects),
      blocks: opts.blocks ? opts.blocks.slice() : null
    };

    if (opts.cancelCurrent !== false) cancelActiveRender(pane);
    if (pane.renderQueued) return;

    pane.renderQueued = true;
    requestAnimationFrame(function () {
      pane.renderQueued = false;
      if (!pane.pendingRequest) return;
      const request = pane.pendingRequest;
      pane.pendingRequest = null;
      startRenderJob(pane, request);
    });
  }

  function renderNoGpuMessage(pane) {
    fillBlack(pane);
    pane.ctx.save();
    pane.ctx.setTransform(1, 0, 0, 1, 0, 0);
    pane.ctx.fillStyle = "rgba(255,255,255,0.85)";
    pane.ctx.font = "14px system-ui, sans-serif";
    pane.ctx.fillText("WebGL unavailable", 16, 28);
    pane.ctx.fillStyle = "rgba(255,255,255,0.6)";
    pane.ctx.font = "12px system-ui, sans-serif";
    pane.ctx.fillText("This renderer now uses GPU acceleration.", 16, 48);
    pane.ctx.restore();
  }

  function gpuRenderRects(pane, rects, block) {
    if (!pane.gpu) {
      renderNoGpuMessage(pane);
      return false;
    }

    const gl = pane.gpu.gl;
    const program = pane.gpu.program;
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (w <= 0 || h <= 0) return false;

    if (pane.gpu.canvas.width !== w || pane.gpu.canvas.height !== h) {
      pane.gpu.canvas.width = w;
      pane.gpu.canvas.height = h;
    }

    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, pane.gpu.quad);
    gl.enableVertexAttribArray(pane.gpu.attribs.pos);
    gl.vertexAttribPointer(pane.gpu.attribs.pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(pane.gpu.uniforms.resolution, w, h);
    gl.uniform2f(pane.gpu.uniforms.center, pane.view.cx, pane.view.cy);
    gl.uniform1f(pane.gpu.uniforms.scale, pane.view.scale);
    gl.uniform2f(pane.gpu.uniforms.c, state.c.re, state.c.im);
    gl.uniform1f(pane.gpu.uniforms.paletteSpeed, state.paletteSpeed);
    gl.uniform1f(pane.gpu.uniforms.block, block);
    gl.uniform1f(pane.gpu.uniforms.kind, pane.kind === "mandelbrot" ? 0 : 1);
    gl.uniform1f(pane.gpu.uniforms.smooth, state.smoothColoring ? 1 : 0);
    gl.uniform1i(
      pane.gpu.uniforms.maxIter,
      Math.min(state.maxIter, (pane.gpu && pane.gpu.loopCap) || state.maxIter)
    );

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      gl.scissor(r.x, h - (r.y + r.h), r.w, r.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.flush();

    pane.ctx.save();
    pane.ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      pane.ctx.drawImage(
        pane.gpu.canvas,
        r.x, r.y, r.w, r.h,
        r.x, r.y, r.w, r.h
      );
    }
    pane.ctx.restore();

    pane.hasPixels = true;
    return true;
  }

  function startRenderJob(pane, request) {
    const w = pane.canvas.width;
    const h = pane.canvas.height;
    if (w <= 0 || h <= 0) return;

    const rects = request.rects ? request.rects.slice() : [fullPaneRect(pane)];
    const blocks = buildRenderBlocks(request);
    const token = ++pane.renderToken;
    pane.rendering = true;
    pane.lastRenderStartedAt = performance.now();
    updateHud();

    let taskIndex = 0;

    function nextTask() {
      if (token !== pane.renderToken) return;
      if (taskIndex >= blocks.length) {
        pane.rendering = false;
        const elapsed = performance.now() - pane.lastRenderStartedAt;
        if (pane.kind === "mandelbrot") state.renderStats.mandelbrotMs = elapsed;
        else state.renderStats.juliaMs = elapsed;

        const full = rects.length === 1 &&
          rects[0].x === 0 &&
          rects[0].y === 0 &&
          rects[0].w === w &&
          rects[0].h === h &&
          blocks.indexOf(1) !== -1;
        if (full) pane.lastExactView = copyView(pane.view);
        if (full) captureContinuityFrame(pane, pane.view, { preserveUsefulWider: true });

        updateHud();
        return;
      }

      const block = blocks[taskIndex++];
      gpuRenderRects(pane, rects, block);
      updateHud();
      requestAnimationFrame(nextTask);
    }

    requestAnimationFrame(nextTask);
  }

  function iterateMandelbrotQuick(cr, ci, maxIter) {
    let zr = 0;
    let zi = 0;
    let zr2 = 0;
    let zi2 = 0;
    let i = 0;
    while (i < maxIter && (zr2 + zi2) <= 4) {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      zr2 = zr * zr;
      zi2 = zi * zi;
      i++;
    }
    return i >= maxIter;
  }

  function approxMandelbrotMembership(re, im) {
    const maxIter = Math.min(Math.max(120, Math.floor(state.maxIter * 0.25)), 640);
    const key = re.toPrecision(17) + "," + im.toPrecision(17) + "," + maxIter;
    if (key === membershipCacheKey) return membershipCacheValue;
    membershipCacheKey = key;
    membershipCacheValue = iterateMandelbrotQuick(re, im, maxIter) ? "likely in set" : "escapes";
    return membershipCacheValue;
  }

  function updateHud() {
    dom.iterValue.textContent = String(state.maxIter);
    if (dom.iterInput && document.activeElement !== dom.iterInput) {
      dom.iterInput.value = String(state.maxIter);
    }
    dom.paletteValue.textContent = state.paletteSpeed.toFixed(1);

    const mandelDigits = digitsFromScale(panes.mandelbrot.view.scale, 8, 8, 18);
    const juliaDigits = digitsFromScale(panes.julia.view.scale, 8, 8, 18);
    const cDigits = digitsFromScale(panes.mandelbrot.view.scale, 10, 10, 18);

    dom.mandelbrotCenter.textContent = formatComplex(
      panes.mandelbrot.view.cx,
      panes.mandelbrot.view.cy,
      mandelDigits
    );
    dom.mandelbrotScale.textContent = formatNum(panes.mandelbrot.view.scale, Math.min(mandelDigits + 2, 18));
    dom.juliaCenter.textContent = formatComplex(
      panes.julia.view.cx,
      panes.julia.view.cy,
      juliaDigits
    );
    dom.juliaScale.textContent = formatNum(panes.julia.view.scale, Math.min(juliaDigits + 2, 18));

    dom.cValue.textContent = formatComplex(state.c.re, state.c.im, cDigits);
    dom.cMembership.textContent = approxMandelbrotMembership(state.c.re, state.c.im);
    dom.juliaEq.textContent = "z -> z^2 + (" + formatComplex(state.c.re, state.c.im, Math.min(cDigits, 14)) + ")";

    const m = panes.mandelbrot.canvas;
    const j = panes.julia.canvas;
    dom.mandelbrotMeta.textContent = Math.round(m.width) + "x" + Math.round(m.height) + " | " + Math.round(state.renderStats.mandelbrotMs) + " ms";
    dom.juliaMeta.textContent = Math.round(j.width) + "x" + Math.round(j.height) + " | " + Math.round(state.renderStats.juliaMs) + " ms";

    const mStatus = panes.mandelbrot.rendering ? "M:rendering" : "M:idle";
    const jStatus = panes.julia.rendering ? "J:rendering" : "J:idle";
    dom.renderStatus.textContent = (state.gpuAvailable ? ("GPU(" + state.maxGpuIterCap + ") | ") : "No WebGL | ") + mStatus + " " + jStatus;
  }

  function clampIteration(value) {
    const minIter = Number(dom.iterSlider.min || 50);
    const uiMax = Number(dom.iterSlider.max || 4096);
    return clamp(Math.round(value || minIter), minIter, uiMax);
  }

  function setMaxIter(nextValue, rerender) {
    const clamped = clampIteration(nextValue);
    if (clamped === state.maxIter) {
      updateHud();
      return;
    }
    state.maxIter = clamped;
    dom.iterSlider.value = String(clamped);
    if (dom.iterInput) dom.iterInput.value = String(clamped);
    if (rerender !== false) rerenderBothPreviewThenFull();
    updateHud();
  }

  function requestFullRefresh(pane) {
    scheduleRender(pane, { reason: "full-refresh", quality: "full" });
  }

  function resetPane(pane) {
    pane.view = copyView(pane.defaultView);
    requestFullRefresh(pane);
  }

  function fitJulia() {
    panes.julia.view = copyView(defaults.julia);
    requestFullRefresh(panes.julia);
    updateHud();
  }

  function applyPanContinuityAndRender(pane, dx, dy, recomputeDuringPan) {
    const allowRecompute = recomputeDuringPan !== false;
    const oldView = copyView(pane.view);
    panByPixels(pane, dx, dy);
    const exposed = reprojectCurrentFrame(pane, oldView, pane.view);
    if (allowRecompute && exposed.length) {
      scheduleRender(pane, {
        reason: "pan-exposed",
        quality: "preview",
        rects: exposed,
        blocks: [8, 4, 2]
      });
    }
    if (allowRecompute) scheduleDeferredFullRender(pane, 160);
    updateHud();
    return exposed;
  }

  function applyZoomContinuityAndRender(pane, px, py, zoomFactor, recomputeDuringZoom) {
    const allowRecompute = recomputeDuringZoom !== false;
    const oldView = copyView(pane.view);
    zoomAt(pane, px, py, zoomFactor);
    reprojectCurrentFrame(pane, oldView, pane.view);
    if (allowRecompute) {
      scheduleRender(pane, {
        reason: "zoom-preview",
        quality: "preview",
        blocks: [16, 8, 4, 2]
      });
      scheduleDeferredFullRender(pane, 130);
    }
    updateHud();
  }

  function attachPaneInteraction(pane) {
    const overlay = pane.overlay;

    overlay.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      overlay.setPointerCapture(event.pointerId);
      const pos = getPointerPos(event, pane);

      let mode = "pan";
      if (pane.kind === "mandelbrot") {
        const marker = complexToPixel(pane, state.c.re, state.c.im);
        const dx = pos.x - marker.x;
        const dy = pos.y - marker.y;
        if (dx * dx + dy * dy <= 16 * 16) mode = "drag-point";
      }

      interactions.set(event.pointerId, {
        pane,
        mode,
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
        moved: false,
        panGesturePrepared: false,
        totalDx: 0,
        totalDy: 0,
        lastExposedRects: []
      });

      pane.activePointer = event.pointerId;
      overlay.classList.add("dragging");
      event.preventDefault();
    });

    overlay.addEventListener("pointermove", function (event) {
      const interaction = interactions.get(event.pointerId);
      if (!interaction || interaction.pane !== pane) return;

      const pos = getPointerPos(event, pane);
      const dx = pos.x - interaction.lastX;
      const dy = pos.y - interaction.lastY;

      if (Math.abs(pos.x - interaction.startX) + Math.abs(pos.y - interaction.startY) > 1.5) {
        interaction.moved = true;
      }

      if (interaction.mode === "pan") {
        if (!interaction.panGesturePrepared) {
          interaction.panGesturePrepared = true;
          clearDeferredFullRender(pane);
          clearWheelZoomSettle(pane);
          pane.wheelZoomActive = false;
          cancelActiveRender(pane);
          captureContinuityFrame(pane, pane.view, { preserveUsefulWider: true });
        }
        interaction.totalDx += dx;
        interaction.totalDy += dy;
        interaction.lastExposedRects = applyPanContinuityAndRender(pane, dx, dy, false);
      } else if (interaction.mode === "drag-point") {
        const z = pixelToComplex(pane, pos.x, pos.y);
        state.c.re = z.re;
        state.c.im = z.im;
        drawOverlays();
        clearDeferredFullRender(panes.julia);
        scheduleRender(panes.julia, {
          reason: "julia-param-drag",
          quality: "preview",
          blocks: [16, 8, 4, 2]
        });
        scheduleDeferredFullRender(panes.julia, 120);
        updateHud();
      }

      interaction.lastX = pos.x;
      interaction.lastY = pos.y;
      event.preventDefault();
    });

    function endPointer(event) {
      const interaction = interactions.get(event.pointerId);
      if (!interaction || interaction.pane !== pane) return;

      interactions.delete(event.pointerId);
      pane.activePointer = null;
      overlay.classList.remove("dragging");

      const pos = getPointerPos(event, pane);

      if (pane.kind === "mandelbrot" && !interaction.moved && interaction.mode === "pan") {
        const z = pixelToComplex(pane, pos.x, pos.y);
        state.c.re = z.re;
        state.c.im = z.im;
        drawOverlays();
        clearDeferredFullRender(panes.julia);
        scheduleRender(panes.julia, { reason: "julia-param-click", quality: "full" });
        updateHud();
      }

      if (interaction.mode === "pan" && interaction.moved) {
        clearDeferredFullRender(pane);
        scheduleRender(pane, {
          reason: "pan-settle-preview",
          quality: "preview",
          blocks: [16, 8, 4, 2]
        });
        scheduleDeferredFullRender(pane, 110);
      } else if (interaction.mode === "drag-point") {
        clearDeferredFullRender(panes.julia);
        scheduleRender(panes.julia, { reason: "julia-param-drag-end", quality: "full" });
      }

      updateHud();
    }

    overlay.addEventListener("pointerup", endPointer);
    overlay.addEventListener("pointercancel", endPointer);
    overlay.addEventListener("lostpointercapture", function (event) {
      if (interactions.has(event.pointerId)) interactions.delete(event.pointerId);
      overlay.classList.remove("dragging");
    });

    overlay.addEventListener("wheel", function (event) {
      const pos = getPointerPos(event, pane);
      const zoomFactor = Math.exp(event.deltaY * 0.0014);
      beginWheelZoomGesture(pane);
      applyZoomContinuityAndRender(pane, pos.x, pos.y, zoomFactor, false);
      scheduleWheelZoomSettle(pane, 150);
      event.preventDefault();
    }, { passive: false });

    overlay.addEventListener("mouseup", function () {
      if (pane.wheelZoomActive) endWheelZoomGesture(pane);
    });

    overlay.addEventListener("mouseleave", function () {
      if (pane.wheelZoomActive) scheduleWheelZoomSettle(pane, 40);
    });

    overlay.addEventListener("dblclick", function (event) {
      const pos = getPointerPos(event, pane);
      endWheelZoomGesture(pane);
      applyZoomContinuityAndRender(pane, pos.x, pos.y, 0.5);
      clearDeferredFullRender(pane);
      scheduleRender(pane, { reason: "dblclick-zoom", quality: "full" });
      event.preventDefault();
    });
  }

  function rerenderBothPreviewThenFull() {
    clearDeferredFullRender(panes.mandelbrot);
    clearDeferredFullRender(panes.julia);
    scheduleRender(panes.mandelbrot, { reason: "settings-preview", quality: "preview", blocks: [16, 8, 4] });
    scheduleRender(panes.julia, { reason: "settings-preview", quality: "preview", blocks: [16, 8, 4] });
    scheduleDeferredFullRender(panes.mandelbrot, 120);
    scheduleDeferredFullRender(panes.julia, 120);
  }

  function wireControls() {
    dom.iterSlider.addEventListener("input", function () {
      setMaxIter(Number(dom.iterSlider.value), true);
    });

    if (dom.iterInput) {
      dom.iterInput.addEventListener("input", function () {
        const parsed = Number(dom.iterInput.value);
        if (Number.isFinite(parsed)) {
          state.maxIter = clampIteration(parsed);
          dom.iterSlider.value = String(state.maxIter);
          dom.iterValue.textContent = String(state.maxIter);
          updateHud();
        }
      });

      dom.iterInput.addEventListener("change", function () {
        setMaxIter(Number(dom.iterInput.value), true);
      });
    }

    dom.paletteSlider.addEventListener("input", function () {
      state.paletteSpeed = Number(dom.paletteSlider.value);
      rerenderBothPreviewThenFull();
      updateHud();
    });

    dom.smoothToggle.addEventListener("change", function () {
      state.smoothColoring = dom.smoothToggle.checked;
      requestFullRefresh(panes.mandelbrot);
      requestFullRefresh(panes.julia);
      updateHud();
    });

    dom.axesToggle.addEventListener("change", function () {
      state.showCrosshair = dom.axesToggle.checked;
      drawOverlays();
    });

    dom.resetAllBtn.addEventListener("click", function () {
      panes.mandelbrot.view = copyView(defaults.mandelbrot);
      panes.julia.view = copyView(defaults.julia);
      state.c = { re: -0.74543, im: 0.11301 };
      drawOverlays();
      requestFullRefresh(panes.mandelbrot);
      requestFullRefresh(panes.julia);
      updateHud();
    });

    dom.resetMandelBtn.addEventListener("click", function () {
      resetPane(panes.mandelbrot);
      drawOverlays();
      updateHud();
    });

    dom.resetJuliaBtn.addEventListener("click", function () {
      resetPane(panes.julia);
      updateHud();
    });

    dom.juliaFitBtn.addEventListener("click", fitJulia);
  }

  function configureIterationControls() {
    const minCap = state.maxGpuIterCap || 2048;
    const uiMax = clamp(minCap, 512, 4096);
    dom.iterSlider.max = String(uiMax);
    if (dom.iterInput) dom.iterInput.max = String(uiMax);
    setMaxIter(Math.min(state.maxIter, uiMax), false);
  }

  function boot() {
    configureIterationControls();
    attachPaneInteraction(panes.mandelbrot);
    attachPaneInteraction(panes.julia);
    wireControls();

    resizeObserver = new ResizeObserver(function () {
      resizeAll();
    });
    resizeObserver.observe(panes.mandelbrot.wrap);
    resizeObserver.observe(panes.julia.wrap);
    window.addEventListener("resize", resizeAll);

    resizeAll();
    updateHud();
  }

  boot();
})();
