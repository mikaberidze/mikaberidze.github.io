// Particle overlay geometry and drag handling.
let particleOverlay = null;
let particleCenterHandle = null;
let particleSigmaCircle = null;
let particleSigmaLabel = null;
let particlePLine = null;
let particlePHead = null;
let particlePLabel = null;

// When layout is not yet ready (e.g. the canvas has zero size),
// defer overlay positioning to the next animation frame so we
// don't lock in a misaligned overlay on first load.
let pendingParticleOverlayUpdate = null;

// Cached custom cursor for sigma resizing to avoid regenerating on every tiny move.
let sigmaCursorAngleCache = null;
let sigmaCursorUrlCache = null;

let particleDragging = false;
let particleDragMode = null; // "center" | "momentum" | "sigma"

// Momentum drag helpers
let momentumDragInitialDirX = 0;
let momentumDragInitialDirY = 0;
let momentumDragHasInitialDir = false;

// Center drag helpers
let centerDragStartXWorld = 0;
let centerDragStartYWorld = 0;
let centerDragStartInternalX = 0;
let centerDragStartInternalY = 0;

function getSigmaResizeCursor(angleRad) {
  // Quantize angle (in turns) to reduce the number of distinct cursors we generate.
  const turns = angleRad / (2 * Math.PI);
  const quantizedTurns = Math.round(turns * 64) / 64;
  const quantizedAngleRad = quantizedTurns * 2 * Math.PI;

  if (sigmaCursorAngleCache === quantizedAngleRad && sigmaCursorUrlCache) {
    return sigmaCursorUrlCache;
  }

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "ns-resize";

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  // Draw along the vertical axis, then rotate so the arrow points radially.
  ctx.rotate(quantizedAngleRad + Math.PI / 2);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Single geometry: same shaft length and triangle centers for both layers.
  const shaftLength = 11;
  const halfShaft = shaftLength / 2;
  const whiteHeadSize = 8; // slightly larger white triangles
  const blackHeadSize = 5;

  // Choose triangle centers so that the larger (white) heads still touch
  // the shaft ends, and the smaller (black) heads are centered on the same
  // points but sit fully inside the white ones.
  const centerOut = halfShaft + whiteHeadSize / 2;
  const centerIn = -halfShaft - whiteHeadSize / 2;

  function drawArrowLayer(shaftWidth, headSize, color) {
    const halfHead = headSize / 2;

    // Shaft
    ctx.strokeStyle = color;
    ctx.lineWidth = shaftWidth;
    ctx.beginPath();
    ctx.moveTo(0, -halfShaft);
    ctx.lineTo(0, halfShaft);
    ctx.stroke();

    // Outward arrowhead (toward +Y after rotation), centered at centerOut.
    ctx.beginPath();
    ctx.moveTo(0, centerOut + halfHead); // tip
    ctx.lineTo(-headSize, centerOut - halfHead); // base left
    ctx.lineTo(headSize, centerOut - halfHead); // base right
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Inward arrowhead (toward -Y after rotation), centered at centerIn.
    ctx.beginPath();
    ctx.moveTo(0, centerIn - halfHead); // tip
    ctx.lineTo(-headSize, centerIn + halfHead); // base left
    ctx.lineTo(headSize, centerIn + halfHead); // base right
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // First draw a larger white arrow (thicker shaft, larger triangles).
  drawArrowLayer(6, whiteHeadSize, "#ffffff");
  // Then draw a smaller black arrow on top with the same centers.
  drawArrowLayer(3, blackHeadSize, "#000000");

  ctx.restore();

  const url = canvas.toDataURL("image/png");
  sigmaCursorAngleCache = quantizedAngleRad;
  sigmaCursorUrlCache = url;
  // Hotspot at center so the cursor aligns with the pointer.
  return `url(${url}) ${size / 2} ${size / 2}, auto`;
}

function getParticleGeometry() {
  if (!canvas) return null;

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return null;

  const state = getControlsState();

  const scalePosX = getScalePos(width);
  // Use the same spatial scale for both axes so that the
  // overlay particle center matches the simulated packet center.
  const scalePosY = scalePosX;
  const centerX = width / 2 + state.x * scalePosX;
  const centerY = height / 2 - state.y * scalePosY;

  let sigma = state.sigmaX;
  if (!Number.isFinite(sigma) || sigma <= 0) {
    sigma = 0;
  }
  // Display radius is chosen to be twice the physical sigma extent
  const radius = Math.max(
    MIN_PARTICLE_RADIUS_PX,
    2 * Math.abs(sigma * Math.min(scalePosX, scalePosY))
  );

  // Momentum arrow scale: map |p| = MAX_P to one quarter of the canvas width.
  const maxP =
    typeof MAX_P === "number" && Number.isFinite(MAX_P) && MAX_P > 0
      ? MAX_P
      : 2;
  const pScale = (width * 0.25) / maxP;
  const headX = centerX + state.px * pScale;
  const headY = centerY - state.py * pScale;

  return {
    width,
    height,
    centerX,
    centerY,
    radius,
    headX,
    headY,
    scalePosX,
    scalePosY,
    pScale,
  };
}

function updateParticleOverlay() {
  if (!particleOverlay || !canvas) return;

  // Wave-packet creation tools only visible when explicitly enabled
  // and never while the simulation is running.
  if (!creationToolsVisible || isPlaying) {
    particleOverlay.style.display = "none";
    return;
  }

  const geom = getParticleGeometry();
  if (!geom) {
    particleOverlay.style.display = "none";
    return;
  }

  const container = canvas.parentElement;
  if (!container) {
    particleOverlay.style.display = "none";
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  // If the canvas has not been laid out yet (zero-sized),
  // postpone overlay positioning to the next animation frame.
  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    if (typeof window !== "undefined" && !pendingParticleOverlayUpdate) {
      pendingParticleOverlayUpdate = window.requestAnimationFrame(() => {
        pendingParticleOverlayUpdate = null;
        updateParticleOverlay();
      });
    }
    particleOverlay.style.display = "none";
    return;
  }

  const overlayLeft = canvasRect.left - containerRect.left;
  const overlayTop = canvasRect.top - containerRect.top;
  const overlayWidth = canvasRect.width;
  const overlayHeight = canvasRect.height;

  particleOverlay.style.display = "block";
  particleOverlay.style.left = `${overlayLeft}px`;
  particleOverlay.style.top = `${overlayTop}px`;
  particleOverlay.style.width = `${overlayWidth}px`;
  particleOverlay.style.height = `${overlayHeight}px`;

  const scaleCssX = overlayWidth / geom.width;
  const scaleCssY = overlayHeight / geom.height;

  const centerX = geom.centerX * scaleCssX;
  const centerY = geom.centerY * scaleCssY;
  const headX = geom.headX * scaleCssX;
  const headY = geom.headY * scaleCssY;
  const radius = geom.radius * Math.min(scaleCssX, scaleCssY);

  if (particleCenterHandle) {
    particleCenterHandle.style.left = `${centerX}px`;
    particleCenterHandle.style.top = `${centerY}px`;
  }

  if (particleSigmaCircle) {
    particleSigmaCircle.style.width = `${2 * radius}px`;
    particleSigmaCircle.style.height = `${2 * radius}px`;
    particleSigmaCircle.style.left = `${centerX}px`;
    particleSigmaCircle.style.top = `${centerY}px`;
  }

  // Sigma label is positioned via CSS relative to the circle

  // Momentum vector and label
  const dx = headX - centerX;
  const dy = headY - centerY;
  const len = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  if (particlePLine) {
    const midX = (centerX + headX) / 2;
    const midY = (centerY + headY) / 2;

    particlePLine.style.width = `${len}px`;
    particlePLine.style.left = `${midX}px`;
    particlePLine.style.top = `${midY}px`;
    particlePLine.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
  }

  const headAngleDeg = angleDeg + 180; // flip so triangle points outward

  if (particlePHead) {
    particlePHead.style.left = `${headX}px`;
    particlePHead.style.top = `${headY}px`;
    particlePHead.style.transform = `translate(-50%, -50%) rotate(${headAngleDeg}deg)`;
  }

  if (particlePLabel) {
    particlePLabel.style.left = `${headX}px`;
    particlePLabel.style.top = `${headY + 10}px`;
  }
}

function setSliderValue(id, value) {
  const slider = document.getElementById(id);
  if (!slider) return;
  const min = slider.min !== undefined ? parseFloat(slider.min) : undefined;
  const max = slider.max !== undefined ? parseFloat(slider.max) : undefined;
  let v = value;
  if (Number.isFinite(min)) v = Math.max(min, v);
  if (Number.isFinite(max)) v = Math.min(max, v);
  slider.value = String(v);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSigmaFromValue(sigma) {
  const slider = document.getElementById("sigma-x-slider");
  if (!slider) return;
  let pos = valueToPosition(sigma);
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  pos = Math.max(min, Math.min(max, pos));
  slider.value = String(pos);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function handleParticleDrag(event) {
  if (!particleOverlay || !canvas || !particleDragging || !particleDragMode) return;

  const clientX = event.clientX;
  const clientY = event.clientY;
  const shift = !!event.shiftKey;

  const overlayRect = particleOverlay.getBoundingClientRect();
  const overlayWidth = overlayRect.width;
  const overlayHeight = overlayRect.height;
  if (!overlayWidth || !overlayHeight) return;

  const xOverlay = clientX - overlayRect.left;
  const yOverlay = clientY - overlayRect.top;

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;

  const scaleCssX = overlayWidth / width;
  const scaleCssY = overlayHeight / height;

  const pxInternal = xOverlay / scaleCssX;
  const pyInternal = yOverlay / scaleCssY;

  const scalePosX = getScalePos(width);
  // Use the same spatial scale for both axes.
  const scalePosY = scalePosX;
  const centerXInternal = width / 2;
  const centerYInternal = height / 2;

  const state = getControlsState();

  if (particleDragMode === "center") {
    // Work in deltas from the drag start so free motion and
    // constrained motion are both well-behaved.
    const dxInternal = pxInternal - centerDragStartInternalX;
    const dyInternal = pyInternal - centerDragStartInternalY;

    let dxWorld = dxInternal / scalePosX;
    let dyWorld = -dyInternal / scalePosY;

    if (shift) {
      // Dynamic axis choice at each move:
      // decide whether the pointer is closer to a purely horizontal
      // or purely vertical displacement from the drag start.
      if (Math.abs(dyInternal) <= Math.abs(dxInternal)) {
        // Horizontal motion: zero out vertical component.
        dyWorld = 0;
      } else {
        // Vertical motion: zero out horizontal component.
        dxWorld = 0;
      }
    }

    const maxXWorld = width / (2 * scalePosX);
    const maxYWorld = height / (2 * scalePosY);
    const xWorld = Math.max(
      -maxXWorld,
      Math.min(maxXWorld, centerDragStartXWorld + dxWorld)
    );
    const yWorld = Math.max(
      -maxYWorld,
      Math.min(maxYWorld, centerDragStartYWorld + dyWorld)
    );
    setSliderValue("x", xWorld);
    setSliderValue("y", yWorld);
    return;
  }

  const centerX = centerXInternal + state.x * scalePosX;
  const centerY = centerYInternal - state.y * scalePosY;

  if (particleDragMode === "momentum") {
    const dx = pxInternal - centerX;
    const dy = pyInternal - centerY;
    // Use the same scaling as the overlay geometry so that
    // |p| = MAX_P spans one quarter of the canvas width.
    const maxP =
      typeof MAX_P === "number" && Number.isFinite(MAX_P) && MAX_P > 0
        ? MAX_P
        : 2;
    const pScale = (width * 0.25) / maxP;
    let px = dx / pScale;
    let py = -(dy / pScale);

    // If Shift is held, adjust only the magnitude of the
    // momentum vector along its initial direction, not its angle.
    if (shift && momentumDragHasInitialDir) {
      const ux = momentumDragInitialDirX;
      const uy = momentumDragInitialDirY;
      const proj = px * ux + py * uy;
      const mag = Math.max(0, proj); // do not flip direction
      px = ux * mag;
      py = uy * mag;
    }

    if (typeof setMomentumFromDisplay === "function") {
      setMomentumFromDisplay(px, py);
    } else {
      // Fallback: apply the length constraint locally and update sliders.
      const r = Math.hypot(px, py);
      const maxP =
        typeof MAX_P === "number" && Number.isFinite(MAX_P) && MAX_P > 0
          ? MAX_P
          : 2;

      if (Number.isFinite(r) && r > maxP) {
        const s = maxP / r;
        px *= s;
        py *= s;
      }

      const pxInternalValue =
        typeof displayMomentumToInternal === "function"
          ? displayMomentumToInternal(px)
          : px;
      const pyInternalValue =
        typeof displayMomentumToInternal === "function"
          ? displayMomentumToInternal(py)
          : py;

      setSliderValue("px", pxInternalValue);
      setSliderValue("py", pyInternalValue);
    }
    return;
  }

  if (particleDragMode === "sigma") {
    const dx = pxInternal - centerX;
    const dy = pyInternal - centerY;
    const dist = Math.max(5, Math.hypot(dx, dy));
    // Circle is drawn at radius = 2 * sigma * scalePosR,
    // so invert that factor here when dragging.
    const scalePosR = Math.min(scalePosX, scalePosY);
    let sigma = dist / (2 * scalePosR);
    if (!Number.isFinite(sigma) || sigma <= 1e-3) sigma = 1e-3;
    setSigmaFromValue(sigma);
  }
}

function setupParticleUI() {
  particleOverlay = document.getElementById("particle-overlay");
  if (!particleOverlay) return;

  particleCenterHandle = document.getElementById("particle-center-handle");
  particleSigmaCircle = document.getElementById("particle-sigma-circle");
  particleSigmaLabel = document.getElementById("particle-sigma-label");
  particlePLine = document.getElementById("particle-p-line");
  particlePHead = document.getElementById("particle-p-head");
  particlePLabel = document.getElementById("particle-p-label");

  const startDrag = (mode) => (event) => {
    if (isPlaying) return;
    particleDragMode = mode;
    particleDragging = true;

    if (mode === "center") {
      const state = getControlsState();
      const width = canvas ? canvas.width : 0;
      const height = canvas ? canvas.height : 0;
      const overlayRect = particleOverlay.getBoundingClientRect();
      const overlayWidth = overlayRect.width;
      const overlayHeight = overlayRect.height;

      centerDragStartXWorld = Number.isFinite(state.x) ? state.x : 0;
      centerDragStartYWorld = Number.isFinite(state.y) ? state.y : 0;

      if (width && height && overlayWidth && overlayHeight) {
        const scaleCssX = overlayWidth / width;
        const scaleCssY = overlayHeight / height;
        const xOverlay = event.clientX - overlayRect.left;
        const yOverlay = event.clientY - overlayRect.top;
        centerDragStartInternalX = xOverlay / scaleCssX;
        centerDragStartInternalY = yOverlay / scaleCssY;
      } else {
        const scalePosX = width ? getScalePos(width) : 1;
        const scalePosY = scalePosX;
        centerDragStartInternalX = width / 2 + centerDragStartXWorld * scalePosX;
        centerDragStartInternalY = height / 2 - centerDragStartYWorld * scalePosY;
      }
    }

    if (mode === "momentum") {
      const state = getControlsState();
      const px = Number.isFinite(state.px) ? state.px : 0;
      const py = Number.isFinite(state.py) ? state.py : 0;
      const len = Math.hypot(px, py);
      if (len > 1e-6) {
        momentumDragInitialDirX = px / len;
        momentumDragInitialDirY = py / len;
        momentumDragHasInitialDir = true;
      } else {
        momentumDragHasInitialDir = false;
      }
    }

    event.preventDefault();
    event.stopPropagation();
  };

  if (particleCenterHandle) {
    particleCenterHandle.addEventListener("pointerdown", startDrag("center"));
  }
  if (particlePHead) {
    particlePHead.addEventListener("pointerdown", startDrag("momentum"));
  }
  if (particleSigmaCircle) {
    particleSigmaCircle.addEventListener("pointerdown", (event) => {
      if (isPlaying) return;

      const rect = particleSigmaCircle.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const dist = Math.hypot(dx, dy);
      const radius = rect.width / 2;

      // Only start dragging when the pointer is close to the circle boundary,
      // not anywhere inside the disk.
      const bandWidth = 10; // pixels tolerance around the radius
      const nearRing =
        dist >= radius - bandWidth && dist <= radius + bandWidth;

      if (nearRing) {
        particleDragMode = "sigma";
        particleDragging = true;
        // Ensure resize cursor appears even on immediate click, oriented radially.
        const angle = Math.atan2(dy, dx);
        particleSigmaCircle.style.cursor = getSigmaResizeCursor(angle);
        event.preventDefault();
        event.stopPropagation();
      } else if (potentialCanvas) {
        // Forward clicks that are not on the boundary to the potential canvas
        // so that drawing tools (brush, eraser, etc.) still work under the circle.
        const synthetic = new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          button: event.button,
          buttons: event.buttons,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        });
        potentialCanvas.dispatchEvent(synthetic);
      }
    });
  }

  window.addEventListener("pointermove", (event) => {
    // Keep the radial resize cursor updated both on hover and while dragging sigma.
    if (particleSigmaCircle && !isPlaying) {
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
      const angle = Math.atan2(dy, dx);

      if (!particleDragging) {
        // Hover: show resize cursor only near the sigma circle boundary.
        if (nearRing) {
          particleSigmaCircle.style.cursor = getSigmaResizeCursor(angle);
        } else {
          particleSigmaCircle.style.cursor = "default";
        }
      } else if (particleDragMode === "sigma") {
        // While dragging sigma, keep the cursor rotating with the angle.
        particleSigmaCircle.style.cursor = getSigmaResizeCursor(angle);
      }
    }

    if (!particleDragging) return;
    handleParticleDrag(event);
  });

  const stop = () => {
    if (!particleDragging) return;
    particleDragging = false;
    particleDragMode = null;
    momentumDragHasInitialDir = false;

    // Commit a single history entry for this completed drag of the
    // wave-function initial condition controls.
    if (typeof savePotentialHistory === "function") {
      savePotentialHistory();
    }
  };

  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);

  updateParticleOverlay();
}
