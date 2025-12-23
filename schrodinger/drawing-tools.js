// Potential editing tools: brush, shapes, bucket fill, imports, and keyboard shortcuts.
function getCanvasCoords(event) {
  if (!potentialCanvas) return null;
  const rect = potentialCanvas.getBoundingClientRect();
  const scaleX = potentialCanvas.width / rect.width;
  const scaleY = potentialCanvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return {
    // Keep both floating and integer coordinates: brush strokes use subpixel
    // precision for smoother small sizes, while discrete tools use ints.
    x,
    y,
    xi: Math.floor(x),
    yi: Math.floor(y),
  };
}

function applyBrushAt(x, y, erase) {
  if (!potentialField || potentialWidth === 0 || potentialHeight === 0) return;

  const radius = brushSize;
  const radius2 = radius * radius;
  const hardness = Math.max(0, Math.min(1, brushHardness));

  const w = potentialWidth;
  const h = potentialHeight;

  const minX = Math.max(0, Math.floor(x - radius));
  const maxX = Math.min(w - 1, Math.ceil(x + radius));
  const minY = Math.max(0, Math.floor(y - radius));
  const maxY = Math.min(h - 1, Math.ceil(y + radius));

  const target = potentialGray / 255;

  for (let j = minY; j <= maxY; j++) {
    const dy = j - y;
    for (let i = minX; i <= maxX; i++) {
      const dx = i - x;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > radius2) continue;

      const dist = Math.sqrt(dist2);
      const t = dist / radius; // 0 at center, 1 at edge

      // Softer falloff profile:
      // - At minimum hardness, boundary is much smoother (wide, soft edge).
      // - At maximum hardness, still slightly softened instead of perfectly hard.
      const inner = hardness * 0.9; // inner fully-opaque core radius in [0, 0.9]
      const falloffWidth = 1 - inner || 1; // avoid division by zero

      // Exponent for smoothness: higher at low hardness, slightly >1 at high hardness.
      // Note: values that are too large here make the softest brush very "peaky",
      // which turns strokes into thin polylines instead of wide, soft blobs.
      const alphaMin = 2.5;
      const alphaMax = 1.3;
      const alpha = alphaMax + (1 - hardness) * (alphaMin - alphaMax);

      let strength;
      if (t <= inner) {
        strength = 1;
      } else {
        const u = (t - inner) / falloffWidth; // 0 at inner, 1 at edge
        const s = Math.max(0, 1 - u);
        strength = Math.pow(s, alpha);
      }

      if (strength <= 0) continue;

      const idx = j * w + i;
      const current = potentialField[idx] || 0;

      let next;
      if (erase) {
        next = current * (1 - strength);
      } else {
        next = current * (1 - strength) + target * strength;
      }

      // Do not clamp here: when both current and target are in [0, 1],
      // next is already a convex combination and stays in that range.
      // Allow values outside [0, 1] when painting on function-defined
      // or otherwise scaled potentials so hardness still behaves smoothly.
      potentialField[idx] = Number.isFinite(next) ? next : 0;
    }
  }
}

function applySplineSegment(p0, p1, p2, erase, isFirstSegment) {
  if (!p0 || !p1 || !p2) return false;
  if (!potentialField || potentialWidth === 0 || potentialHeight === 0) {
    return false;
  }

  const spacing = Math.max(1, brushSize * BRUSH_SPACING_FACTOR);

  const mid01x = (p0.x + p1.x) * 0.5;
  const mid01y = (p0.y + p1.y) * 0.5;
  const mid12x = (p1.x + p2.x) * 0.5;
  const mid12y = (p1.y + p2.y) * 0.5;

  const evalPoint = (t) => {
    const oneMinusT = 1 - t;
    const x =
      oneMinusT * oneMinusT * mid01x +
      2 * oneMinusT * t * p1.x +
      t * t * mid12x;
    const y =
      oneMinusT * oneMinusT * mid01y +
      2 * oneMinusT * t * p1.y +
      t * t * mid12y;
    return { x, y };
  };

  const roughSpan =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const minSamples = 8;
  const samples = Math.min(
    64,
    Math.max(minSamples, Math.ceil((roughSpan / spacing) * 4) || minSamples)
  );

  let drew = false;

  const stampAlongSegment = (x0, y0, x1, y1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let segLen = Math.hypot(dx, dy);
    if (!Number.isFinite(segLen) || segLen <= 0) return false;

    let localDrew = false;
    let remaining = segLen;
    let startX = x0;
    let startY = y0;

    while (strokeDistanceSinceLastStamp + remaining >= spacing) {
      const needed = spacing - strokeDistanceSinceLastStamp;
      const ratio = needed / remaining;
      const stampX = startX + (x1 - startX) * ratio;
      const stampY = startY + (y1 - startY) * ratio;

      applyBrushAt(stampX, stampY, erase);
      lastBrushX = stampX;
      lastBrushY = stampY;
      localDrew = true;
      drew = true;

      strokeDistanceSinceLastStamp = 0;
      startX = stampX;
      startY = stampY;
      remaining = Math.hypot(x1 - startX, y1 - startY);
      if (!Number.isFinite(remaining) || remaining <= 0) {
        break;
      }
    }

    strokeDistanceSinceLastStamp += remaining;
    return localDrew;
  };

  const startX = mid01x;
  const startY = mid01y;

  if (isFirstSegment) {
    stampAlongSegment(lastBrushX, lastBrushY, startX, startY);
  }

  let prev = { x: startX, y: startY };

  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const pt = evalPoint(t);
    stampAlongSegment(prev.x, prev.y, pt.x, pt.y);
    prev = pt;
  }

  return drew;
}

function applyLineWithBrush(x0, y0, x1, y1, erase) {
  if (!potentialField || potentialWidth === 0 || potentialHeight === 0) return;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);

  if (dist === 0) {
    applyBrushAt(x0, y0, erase);
    return;
  }

  const spacing = Math.max(1, brushSize * BRUSH_SPACING_FACTOR);
  const steps = Math.max(1, Math.floor(dist / spacing));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let s = 0; s <= steps; s++) {
    const px = x0 + stepX * s;
    const py = y0 + stepY * s;
    applyBrushAt(px, py, erase);
  }
}

function drawShapeStroke(x0, y0, x1, y1) {
  if (!potentialField || potentialWidth === 0 || potentialHeight === 0) return;

  const kind = currentShapeMode || "line";
  const regularActive = !!(shapeRegularEnabled || shapeRegularShiftActive);

  const drawLine = (ax, ay, bx, by) => {
    const originalBrushSize = brushSize;
    brushSize = shapeThickness;
    applyLineWithBrush(ax, ay, bx, by, false);
    brushSize = originalBrushSize;
  };

  const clampBounds = (minX, minY, maxX, maxY) => {
    const w = potentialWidth;
    const h = potentialHeight;
    return {
      minX: Math.max(0, Math.floor(minX)),
      minY: Math.max(0, Math.floor(minY)),
      maxX: Math.min(w - 1, Math.ceil(maxX)),
      maxY: Math.min(h - 1, Math.ceil(maxY)),
    };
  };

  const target = potentialGray / 255;

  const blendPixel = (idx, strength = 1) => {
    const current = potentialField[idx] || 0;
    const next = current * (1 - strength) + target * strength;
    potentialField[idx] = Math.max(0, Math.min(1, next));
  };

  const fillRect = (minX, minY, maxX, maxY) => {
    const { minX: x0b, minY: y0b, maxX: x1b, maxY: y1b } = clampBounds(
      minX,
      minY,
      maxX,
      maxY
    );
    const w = potentialWidth;
    for (let y = y0b; y <= y1b; y++) {
      const rowOffset = y * w;
      for (let x = x0b; x <= x1b; x++) {
        blendPixel(rowOffset + x);
      }
    }
  };

  const fillEllipse = (cx, cy, rx, ry) => {
    if (rx <= 0 || ry <= 0) return;
    const { minX, minY, maxX, maxY } = clampBounds(
      cx - rx,
      cy - ry,
      cx + rx,
      cy + ry
    );
    const w = potentialWidth;
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);
    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const rowOffset = y * w;
      const dyTerm = dy * dy * invRy2;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dxTerm = dx * dx * invRx2;
        if (dxTerm + dyTerm <= 1) {
          blendPixel(rowOffset + x);
        }
      }
    }
  };

  const fillTriangle = (ax, ay, bx, by, cx, cy) => {
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    const { minX: x0b, minY: y0b, maxX: x1b, maxY: y1b } = clampBounds(
      minX,
      minY,
      maxX,
      maxY
    );
    const w = potentialWidth;
    const denom =
      (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (denom === 0) return;
    for (let y = y0b; y <= y1b; y++) {
      const rowOffset = y * w;
      for (let x = x0b; x <= x1b; x++) {
        const px = x;
        const py = y;
        const w1 =
          ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const w2 =
          ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        const w3 = 1 - w1 - w2;
        if (
          w1 >= -1e-3 &&
          w2 >= -1e-3 &&
          w3 >= -1e-3
        ) {
          blendPixel(rowOffset + x);
        }
      }
    }
  };

  if (kind === "line") {
    drawLine(x0, y0, x1, y1);
    return;
  }

  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const dxRect = x1 - x0;
  const dyRect = y1 - y0;
  const width = Math.abs(dxRect);
  const height = Math.abs(dyRect);
  const dirX = dxRect >= 0 ? 1 : -1;
  const dirY = dyRect >= 0 ? 1 : -1;

  if (kind === "square") {
    let xL;
    let xR;
    let yT;
    let yB;

    if (!regularActive || width <= 0 || height <= 0) {
      xL = minX;
      xR = maxX;
      yT = minY;
      yB = maxY;
    } else {
      const side = Math.min(width, height);
      if (side <= 0) return;
      if (dirX >= 0 && dirY >= 0) {
        // Anchor at top-left (x0, y0)
        xL = x0;
        xR = x0 + side;
        yT = y0;
        yB = y0 + side;
      } else if (dirX < 0 && dirY >= 0) {
        // Anchor at top-right (x0, y0)
        xL = x0 - side;
        xR = x0;
        yT = y0;
        yB = y0 + side;
      } else if (dirX >= 0 && dirY < 0) {
        // Anchor at bottom-left (x0, y0)
        xL = x0;
        xR = x0 + side;
        yT = y0 - side;
        yB = y0;
      } else {
        // Anchor at bottom-right (x0, y0)
        xL = x0 - side;
        xR = x0;
        yT = y0 - side;
        yB = y0;
      }
    }
    drawLine(xL, yT, xR, yT);
    drawLine(xR, yT, xR, yB);
    drawLine(xR, yB, xL, yB);
    drawLine(xL, yB, xL, yT);
    if (shapeFillEnabled) {
      fillRect(xL, yT, xR, yB);
    }
    return;
  }

  if (kind === "triangle") {
    let xL = minX;
    let xR = maxX;
    let yT = minY;
    let yB = maxY;

    if (regularActive && width > 0 && height > 0) {
      const maxBaseFromWidth = width;
      const maxBaseFromHeight = (2 / Math.sqrt(3)) * height;
      const base = Math.min(maxBaseFromWidth, maxBaseFromHeight);
      if (base <= 0) return;
      const h = (Math.sqrt(3) / 2) * base;

      const ax = x0 + (dirX * base) / 2;
      const ay = y0;
      const bx = x0;
      const by = y0 + dirY * h;
      const cx = x0 + dirX * base;
      const cy = y0 + dirY * h;

      drawLine(ax, ay, bx, by);
      drawLine(bx, by, cx, cy);
      drawLine(cx, cy, ax, ay);
      if (shapeFillEnabled) {
        fillTriangle(ax, ay, bx, by, cx, cy);
      }
      return;
    }

    const ax = (xL + xR) / 2;
    const ay = yT;
    const bx = xL;
    const by = yB;
    const cx = xR;
    const cy = yB;
    drawLine(ax, ay, bx, by);
    drawLine(bx, by, cx, cy);
    drawLine(cx, cy, ax, ay);
    if (shapeFillEnabled) {
      fillTriangle(ax, ay, bx, by, cx, cy);
    }
    return;
  }

  if (kind === "circle") {
    let cx;
    let cy;
    let radiusX;
    let radiusY;

    if (!regularActive) {
      radiusX = width / 2;
      radiusY = height / 2;
      if (radiusX <= 0 || radiusY <= 0) return;
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
    } else {
      const side = Math.min(width, height);
      if (side <= 0) return;
      radiusX = side / 2;
      radiusY = side / 2;
      cx = x0 + dirX * radiusX;
      cy = y0 + dirY * radiusY;
    }

    const radius = Math.max(radiusX, radiusY);
    const baseSegments = 48;
    const segments = Math.max(
      baseSegments,
      Math.round(
        2 * Math.PI * radius / Math.max(4, shapeThickness)
      )
    );
    let prevX = cx + radiusX;
    let prevY = cy;
    for (let i = 1; i <= segments; i++) {
      const t = (i / segments) * 2 * Math.PI;
      const nx = cx + radiusX * Math.cos(t);
      const ny = cy + radiusY * Math.sin(t);
      drawLine(prevX, prevY, nx, ny);
      prevX = nx;
      prevY = ny;
    }

    if (shapeFillEnabled) {
      fillEllipse(cx, cy, radiusX, radiusY);
    }
  }
}

function bucketFill(startX, startY) {
  if (!potentialField || potentialWidth === 0 || potentialHeight === 0) return;

  const w = potentialWidth;
  const h = potentialHeight;

  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

  const index0 = startY * w + startX;
  const targetValue = potentialField[index0] || 0;
  const newValue = potentialGray / 255;

  let threshold = Number.isFinite(bucketTolerance)
    ? bucketTolerance
    : BUCKET_TOLERANCE;
  if (!Number.isFinite(threshold) || threshold <= 0) {
    threshold = BUCKET_TOLERANCE;
  }

  if (Math.abs(newValue - targetValue) < 0.01) return;

  // Preserve original field so we can compare against the seed color
  // even as we update potentialField during the fill.
  const originalField = potentialField.slice();

  const stack = [[startX, startY]];
  const visited = new Uint8Array(w * h);

  while (stack.length) {
    const [x, y] = stack.pop();
    const idx = y * w + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const v = originalField[idx] || 0;
    const diff = Math.abs(v - targetValue);
    if (diff >= threshold) continue;

    // Hazy edge: closer colors get a stronger fill, colors near the
    // tolerance edge get a very weak fill, and outside the tolerance
    // there is no fill at all.
    const t = diff / threshold; // 0 at exact match, 1 at threshold
    const strength = 1 - t; // 1 at center, 0 at threshold

    const oldVal = potentialField[idx] || 0;
    const blended = oldVal * (1 - strength) + newValue * strength;
    potentialField[idx] = Math.max(0, Math.min(1, blended));

    if (x > 0) stack.push([x - 1, y]);
    if (x < w - 1) stack.push([x + 1, y]);
    if (y > 0) stack.push([x, y - 1]);
    if (y < h - 1) stack.push([x, y + 1]);
  }
}

function clearPotential() {
  if (!potentialField) return;
  potentialField.fill(0);
  savePotentialHistory();
  redrawPotential();
}

function applyFunctionAsPotential(expression) {
  if (typeof expression !== "string") {
    alert("Please enter a potential function in x and y.");
    return;
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    alert("Please enter a potential function in x and y.");
    return;
  }

  if (typeof math === "undefined" || !math || typeof math.parse !== "function") {
    alert("math.js is not available, cannot parse potential.");
    return;
  }

  const w = potentialWidth;
  const h = potentialHeight;
  if (!w || !h) {
    alert("Potential grid is not initialized yet.");
    return;
  }

  let compiled;
  try {
    const node = math.parse(trimmed);
    compiled = typeof node.compile === "function" ? node.compile() : math.compile(trimmed);
  } catch (err) {
    console.error("[Schrödinger] Failed to parse potential function:", err);
    alert(
      "Could not parse potential function V(x, y).\n" +
        (err && err.message ? err.message : String(err))
    );
    return;
  }

  const newField = new Float32Array(w * h);

  const scaleFactor =
    typeof POTENTIAL_SCALE === "number" && POTENTIAL_SCALE !== 0
      ? POTENTIAL_SCALE
      : 1;

  const centerX = w / 2;
  const centerY = h / 2;
  const scalePos = getScalePos(w);

  const scope = { x: 0, y: 0 };

  try {
    let idx = 0;
    for (let j = 0; j < h; j++) {
      const yCoord = (centerY - j) / scalePos;
      scope.y = yCoord;
      for (let i = 0; i < w; i++) {
        const xCoord = (i - centerX) / scalePos;
        scope.x = xCoord;

        const result = compiled.evaluate(scope);
        const val = typeof result === "number" ? result : NaN;
        if (!Number.isFinite(val)) {
          throw new Error(
            `V(x, y) is not finite at x = ${xCoord.toFixed(
              3
            )}, y = ${yCoord.toFixed(3)}`
          );
        }

        const normalized = val / scaleFactor;
        newField[idx] = normalized;
        idx += 1;
      }
    }
  } catch (err) {
    console.error("[Schrödinger] Error evaluating potential function:", err);
    alert(
      "Could not evaluate potential function V(x, y).\n" +
        (err && err.message ? err.message : String(err))
    );
    return;
  }

  const n = newField.length;
  for (let i = 0; i < n; i++) {
    let v = newField[i];
    if (!Number.isFinite(v)) v = 0;
    newField[i] = v;
  }

  potentialField = newField;

  if (typeof savePotentialHistory === "function") {
    savePotentialHistory();
  }
  redrawPotential();
  if (typeof drawScene === "function") {
    drawScene();
  }

  if (typeof trackToolUsage === "function") {
    trackToolUsage("potential_equation_editor", {
      action: "apply_function",
      expression_length: trimmed.length,
    });
  }

  console.log("[Schrödinger] Applied function-defined potential:", trimmed);
}

function applyImageAsPotential(image) {
  if (!image || !potentialCanvas || typeof ImageData === "undefined") return;
  const w = potentialWidth;
  const h = potentialHeight;
  if (!w || !h) return;

  const offCanvas = document.createElement("canvas");
  offCanvas.width = w;
  offCanvas.height = h;
  const offCtx = offCanvas.getContext("2d");
  if (!offCtx) return;

  offCtx.drawImage(image, 0, 0, w, h);
  const imageData = offCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  if (!potentialField || potentialField.length !== w * h) {
    potentialField = new Float32Array(w * h);
  }

  const scale =
    typeof POTENTIAL_SCALE === "number" && Number.isFinite(POTENTIAL_SCALE)
      ? POTENTIAL_SCALE
      : 1;

  let rawMax = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const base = idx * 4;
      const r = data[base];
      const g = data[base + 1];
      const b = data[base + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const normalized = gray / 255;
      rawMax = Math.max(rawMax, normalized);
      potentialField[idx] = Math.max(0, normalized);
    }
  }

  const targetPhysicalMax =
    Number.isFinite(currentVMax) && currentVMax > 0
      ? currentVMax
      : rawMax * scale;

  if (rawMax > 0 && targetPhysicalMax > 0) {
    const factor = targetPhysicalMax / (rawMax * scale);
    const n = potentialField.length;
    for (let i = 0; i < n; i++) {
      const v = potentialField[i] || 0;
      potentialField[i] = Math.max(0, v * factor);
    }
    currentVMax = targetPhysicalMax;
  }

  if (typeof savePotentialHistory === "function") {
    savePotentialHistory();
  }
  redrawPotential();
  if (typeof drawScene === "function") {
    drawScene();
  }
  if (typeof document !== "undefined") {
    const vMaxEdit = document.getElementById("v-max-edit");
    const vMaxSlider = document.getElementById("v-max-slider");
    if (vMaxEdit && document.activeElement !== vMaxEdit) {
      vMaxEdit.value = Number.isFinite(currentVMax)
        ? currentVMax.toFixed(2)
        : vMaxEdit.value;
    }
    if (vMaxSlider && document.activeElement !== vMaxSlider) {
      vMaxSlider.value = Number.isFinite(currentVMax)
        ? String(currentVMax)
        : vMaxSlider.value;
    }
  }

  if (typeof trackToolUsage === "function") {
    trackToolUsage("potential_image_upload", {
      action: "apply_image",
      width: w,
      height: h,
    });
  }
}

function showEyedropperOverlay(event, normalizedValue) {
  if (
    !eyedropperOverlay ||
    !potentialCanvas ||
    !potentialCanvas.parentElement
  ) {
    return;
  }

  const canvasRect = potentialCanvas.getBoundingClientRect();
  const containerRect = potentialCanvas.parentElement.getBoundingClientRect();

  const xOnCanvas = event.clientX - canvasRect.left;
  const yOnCanvas = event.clientY - canvasRect.top;

  if (
    xOnCanvas < 0 ||
    yOnCanvas < 0 ||
    xOnCanvas > canvasRect.width ||
    yOnCanvas > canvasRect.height
  ) {
    eyedropperOverlay.style.display = "none";
    return;
  }

  const x = event.clientX - containerRect.left;
  const y = event.clientY - containerRect.top;

  const scaleFactor =
    typeof POTENTIAL_SCALE === "number" &&
    Number.isFinite(POTENTIAL_SCALE) &&
    POTENTIAL_SCALE !== 0
      ? POTENTIAL_SCALE
      : 1;

  const displayValue = Number.isFinite(normalizedValue)
    ? normalizedValue * scaleFactor
    : 0;

  eyedropperOverlay.textContent = `V = ${displayValue.toFixed(3)}`;
  eyedropperOverlay.style.left = `${x}px`;
  eyedropperOverlay.style.top = `${y}px`;
  eyedropperOverlay.style.display = "block";
}

function hideEyedropperOverlay() {
  if (eyedropperOverlay) {
    eyedropperOverlay.style.display = "none";
  }
}

function sampleEyedropperAt(x, y, event) {
  if (
    !potentialField ||
    potentialWidth === 0 ||
    potentialHeight === 0 ||
    x < 0 ||
    x >= potentialWidth ||
    y < 0 ||
    y >= potentialHeight
  ) {
    hideEyedropperOverlay();
    return;
  }

  const idx = y * potentialWidth + x;
  let vNormRaw = potentialField[idx] || 0;
  if (!Number.isFinite(vNormRaw)) vNormRaw = 0;

  const vNormClamped = Math.max(0, Math.min(1, vNormRaw));
  const gray = Math.round(vNormClamped * 255);

  const graySlider = document.getElementById("potential-gray");
  if (graySlider) {
    graySlider.value = String(gray);
    graySlider.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    potentialGray = gray;
  }

  showEyedropperOverlay(event, vNormRaw);
  console.log(
    "[Schrödinger] Eyedropper sample at",
    x,
    y,
    "V_norm =",
    vNormRaw.toFixed(3),
    "V_clamped =",
    vNormClamped.toFixed(3)
  );
}

function setupPotentialDrawing() {
  if (!potentialCanvas) return;

  const container = potentialCanvas.parentElement;
  if (container) {
    if (!brushPreview) {
      brushPreview = document.createElement("div");
      brushPreview.id = "brush-preview";
      brushPreview.className = "brush-preview";
      container.appendChild(brushPreview);
    }
    if (!eyedropperOverlay) {
      eyedropperOverlay = document.createElement("div");
      eyedropperOverlay.id = "eyedropper-overlay";
      eyedropperOverlay.className = "eyedropper-overlay";
      eyedropperOverlay.style.display = "none";
      container.appendChild(eyedropperOverlay);
    }
  }

  const pointerHoverTarget = potentialCanvas.parentElement || potentialCanvas;

  potentialCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    if (currentTool === "clear") {
      clearPotential();
      redrawPotential();
      if (typeof drawScene === "function") {
        drawScene();
      }
      console.log("[Schrödinger] Potential cleared");
      return;
    }

    const coords = getCanvasCoords(event);
    if (!coords) return;

    if (currentTool === "bucket") {
      bucketFill(coords.xi, coords.yi);
      redrawPotential();
      savePotentialHistory();
       if (typeof drawScene === "function") {
        drawScene();
      }
      console.log(
        "[Schrödinger] Bucket fill at",
        coords.xi,
        coords.yi,
        "gray =",
        potentialGray
      );
      return;
    }

    if (currentTool === "eyedropper") {
      isEyedropperSampling = true;
      sampleEyedropperAt(coords.xi, coords.yi, event);
      return;
    }

    if (currentTool === "move") {
      if (
        !potentialField ||
        potentialWidth === 0 ||
        potentialHeight === 0
      ) {
        return;
      }

      const startX = coords.xi;
      const startY = coords.yi;
      if (
        startX < 0 ||
        startX >= potentialWidth ||
        startY < 0 ||
        startY >= potentialHeight
      ) {
        return;
      }

      const startIdx = startY * potentialWidth + startX;
      const startVal = potentialField[startIdx] || 0;
      const EPS = 1e-4;
      if (Math.abs(startVal) <= EPS) {
        console.log(
          "[Schrödinger] Move tool: clicked on zero potential; nothing to move"
        );
        return;
      }

      const w = potentialWidth;
      const h = potentialHeight;

      const mask = new Uint8Array(w * h);
      const stack = [[startX, startY]];
      mask[startIdx] = 1;

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;

      while (stack.length) {
        const [x, y] = stack.pop();
        const idx = y * w + x;
        const v = potentialField[idx] || 0;
        if (Math.abs(v) <= EPS) continue;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (mask[nIdx]) continue;
          const nv = potentialField[nIdx] || 0;
          if (Math.abs(nv) <= EPS) continue;
          mask[nIdx] = 1;
          stack.push([nx, ny]);
        }
      }

      const selWidth = maxX - minX + 1;
      const selHeight = maxY - minY + 1;
      const selection = new Float32Array(selWidth * selHeight);
      const baseField = new Float32Array(potentialField);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const idx = y * w + x;
          if (!mask[idx]) continue;
          const localX = x - minX;
          const localY = y - minY;
          const val = potentialField[idx] || 0;
          selection[localY * selWidth + localX] = val;
          baseField[idx] = 0;
        }
      }

      moveSelectionData = selection;
      moveSelectionWidth = selWidth;
      moveSelectionHeight = selHeight;
      moveSelectionOriginX = minX;
      moveSelectionOriginY = minY;
      moveBaseField = baseField;
      moveDragStartX = coords.xi;
      moveDragStartY = coords.yi;

      isDrawing = true;
      strokeConstrainActive = false;
      strokeConstrainMode = null;
      didModifyPotentialThisStroke = false;

      // Keep the field unchanged until the user actually drags.
      // The move handler will clear the original component and
      // reapply it at the new position once there is motion.
      console.log(
        "[Schrödinger] Move tool: selected component at",
        startX,
        startY,
        "bounding box =",
        { minX, minY, maxX, maxY }
      );
      return;
    }
    if (currentTool === "shapes") {
      if (!potentialField || potentialWidth === 0 || potentialHeight === 0) {
        return;
      }

      shapeStartX = coords.xi;
      shapeStartY = coords.yi;
      shapeCurrentX = coords.xi;
      shapeCurrentY = coords.yi;
      shapeBaseField = new Float32Array(potentialField);

      isDrawing = true;
      strokeConstrainActive = false;
      strokeConstrainMode = null;
      didModifyPotentialThisStroke = false;
      return;
    }
    if (currentTool === "brush" || currentTool === "eraser") {
      isDrawing = true;
      strokeStartX = coords.x;
      strokeStartY = coords.y;
      strokeConstrainActive = !!event.shiftKey;
      strokeConstrainMode = null;
      didModifyPotentialThisStroke = false;
      lastBrushX = coords.x;
      lastBrushY = coords.y;
      strokeSplineP0 = { x: coords.x, y: coords.y };
      strokeSplineP1 = null;
      strokeDistanceSinceLastStamp = 0;
      strokeSplineSegmentIndex = 0;
      const erase = currentTool === "eraser";

      // If Shift is held and we have a previous click with the same tool,
      // draw a straight line between the previous and current points.
      if (
        event.shiftKey &&
        lastClickX !== null &&
        lastClickY !== null &&
        lastClickTool === currentTool
      ) {
        applyLineWithBrush(lastClickX, lastClickY, coords.x, coords.y, erase);
      } else {
        applyBrushAt(coords.x, coords.y, erase);
      }

      didModifyPotentialThisStroke = true;
      redrawPotential();
      console.log(
        `[Schrödinger] Stroke start (${currentTool}) at`,
        coords.x,
        coords.y
      );
    }
  });

  const updateBrushPreviewFromEvent = (event) => {
    if (!brushPreview || !potentialCanvas || !potentialCanvas.parentElement) {
      return;
    }

    if (!(currentTool === "brush" || currentTool === "eraser")) {
      hideBrushPreview();
      return;
    }

    // Hide brush preview while actively dragging particle controls.
    if (particleDragging) {
      hideBrushPreview();
      return;
    }

    // Hide brush preview whenever the cursor switches
    // to a particle drag/resize indicator.
    const target = event.target;
    if (target && target.closest) {
      // Center handle or momentum head: always "move" cursor.
      if (
        target.closest("#particle-center-handle") ||
        target.closest("#particle-p-head")
      ) {
        hideBrushPreview();
        return;
      }

      // Sigma circle: only hide when near the ring where the
      // resize cursor appears (not in the interior).
      if (particleSigmaCircle && target.closest("#particle-sigma-circle")) {
        const rect = particleSigmaCircle.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = event.clientX - centerX;
        const dy = event.clientY - centerY;
        const dist = Math.hypot(dx, dy);
        const radius = rect.width / 2;
        const bandWidth = 10;
        const nearRing =
          dist >= radius - bandWidth && dist <= radius + bandWidth;

        if (nearRing) {
          hideBrushPreview();
          return;
        }
      }
    }

    const canvasRect = potentialCanvas.getBoundingClientRect();
    const containerRect = potentialCanvas.parentElement.getBoundingClientRect();

    const xOnCanvas = event.clientX - canvasRect.left;
    const yOnCanvas = event.clientY - canvasRect.top;

    if (
      xOnCanvas < 0 ||
      yOnCanvas < 0 ||
      xOnCanvas > canvasRect.width ||
      yOnCanvas > canvasRect.height
    ) {
      hideBrushPreview();
      return;
    }

    const x = event.clientX - containerRect.left;
    const y = event.clientY - containerRect.top;

    const scaleX = canvasRect.width / potentialCanvas.width;
    const scaleY = canvasRect.height / potentialCanvas.height;
    const radiusCss = brushSize * Math.min(scaleX, scaleY);

    brushPreview.style.width = `${2 * radiusCss}px`;
    brushPreview.style.height = `${2 * radiusCss}px`;
    brushPreview.style.left = `${x}px`;
    brushPreview.style.top = `${y}px`;
    brushPreview.style.display = "block";
  };

  pointerHoverTarget.addEventListener("pointermove", (event) => {
    updateBrushPreviewFromEvent(event);

    if (currentTool === "eyedropper" && (event.buttons & 1)) {
      const coords = getCanvasCoords(event);
      if (coords) {
        sampleEyedropperAt(coords.xi, coords.yi, event);
      }
    }
  });

  pointerHoverTarget.addEventListener("pointerleave", () => {
    hideBrushPreview();
    hideEyedropperOverlay();
  });

  window.addEventListener("pointerup", () => {
    isEyedropperSampling = false;
    hideEyedropperOverlay();
  });
  window.addEventListener("pointercancel", () => {
    isEyedropperSampling = false;
    hideEyedropperOverlay();
  });

  const handleDrawMove = (event) => {
    if (!isDrawing) return;
    event.preventDefault();

    const coords = getCanvasCoords(event);
    if (!coords) return;

    const { x, y, xi, yi } = coords;

    if (currentTool === "brush" || currentTool === "eraser") {
      let px = x;
      let py = y;
      // Allow enabling constraint any time Shift is held during the stroke.
      // Once a constraint direction is chosen, it stays fixed until stroke end.
      if (event.shiftKey) {
        strokeConstrainActive = true;
      }

      if (strokeConstrainActive) {
        if (!strokeConstrainMode) {
          const dx0 = px - strokeStartX;
          const dy0 = py - strokeStartY;
          if (dx0 !== 0 || dy0 !== 0) {
            strokeConstrainMode =
              Math.abs(dx0) >= Math.abs(dy0) ? "horizontal" : "vertical";
          }
        }

        if (strokeConstrainMode === "horizontal") {
          py = strokeStartY;
        } else if (strokeConstrainMode === "vertical") {
          px = strokeStartX;
        }
      }

      const erase = currentTool === "eraser";
      const point = { x: px, y: py };

      if (!strokeSplineP0) {
        strokeSplineP0 = point;
        strokeSplineP1 = null;
      } else if (!strokeSplineP1) {
        strokeSplineP1 = point;
      } else {
        const isFirstSegment = strokeSplineSegmentIndex === 0;
        const drew = applySplineSegment(
          strokeSplineP0,
          strokeSplineP1,
          point,
          erase,
          isFirstSegment
        );
        strokeSplineP0 = strokeSplineP1;
        strokeSplineP1 = point;
        strokeSplineSegmentIndex += 1;
        if (drew) {
          didModifyPotentialThisStroke = true;
          redrawPotential();
        }
      }
    } else if (currentTool === "move") {
      if (
        !moveSelectionData ||
        !moveBaseField ||
        potentialWidth === 0 ||
        potentialHeight === 0
      ) {
        return;
      }

      const dx = Math.round(xi - moveDragStartX);
      const dy = Math.round(yi - moveDragStartY);

      const w2 = potentialWidth;
      const h2 = potentialHeight;
      potentialField.set(moveBaseField);

      const selW = moveSelectionWidth;
      const selH = moveSelectionHeight;
      const originX = moveSelectionOriginX + dx;
      const originY = moveSelectionOriginY + dy;

      const startXDraw = Math.max(0, originX);
      const startYDraw = Math.max(0, originY);
      const endXDraw = Math.min(w2 - 1, originX + selW - 1);
      const endYDraw = Math.min(h2 - 1, originY + selH - 1);

      if (startXDraw <= endXDraw && startYDraw <= endYDraw) {
        for (let yy = startYDraw; yy <= endYDraw; yy++) {
          const sy = yy - originY;
          const selRowOffset = sy * selW;
          const fieldRowOffset = yy * w2;
          for (let xx = startXDraw; xx <= endXDraw; xx++) {
            const sx = xx - originX;
            const val = moveSelectionData[selRowOffset + sx] || 0;
            if (!val) continue;
            const idx = fieldRowOffset + xx;
            const sum = (potentialField[idx] || 0) + val;
            potentialField[idx] = Math.max(0, Math.min(1, sum));
          }
        }
      }

      redrawPotential();
      didModifyPotentialThisStroke = true;
    } else if (currentTool === "shapes") {
      if (
        !shapeBaseField ||
        !potentialField ||
        potentialWidth === 0 ||
        potentialHeight === 0
      ) {
        return;
      }

      shapeCurrentX = xi;
      shapeCurrentY = yi;

      potentialField.set(shapeBaseField);
      drawShapeStroke(shapeStartX, shapeStartY, xi, yi);
      redrawPotential();
      didModifyPotentialThisStroke = true;
    }
  };

  const stop = () => {
    if (isDrawing && didModifyPotentialThisStroke) {
      // Remember the final stroke endpoint for future Shift-line strokes.
      if (currentTool === "brush" || currentTool === "eraser") {
        lastClickX = lastBrushX;
        lastClickY = lastBrushY;
        lastClickTool = currentTool;
      }
      savePotentialHistory();
      if (typeof drawScene === "function") {
        drawScene();
      }
    }
    isDrawing = false;
    strokeSplineP0 = null;
    strokeSplineP1 = null;
    strokeDistanceSinceLastStamp = 0;
    strokeSplineSegmentIndex = 0;
    strokeConstrainActive = false;
    strokeConstrainMode = null;
    didModifyPotentialThisStroke = false;
    moveSelectionData = null;
    moveBaseField = null;
    shapeBaseField = null;
    shapeRegularShiftActive = false;
  };

  window.addEventListener("pointermove", handleDrawMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function handlePotentialHistoryKeydown(event) {
  const key = event.key;

  // Brush size shortcuts with [ and ]
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === "[" && (currentTool === "brush" || currentTool === "eraser")) {
      event.preventDefault();
      applyBrushSizeDelta(-0.5);
      return;
    }
    if (key === "]" && (currentTool === "brush" || currentTool === "eraser")) {
      event.preventDefault();
      applyBrushSizeDelta(0.5);
      return;
    }
  }

  const isModifier = event.ctrlKey || event.metaKey;
  if (!isModifier) return;

  if (key === "z" || key === "Z") {
    event.preventDefault();
    if (event.shiftKey) {
      // Redo
      redoPotentialEdit();
    } else {
      // Undo
      undoPotentialEdit();
    }
  }
}

window.addEventListener("keydown", handlePotentialHistoryKeydown);

function updateShapeRegularShift(isDown) {
  shapeRegularShiftActive = !!isDown;

  const regularToggle = document.getElementById("shape-regular-toggle");
  if (regularToggle) {
    regularToggle.checked = !!(shapeRegularEnabled || shapeRegularShiftActive);
  }

  if (!isDrawing || currentTool !== "shapes") return;
  if (!shapeBaseField || !potentialField || potentialWidth === 0 || potentialHeight === 0) {
    return;
  }

  const hasCoords =
    Number.isFinite(shapeStartX) &&
    Number.isFinite(shapeStartY) &&
    Number.isFinite(shapeCurrentX) &&
    Number.isFinite(shapeCurrentY);
  if (!hasCoords) return;

  potentialField.set(shapeBaseField);
  drawShapeStroke(shapeStartX, shapeStartY, shapeCurrentX, shapeCurrentY);
  redrawPotential();
  didModifyPotentialThisStroke = true;
}

function handleShapeRegularKeydown(event) {
  if (event.key === "Shift") {
    updateShapeRegularShift(true);
  }
}

function handleShapeRegularKeyup(event) {
  if (event.key === "Shift") {
    updateShapeRegularShift(false);
  }
}

window.addEventListener("keydown", handleShapeRegularKeydown);
window.addEventListener("keyup", handleShapeRegularKeyup);

// --- Export / import setup (potential + initial conditions) ---

async function exportCurrentSetup() {
  if (!potentialField || potentialWidth === 0 || potentialHeight === 0) return;

  const controls =
    typeof getControlsState === "function" ? getControlsState() : null;

  let wavefunction = null;

  if (
    typeof wavefunctionCanBeReconstructedFromControls === "boolean" &&
    !wavefunctionCanBeReconstructedFromControls &&
    psiRe &&
    psiIm &&
    simWidth > 0 &&
    simHeight > 0 &&
    psiRe.length === simWidth * simHeight &&
    psiIm.length === simWidth * simHeight
  ) {
    const count = simWidth * simHeight;
    const re = new Array(count);
    const im = new Array(count);
    for (let i = 0; i < count; i++) {
      const reVal = psiRe[i];
      const imVal = psiIm[i];
      re[i] = Number.isFinite(reVal) ? reVal : 0;
      im[i] = Number.isFinite(imVal) ? imVal : 0;
    }

    let normFactor = 1;
    if (
      typeof currentNormFactor === "number" &&
      Number.isFinite(currentNormFactor) &&
      currentNormFactor !== 0
    ) {
      normFactor = currentNormFactor;
    }

    let savedSimTime = 0;
    if (typeof simTime === "number" && Number.isFinite(simTime)) {
      savedSimTime = simTime;
    }

    let savedFrameCount = 0;
    if (typeof frameCount === "number" && Number.isFinite(frameCount)) {
      savedFrameCount = Math.max(0, Math.floor(frameCount));
    }

    let savedPlotScaleFactor = 1;
    if (
      typeof plotScaleFactor === "number" &&
      Number.isFinite(plotScaleFactor) &&
      plotScaleFactor > 0
    ) {
      savedPlotScaleFactor = plotScaleFactor;
    }

    wavefunction = {
      width: simWidth,
      height: simHeight,
      re,
      im,
      normFactor,
      simTime: savedSimTime,
      frameCount: savedFrameCount,
      plotScaleFactor: savedPlotScaleFactor,
    };
  }

  let eigenstatesPayload = null;
  if (
    typeof getDiscoveredEigenstates === "function" &&
    simWidth > 0 &&
    simHeight > 0
  ) {
    const list = getDiscoveredEigenstates() || [];
    if (Array.isArray(list) && list.length) {
      const count = simWidth * simHeight;
      const states = [];
      for (let k = 0; k < list.length; k++) {
        const st = list[k];
        if (
          !st ||
          !st.re ||
          !st.im ||
          st.re.length !== count ||
          st.im.length !== count
        ) {
          continue;
        }
        states.push({
          re: Array.from(st.re),
          im: Array.from(st.im),
        });
      }
      if (states.length) {
        eigenstatesPayload = {
          width: simWidth,
          height: simHeight,
          states,
        };
      }
    }
  }

  let version = 1;
  if (wavefunction) {
    version = 2;
  }
  if (eigenstatesPayload) {
    version = 3;
  }

  let functionExpression = "";
  const functionInput = document.getElementById("potential-function-input");
  if (functionInput && typeof functionInput.value === "string") {
    functionExpression = functionInput.value.trim();
  }

  const potentialPayload = {
    width: potentialWidth,
    height: potentialHeight,
    data: Array.from(potentialField),
  };

  if (functionExpression) {
    potentialPayload.functionExpression = functionExpression;
  }

  const payload = {
    version,
    grid: {
      width:
        typeof currentResolutionWidth !== "undefined"
          ? currentResolutionWidth
          : potentialWidth,
      height:
        typeof currentResolutionHeight !== "undefined"
          ? currentResolutionHeight
          : potentialHeight,
    },
    potential: potentialPayload,
    initialCondition: controls || null,
    controls: {
      boundaryMode:
        typeof boundaryMode !== "undefined" ? boundaryMode : "open",
      timeStep:
        typeof currentTimeStep !== "undefined"
          ? currentTimeStep
          : typeof TIME_STEP !== "undefined"
          ? TIME_STEP
          : 0.1,
      imaginaryTime:
        typeof isImaginaryTime !== "undefined" ? !!isImaginaryTime : false,
      rescaleMode:
        typeof psiRescaleMode === "string" ? psiRescaleMode : "none",
      integrator:
        typeof integratorScheme === "string" ? integratorScheme : "crank",
      overlays: {
        colorbar:
          typeof showColorbar !== "undefined" ? !!showColorbar : true,
        energy:
          typeof showEnergy !== "undefined" ? !!showEnergy : true,
        phaseCircle:
          typeof showPhaseCircle !== "undefined" ? !!showPhaseCircle : false,
      },
      colormap:
        typeof activeColorSchemeId === "string"
          ? activeColorSchemeId
          : "phase",
    },
  };

  if (wavefunction) {
    payload.wavefunction = wavefunction;
  }

  if (eigenstatesPayload) {
    payload.eigenstates = eigenstatesPayload;
  }

  const jsonText = JSON.stringify(payload, null, 2);

  let blob;
  if (typeof JSZip !== "undefined") {
    try {
      const zip = new JSZip();
      zip.file("setup.json", jsonText);
      blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
    } catch (err) {
      console.error(
        "[Schrödinger] Failed to zip setup, falling back to plain JSON:",
        err
      );
      blob = new Blob([jsonText], { type: "application/json" });
    }
  } else {
    blob = new Blob([jsonText], { type: "application/json" });
  }

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "schrodinger-setup.psi";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(
    "[Schrödinger] Setup exported to",
    a.download,
    typeof JSZip !== "undefined" ? "with zip compression" : "without compression"
  );
}

async function loadSetupFromPsiArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) {
    throw new Error("Missing ArrayBuffer for .psi setup");
  }
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip is not available to read .psi setup");
  }

  const wasPlaying =
    typeof isPlaying === "boolean" ? isPlaying : false;
  if (typeof isPlaying !== "undefined") {
    isPlaying = false;
  }

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);

    let entry = zip.file("setup.json");
    if (!entry || !entry.length) {
      const candidates = zip.file(/\.json$/i);
      if (candidates && candidates.length) {
        entry = candidates[0];
      }
    }

    if (!entry || (entry.length && !entry[0])) {
      throw new Error("No JSON entry found in .psi archive");
    }

    const fileEntry = Array.isArray(entry) ? entry[0] : entry;
    const jsonText = await fileEntry.async("string");

    const obj = JSON.parse(String(jsonText || ""));
    applySetupObject(obj);
  } finally {
    if (typeof isPlaying !== "undefined") {
      isPlaying = wasPlaying;
    }
    if (wasPlaying) {
      if (typeof markSimulationStarted === "function") {
        markSimulationStarted();
      } else if (typeof creationToolsVisible !== "undefined") {
        creationToolsVisible = false;
        if (typeof updateParticleOverlay === "function") {
          updateParticleOverlay();
        }
      }
    }
  }
}

function applySetupObject(setup) {
  if (!setup || typeof setup !== "object") return;

  let appliedWavefunction = false;
  let loadedEigenstates = false;

  // Always clear any previously discovered eigenstates before applying a new setup.
  if (typeof clearEigenstates === "function") {
    clearEigenstates();
  } else if (typeof eigenstates !== "undefined") {
    eigenstates = [];
  }

  // Reset ψ rescaling to a neutral default for this setup;
  // the file can override this below if it specifies a mode.
  if (typeof psiRescaleMode !== "undefined") {
    psiRescaleMode = "none";
    const normInput = document.getElementById("psi-rescale-norm");
    const maxInput = document.getElementById("psi-rescale-max");
    if (normInput) {
      normInput.checked = false;
    }
    if (maxInput) {
      maxInput.checked = false;
    }
  }

  // 1) Grid resolution (if present)
  if (
    setup.grid &&
    Number.isFinite(setup.grid.width) &&
    Number.isFinite(setup.grid.height) &&
    typeof currentResolutionWidth !== "undefined" &&
    typeof currentResolutionHeight !== "undefined"
  ) {
    currentResolutionWidth = setup.grid.width;
    currentResolutionHeight = setup.grid.height;

    const latticeWidthInput = document.getElementById("lattice-width");
    const latticeHeightInput = document.getElementById("lattice-height");
    if (latticeWidthInput) {
      latticeWidthInput.value = String(currentResolutionWidth);
    }
    if (latticeHeightInput) {
      latticeHeightInput.value = String(currentResolutionHeight);
    }

    if (typeof canvasInitialized !== "undefined") {
      canvasInitialized = false;
    }
    if (typeof resizeCanvas === "function") {
      resizeCanvas();
    }
  }

  // 2) Potential field
  if (
    setup.potential &&
    Array.isArray(setup.potential.data) &&
    Number.isFinite(setup.potential.width) &&
    Number.isFinite(setup.potential.height)
  ) {
    const w = setup.potential.width;
    const h = setup.potential.height;
    const data = setup.potential.data;
    if (w > 0 && h > 0 && data.length === w * h) {
      if (!potentialField || potentialWidth !== w || potentialHeight !== h) {
        initPotentialField(w, h);
      }
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        // Preserve the raw potential values; function-defined potentials
        // may legitimately fall outside [0, 1].
        potentialField[i] = Number.isFinite(v) ? v : 0;
      }
      redrawPotential();
    }
  }

  const functionExpr =
    setup.potential &&
    typeof setup.potential.functionExpression === "string"
      ? setup.potential.functionExpression
      : "";

  const functionInput = document.getElementById("potential-function-input");
  if (functionInput) {
    functionInput.value = functionExpr;
  }

  if (functionExpr) {
    let activatedFunctionTool = false;
    if (typeof setActiveTool === "function") {
      activatedFunctionTool = !!setActiveTool("function", {
        trackEvent: false,
      });
    }
    if (!activatedFunctionTool) {
      const functionButton = document.querySelector(
        '.tool-button[data-tool="function"]'
      );
      if (functionButton && typeof functionButton.click === "function") {
        functionButton.click();
        activatedFunctionTool = true;
      }
    }
    if (!activatedFunctionTool && typeof currentTool !== "undefined") {
      currentTool = "function";
    }
  }

  // 3) Initial condition controls (x, y, px, py, sigma)
  if (setup.initialCondition) {
    const c = setup.initialCondition;
    if (typeof setSliderValue === "function") {
      if (Number.isFinite(c.x)) setSliderValue("x", c.x);
      if (Number.isFinite(c.y)) setSliderValue("y", c.y);
    }
    if (
      typeof setMomentumFromDisplay === "function" &&
      Number.isFinite(c.px) &&
      Number.isFinite(c.py)
    ) {
      setMomentumFromDisplay(c.px, c.py);
    } else if (typeof setSliderValue === "function") {
      if (Number.isFinite(c.px)) {
        const internalPx =
          typeof displayMomentumToInternal === "function"
            ? displayMomentumToInternal(c.px)
            : c.px;
        setSliderValue("px", internalPx);
      }
      if (Number.isFinite(c.py)) {
        const internalPy =
          typeof displayMomentumToInternal === "function"
            ? displayMomentumToInternal(c.py)
            : c.py;
        setSliderValue("py", internalPy);
      }
    }
    if (
      typeof setSigmaFromValue === "function" &&
      Number.isFinite(c.sigmaX)
    ) {
      setSigmaFromValue(c.sigmaX);
    }
  }

  // 4) Global controls (boundary mode, time step)
  if (setup.controls) {
    const c = setup.controls;
    if (typeof c.boundaryMode === "string") {
      const mode = c.boundaryMode === "closed" ? "closed" : "open";
      const boundarySelect = document.getElementById("boundary-mode");
      if (boundarySelect) {
        boundarySelect.value = mode;
        boundarySelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    if (Number.isFinite(c.timeStep)) {
      currentTimeStep = Math.max(0.001, Math.min(1, c.timeStep));
      const timeStepInput = document.getElementById("time-step-edit");
      if (timeStepInput) {
        timeStepInput.value = String(currentTimeStep);
      }
    }

    if (typeof c.imaginaryTime === "boolean" && typeof isImaginaryTime !== "undefined") {
      isImaginaryTime = c.imaginaryTime;
      const imaginaryToggle = document.getElementById("imaginary-time-toggle");
      if (imaginaryToggle) {
        imaginaryToggle.checked = !!isImaginaryTime;
      }
    }

    if (
      typeof c.rescaleMode === "string" &&
      typeof psiRescaleMode !== "undefined"
    ) {
      const mode =
        c.rescaleMode === "norm" || c.rescaleMode === "max"
          ? c.rescaleMode
          : "none";
      psiRescaleMode = mode;
      const normInput = document.getElementById("psi-rescale-norm");
      const maxInput = document.getElementById("psi-rescale-max");
      if (normInput) {
        normInput.checked = mode === "norm";
      }
      if (maxInput) {
        maxInput.checked = mode === "max";
      }
    }

    if (
      typeof c.integrator === "string" &&
      typeof integratorScheme !== "undefined"
    ) {
      const scheme = c.integrator === "euler" ? "euler" : "crank";
      integratorScheme = scheme;
      const integratorEulerInput = document.getElementById("integrator-euler");
      const integratorCrankInput = document.getElementById("integrator-crank");
      if (integratorEulerInput) {
        integratorEulerInput.checked = scheme === "euler";
      }
      if (integratorCrankInput) {
        integratorCrankInput.checked = scheme === "crank";
      }
    }

    if (c.overlays && typeof c.overlays === "object") {
      const overlays = c.overlays;

      if (typeof overlays.colorbar === "boolean") {
        if (typeof showColorbar !== "undefined") {
          showColorbar = overlays.colorbar;
        }
        const colorbarToggle = document.getElementById("toggle-colorbar");
        if (colorbarToggle) {
          colorbarToggle.checked = !!showColorbar;
        }
      }

      if (typeof overlays.energy === "boolean") {
        if (typeof showEnergy !== "undefined") {
          showEnergy = overlays.energy;
        }
        const energyToggle = document.getElementById("toggle-energy");
        if (energyToggle) {
          energyToggle.checked = !!showEnergy;
        }
      }

      if (typeof overlays.phaseCircle === "boolean") {
        if (typeof showPhaseCircle !== "undefined") {
          showPhaseCircle = overlays.phaseCircle;
        }
        const phaseCircleToggle = document.getElementById(
          "toggle-phase-circle"
        );
        if (phaseCircleToggle) {
          phaseCircleToggle.checked = !!showPhaseCircle;
        }
      }
    }

    if (typeof c.colormap === "string") {
      const schemeId = c.colormap;
      const colormapSelect = document.getElementById("colormap-select");

      if (colormapSelect) {
        colormapSelect.value = schemeId;
        colormapSelect.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (
        typeof activeColorSchemeId !== "undefined" &&
        typeof COMPLEX_COLOR_SCHEMES === "object" &&
        COMPLEX_COLOR_SCHEMES !== null
      ) {
        if (COMPLEX_COLOR_SCHEMES[schemeId]) {
          activeColorSchemeId = schemeId;
        } else {
          activeColorSchemeId = "phase";
        }
        if (typeof drawScene === "function") {
          drawScene();
        }
      }
    } else if (!("colormap" in c)) {
      const colormapSelect = document.getElementById("colormap-select");
      if (colormapSelect && colormapSelect.options && colormapSelect.options.length > 0) {
        const firstValue = colormapSelect.options[0].value;
        colormapSelect.value = firstValue;
        colormapSelect.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (
        typeof activeColorSchemeId !== "undefined" &&
        typeof COMPLEX_COLOR_SCHEMES === "object" &&
        COMPLEX_COLOR_SCHEMES !== null
      ) {
        const schemeIds = Object.keys(COMPLEX_COLOR_SCHEMES);
        const fallbackId = schemeIds.length > 0 ? schemeIds[0] : "phase";
        if (COMPLEX_COLOR_SCHEMES[fallbackId]) {
          activeColorSchemeId = fallbackId;
        } else {
          activeColorSchemeId = "phase";
        }
        if (typeof drawScene === "function") {
          drawScene();
        }
      }
    }
  }

  // 5) Explicit wavefunction (if present)
  if (
    setup.wavefunction &&
    typeof setup.wavefunction === "object" &&
    Array.isArray(setup.wavefunction.re) &&
    Array.isArray(setup.wavefunction.im) &&
    Number.isFinite(setup.wavefunction.width) &&
    Number.isFinite(setup.wavefunction.height)
  ) {
    const wf = setup.wavefunction;
    const w = wf.width;
    const h = wf.height;
    const reArr = wf.re;
    const imArr = wf.im;
    const count = w * h;

    let savedPlotScaleFactor = null;
    if (
      typeof wf.plotScaleFactor === "number" &&
      Number.isFinite(wf.plotScaleFactor) &&
      wf.plotScaleFactor > 0
    ) {
      savedPlotScaleFactor = wf.plotScaleFactor;
    }

    if (w > 0 && h > 0 && reArr.length === count && imArr.length === count) {
      if (!psiRe || !psiIm || simWidth !== w || simHeight !== h || psiRe.length !== count || psiIm.length !== count) {
        initSimulationGrid(w, h);
      }

      for (let i = 0; i < count; i++) {
        const reVal = reArr[i];
        const imVal = imArr[i];
        psiRe[i] = Number.isFinite(reVal) ? reVal : 0;
        psiIm[i] = Number.isFinite(imVal) ? imVal : 0;
      }

      if (
        typeof wf.normFactor === "number" &&
        Number.isFinite(wf.normFactor) &&
        typeof currentNormFactor !== "undefined"
      ) {
        currentNormFactor = wf.normFactor;
      }

      if (typeof simTime !== "undefined") {
        if (typeof wf.simTime === "number" && Number.isFinite(wf.simTime)) {
          simTime = wf.simTime;
        } else {
          simTime = 0;
        }
      }

      if (typeof frameCount !== "undefined") {
        if (
          typeof wf.frameCount === "number" &&
          Number.isFinite(wf.frameCount)
        ) {
          frameCount = Math.max(0, Math.floor(wf.frameCount));
        } else {
          frameCount = 0;
        }
      }

      if (typeof normalizeWavefunctionToUnitNorm === "function") {
        normalizeWavefunctionToUnitNorm();
      }
      if (typeof plotScaleFactor !== "undefined") {
        if (
          savedPlotScaleFactor !== null &&
          typeof savedPlotScaleFactor === "number" &&
          Number.isFinite(savedPlotScaleFactor) &&
          savedPlotScaleFactor > 0
        ) {
          plotScaleFactor = savedPlotScaleFactor;
        } else if (typeof updatePlotScaleFromCurrentPsi === "function") {
          updatePlotScaleFromCurrentPsi();
        }
      } else if (typeof updatePlotScaleFromCurrentPsi === "function") {
        updatePlotScaleFromCurrentPsi();
      }

      if (typeof initialPsiDirty !== "undefined") {
        initialPsiDirty = false;
      }

      if (typeof wavefunctionCanBeReconstructedFromControls !== "undefined") {
        wavefunctionCanBeReconstructedFromControls = false;
      }

      appliedWavefunction = true;

      if (typeof markSimulationStarted === "function") {
        markSimulationStarted();
      } else if (typeof creationToolsVisible !== "undefined") {
        creationToolsVisible = false;
      }
    }
  }

  // 6) Stored eigenstates (if present)
  if (
    setup.eigenstates &&
    typeof setup.eigenstates === "object" &&
    Array.isArray(setup.eigenstates.states)
  ) {
    const es = setup.eigenstates;
    const ew = Number.isFinite(es.width) ? es.width : simWidth;
    const eh = Number.isFinite(es.height) ? es.height : simHeight;
    const count = ew * eh;

    if (
      ew > 0 &&
      eh > 0 &&
      Number.isFinite(count) &&
      count > 0 &&
      typeof eigenstates !== "undefined" &&
      Array.isArray(es.states)
    ) {
      eigenstates = [];
      for (let k = 0; k < es.states.length; k++) {
        const st = es.states[k];
        if (
          !st ||
          !Array.isArray(st.re) ||
          !Array.isArray(st.im) ||
          st.re.length !== count ||
          st.im.length !== count
        ) {
          continue;
        }
        eigenstates.push({
          re: new Float32Array(st.re),
          im: new Float32Array(st.im),
        });
      }
      loadedEigenstates = eigenstates.length > 0;

      // If eigenstates are present, activate the Eigenstates tab so the
      // computed states are immediately visible.
      const eigenTab = document.querySelector('.wf-tab[data-tab="eigenstates"]');
      if (eigenTab && typeof eigenTab.click === "function") {
        eigenTab.click();
      }
    }
  }

  if (typeof savePotentialHistory === "function") {
    savePotentialHistory();
  }

  if (typeof markSimulationStopped === "function") {
    // If no explicit wavefunction was applied, treat the system as stopped; otherwise, visibility will be handled above.
    if (!appliedWavefunction) {
      markSimulationStopped();
    }
  }

  // When loading a setup without eigenstates, return to the Gaussian tab so the UI reflects the packet state.
  if (!loadedEigenstates) {
    const gaussianTab = document.querySelector('.wf-tab[data-tab="gaussian"]');
    if (gaussianTab && typeof gaussianTab.click === "function") {
      gaussianTab.click();
    }
  }

  drawScene();
  updateParticleOverlay();
  if (typeof captureGeneralPropertiesDefaults === "function") {
    captureGeneralPropertiesDefaults();
  }
  console.log(
    "[Schrödinger] Setup imported from JSON file",
    appliedWavefunction ? "(including explicit wavefunction)" : ""
  );
}
