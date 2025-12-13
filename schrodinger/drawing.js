// Canvas sizing, potential drawing, and particle overlay

let potentialCanvas;
let potentialCtx;

let particleOverlay = null;
let particleCenterHandle = null;
let particleSigmaCircle = null;
let particleSigmaLabel = null;
let particlePLine = null;
let particlePHead = null;
let particlePLabel = null;

// Cached custom cursor for sigma resizing to avoid regenerating on every tiny move.
let sigmaCursorAngleCache = null;
let sigmaCursorUrlCache = null;

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

let brushPreview = null;
let eyedropperOverlay = null;

let isEyedropperSampling = false;

let particleDragging = false;
let particleDragMode = null; // "center" | "momentum" | "sigma"
let creationToolsVisible = true;

// Momentum drag helpers
let momentumDragInitialDirX = 0;
let momentumDragInitialDirY = 0;
let momentumDragHasInitialDir = false;

// Center drag helpers
let centerDragStartXWorld = 0;
let centerDragStartYWorld = 0;
let centerDragStartInternalX = 0;
let centerDragStartInternalY = 0;

let canvasInitialized = false;

let currentTool = null;
let potentialGray = INITIAL_POTENTIAL_GRAY;
let brushSize = INITIAL_BRUSH_SIZE;
let brushHardness = INITIAL_BRUSH_HARDNESS;
let shapeThickness = INITIAL_SHAPE_THICKNESS;
let currentShapeMode = "line"; // "line" | "triangle" | "square" | "circle"
let shapeFillEnabled = false;
let shapeRegularEnabled = false;
let shapeRegularShiftActive = false;
let currentVMax = INITIAL_V_MAX;
let isDrawing = false;
let strokeStartX = 0;
let strokeStartY = 0;
let strokeConstrainActive = false;
let strokeConstrainMode = null; // "horizontal" | "vertical" | null
let didModifyPotentialThisStroke = false;
let lastBrushX = 0;
let lastBrushY = 0;
let lastClickX = null;
let lastClickY = null;
let lastClickTool = null; // "brush" | "eraser" | null
let strokeSplineP0 = null;
let strokeSplineP1 = null;
let strokeDistanceSinceLastStamp = 0;
let strokeSplineSegmentIndex = 0;

// Move-tool state: selected connected component of the potential field.
let moveSelectionData = null;
let moveSelectionWidth = 0;
let moveSelectionHeight = 0;
let moveSelectionOriginX = 0;
let moveSelectionOriginY = 0;
let moveBaseField = null;
let moveDragStartX = 0;
let moveDragStartY = 0;

// Shapes-tool state.
let shapeStartX = 0;
let shapeStartY = 0;
let shapeCurrentX = 0;
let shapeCurrentY = 0;
let shapeBaseField = null;

// Potential + initial-condition history (for undo/redo)
let potentialHistory = [];
let historyIndex = -1;

function savePotentialHistory() {
  const potentialSnapshot =
    potentialField && potentialWidth > 0 && potentialHeight > 0
      ? {
          width: potentialWidth,
          height: potentialHeight,
          data: new Float32Array(potentialField),
        }
      : null;

  let controlsSnapshot = null;
  if (typeof getControlsState === "function") {
    try {
      const state = getControlsState();
      if (state) {
        controlsSnapshot = {
          x: state.x,
          y: state.y,
          px: state.px,
          py: state.py,
          sigmaX: state.sigmaX,
          sigmaP: state.sigmaP,
        };
      }
    } catch {
      // ignore failures to read controls
    }
  }

  let gridSnapshot = null;
  if (
    typeof currentResolutionWidth !== "undefined" &&
    typeof currentResolutionHeight !== "undefined"
  ) {
    gridSnapshot = {
      width: currentResolutionWidth,
      height: currentResolutionHeight,
    };
  }

  let globalControlsSnapshot = null;
  if (
    typeof boundaryMode !== "undefined" ||
    typeof currentTimeStep !== "undefined" ||
    typeof isImaginaryTime !== "undefined" ||
    typeof psiRescaleMode !== "undefined"
  ) {
    const timeStepValue =
      typeof currentTimeStep === "number"
        ? currentTimeStep
        : typeof TIME_STEP === "number"
        ? TIME_STEP
        : 0.1;
    const modeValue =
      typeof boundaryMode === "string" ? boundaryMode : "open";
    const rescaleModeValue =
      typeof psiRescaleMode === "string" ? psiRescaleMode : "none";
    globalControlsSnapshot = {
      boundaryMode: modeValue === "closed" ? "closed" : "open",
      timeStep: Math.max(0.001, Math.min(1, timeStepValue)),
      imaginaryTime: !!(
        typeof isImaginaryTime !== "undefined" && isImaginaryTime
      ),
      rescaleMode: rescaleModeValue === "norm" || rescaleModeValue === "max"
        ? rescaleModeValue
        : "none",
    };
  }

  if (
    !potentialSnapshot &&
    !controlsSnapshot &&
    !gridSnapshot &&
    !globalControlsSnapshot
  ) {
    return;
  }

  const snapshot = {
    potential: potentialSnapshot,
    controls: controlsSnapshot,
    grid: gridSnapshot,
    globals: globalControlsSnapshot,
  };

  // If we've undone some steps, discard forward history before saving
  if (historyIndex < potentialHistory.length - 1) {
    potentialHistory = potentialHistory.slice(0, historyIndex + 1);
  }

  potentialHistory.push(snapshot);

  // Trim history to a reasonable maximum
  if (potentialHistory.length > MAX_HISTORY) {
    const excess = potentialHistory.length - MAX_HISTORY;
    potentialHistory.splice(0, excess);
    historyIndex = Math.max(0, historyIndex - excess);
  }

  historyIndex = potentialHistory.length - 1;

  updateHistoryButtonsUI();
}

function resetPotentialHistory() {
  potentialHistory = [];
  historyIndex = -1;
  savePotentialHistory();
}

function updateHistoryButtonsUI() {
  const undoButton = document.getElementById("undo-button");
  const redoButton = document.getElementById("redo-button");

  const canUndo = historyIndex > 0;
  const canRedo =
    historyIndex >= 0 && historyIndex < potentialHistory.length - 1;

  if (undoButton) {
    undoButton.disabled = !canUndo;
  }
  if (redoButton) {
    redoButton.disabled = !canRedo;
  }
}

function restorePotentialFromHistory(index) {
  if (index < 0 || index >= potentialHistory.length) return;
  const snapshot = potentialHistory[index];
  if (!snapshot) return;

  let requirePsiReset = false;
  let potentialChanged = false;

  // Current control state before applying snapshot, for change detection.
  let currentControls = null;
  if (typeof getControlsState === "function") {
    try {
      currentControls = getControlsState();
    } catch {
      currentControls = null;
    }
  }

  const epsilon = 1e-6;

  // 1) Grid resolution (lattice size)
  if (
    snapshot.grid &&
    Number.isFinite(snapshot.grid.width) &&
    Number.isFinite(snapshot.grid.height)
  ) {
    const w = snapshot.grid.width;
    const h = snapshot.grid.height;

    const currentW =
      typeof currentResolutionWidth !== "undefined"
        ? currentResolutionWidth
        : canvas
        ? canvas.width
        : w;
    const currentH =
      typeof currentResolutionHeight !== "undefined"
        ? currentResolutionHeight
        : canvas
        ? canvas.height
        : h;

    const gridChanged = w !== currentW || h !== currentH;

    if (gridChanged) {
      if (
        typeof currentResolutionWidth !== "undefined" &&
        typeof currentResolutionHeight !== "undefined"
      ) {
        currentResolutionWidth = w;
        currentResolutionHeight = h;
      }

      const latticeWidthInput = document.getElementById("lattice-width");
      const latticeHeightInput = document.getElementById("lattice-height");
      if (latticeWidthInput) {
        latticeWidthInput.value = String(w);
      }
      if (latticeHeightInput) {
        latticeHeightInput.value = String(h);
      }

      if (canvas) {
        canvas.width = w;
        canvas.height = h;
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        initSimulationGrid(w, h);
      }

      if (potentialCanvas) {
        potentialCanvas.width = w;
        potentialCanvas.height = h;
        if (potentialCtx) {
          potentialCtx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }

      if (
        typeof overlayCanvas !== "undefined" &&
        overlayCanvas &&
        typeof OVERLAY_SUPERSAMPLE_FACTOR === "number"
      ) {
        const factor =
          OVERLAY_SUPERSAMPLE_FACTOR > 0 ? OVERLAY_SUPERSAMPLE_FACTOR : 1;
        overlayCanvas.width = Math.round(w * factor);
        overlayCanvas.height = Math.round(h * factor);
        if (typeof overlayCtx !== "undefined" && overlayCtx) {
          overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }

      if (typeof canvasInitialized !== "undefined") {
        canvasInitialized = true;
      }

      if (typeof resizeCanvas === "function") {
        resizeCanvas();
      }

      requirePsiReset = true;
    }
  }

  // 2) Potential field
  if (
    snapshot.potential &&
    Number.isFinite(snapshot.potential.width) &&
    Number.isFinite(snapshot.potential.height) &&
    snapshot.potential.data instanceof Float32Array
  ) {
    const w = snapshot.potential.width;
    const h = snapshot.potential.height;

    if (!potentialField || potentialWidth !== w || potentialHeight !== h) {
      initPotentialField(w, h);
    }

    if (potentialField && potentialField.length === snapshot.potential.data.length) {
      potentialField.set(snapshot.potential.data);
      redrawPotential();
      potentialChanged = true;
    }
  }

  // 3) Initial-condition controls (x, y, px, py, sigma)
  if (snapshot.controls && currentControls) {
    const c = snapshot.controls;
    let controlsChanged = false;

    if (Number.isFinite(c.x) && Math.abs(c.x - currentControls.x) > epsilon) {
      controlsChanged = true;
    }
    if (Number.isFinite(c.y) && Math.abs(c.y - currentControls.y) > epsilon) {
      controlsChanged = true;
    }
    if (Number.isFinite(c.px) && Math.abs(c.px - currentControls.px) > epsilon) {
      controlsChanged = true;
    }
    if (Number.isFinite(c.py) && Math.abs(c.py - currentControls.py) > epsilon) {
      controlsChanged = true;
    }
    if (
      Number.isFinite(c.sigmaX) &&
      Math.abs(c.sigmaX - currentControls.sigmaX) > epsilon
    ) {
      controlsChanged = true;
    }

    if (controlsChanged) {
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

      requirePsiReset = true;
    }
  }

  // 4) Global controls (boundary conditions and time step)
  if (snapshot.globals) {
    const g = snapshot.globals;

    if (typeof g.boundaryMode === "string") {
      const mode = g.boundaryMode === "closed" ? "closed" : "open";
      boundaryMode = mode;

      const boundarySelect = document.getElementById("boundary-mode");
      if (boundarySelect) {
        boundarySelect.value = mode;
      }
    }

    if (Number.isFinite(g.timeStep)) {
      currentTimeStep = Math.max(0.001, Math.min(1, g.timeStep));
      const timeStepInput = document.getElementById("time-step-edit");
      if (timeStepInput) {
        timeStepInput.value = String(currentTimeStep);
      }
    }

    if (typeof g.imaginaryTime === "boolean" && typeof isImaginaryTime !== "undefined") {
      isImaginaryTime = g.imaginaryTime;
      const imaginaryToggle = document.getElementById("imaginary-time-toggle");
      if (imaginaryToggle) {
        imaginaryToggle.checked = !!isImaginaryTime;
      }
    }

    if (
      typeof g.rescaleMode === "string" &&
      typeof psiRescaleMode !== "undefined"
    ) {
      const mode =
        g.rescaleMode === "norm" || g.rescaleMode === "max"
          ? g.rescaleMode
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
  }

  // If lattice size or particle properties changed, restart the wavefunction.
  if (requirePsiReset && typeof resetWavefunctionFromControls === "function") {
    // Stop the simulation instead of keeping it running.
    if (typeof isPlaying !== "undefined") {
      isPlaying = false;
    }

    if (typeof simTime !== "undefined") {
      simTime = 0;
    }
    if (typeof frameCount !== "undefined") {
      frameCount = 0;
    }
    resetWavefunctionFromControls();
    if (typeof drawScene === "function") {
      drawScene();
    }

    // Re-enable wave-packet creation tools and sync the play button UI.
    if (typeof creationToolsVisible !== "undefined") {
      creationToolsVisible = true;
    }
    const playPauseButton = document.getElementById("play-pause");
    if (playPauseButton) {
      const playPauseIcon =
        playPauseButton.querySelector(".transport-icon") || playPauseButton;
      playPauseIcon.textContent = "▶";
    }
    const saveButton = document.getElementById("save-setup");
    if (saveButton) {
      saveButton.disabled = false;
    }
    if (typeof updateParticleOverlay === "function") {
      updateParticleOverlay();
    }
  } else if (potentialChanged && typeof drawScene === "function") {
    // Potential-only history changes should still refresh the quantum canvas,
    // so the colorbar and energy overlay stay in sync with the current field.
    drawScene();
  }

  historyIndex = index;

  updateHistoryButtonsUI();
}

function undoPotentialEdit() {
  if (historyIndex > 0) {
    restorePotentialFromHistory(historyIndex - 1);
    console.log("[Schrödinger] Undo potential edit, history index =", historyIndex);
  }
}

function redoPotentialEdit() {
  if (historyIndex >= 0 && historyIndex < potentialHistory.length - 1) {
    restorePotentialFromHistory(historyIndex + 1);
    console.log("[Schrödinger] Redo potential edit, history index =", historyIndex);
  }
}

function applyBrushSizeDelta(delta) {
  const slider = document.getElementById("brush-size");

  if (slider) {
    const min =
      slider.min !== undefined && slider.min !== ""
        ? parseFloat(slider.min) || 1
        : 1;
    const max =
      slider.max !== undefined && slider.max !== ""
        ? parseFloat(slider.max) || 60
        : 60;

    let current =
      slider.value !== undefined && slider.value !== ""
        ? parseFloat(slider.value)
        : brushSize;
    if (!Number.isFinite(current)) current = brushSize;

    let next = current + delta;
    next = Math.max(min, Math.min(max, next));
    if (next === current) return;

    slider.value = String(next);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    let next = brushSize + delta;
    next = Math.max(1, Math.min(60, next));
    if (next === brushSize) return;
    brushSize = next;
  }

  if (brushPreview && brushPreview.style.display !== "none" && potentialCanvas) {
    const rect = potentialCanvas.getBoundingClientRect();
    const scaleX = rect.width / potentialCanvas.width;
    const scaleY = rect.height / potentialCanvas.height;
    const radiusCss = brushSize * Math.min(scaleX, scaleY);
    brushPreview.style.width = `${2 * radiusCss}px`;
    brushPreview.style.height = `${2 * radiusCss}px`;
  }
}

function redrawPotential() {
  if (!potentialCanvas || !potentialCtx || !potentialField) return;

  const width = potentialWidth;
  const height = potentialHeight;

  const imageData = potentialCtx.createImageData(width, height);
  const data = imageData.data;

  // Use the same physical potential-to-color mapping as the colorbar.
  const range = typeof getPotentialRange === "function"
    ? getPotentialRange()
    : { minV: 0, maxV: typeof POTENTIAL_SCALE === "number" && POTENTIAL_SCALE > 0 ? POTENTIAL_SCALE : 1 };
  const minV = range.minV;
  const maxV = range.maxV;
  const denom = maxV - minV;
  const hasRange = Number.isFinite(denom) && denom !== 0;

  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const vNorm = potentialField[y * width + x];
      const vPhysical =
        Number.isFinite(vNorm) && typeof POTENTIAL_SCALE === "number"
          ? vNorm * POTENTIAL_SCALE
          : 0;

      let t;
      if (hasRange) {
        t = (vPhysical - minV) / denom;
      } else {
        t = 0.5;
      }
      const tClamped = Math.max(0, Math.min(1, t));
      const gray = Math.round(tClamped * 255);
      const alpha = 255; // draw potential as solid grayscale (no transparency)

      data[idx++] = gray;
      data[idx++] = gray;
      data[idx++] = gray;
      data[idx++] = alpha;
    }
  }

  potentialCtx.putImageData(imageData, 0, 0);
}

function hideBrushPreview() {
  if (brushPreview) {
    brushPreview.style.display = "none";
  }
}

function resizeCanvas() {
  // Internal simulation/drawing resolution (can be non-square) – set only once
  if (!canvasInitialized) {
    if (canvas) {
      canvas.width = currentResolutionWidth;
      canvas.height = currentResolutionHeight;
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    if (potentialCanvas) {
      potentialCanvas.width = currentResolutionWidth;
      potentialCanvas.height = currentResolutionHeight;
      if (potentialCtx) {
        potentialCtx.setTransform(1, 0, 0, 1, 0, 0);
      }
      initPotentialField(currentResolutionWidth, currentResolutionHeight);
      redrawPotential();
    }

    if (typeof overlayCanvas !== "undefined" && overlayCanvas && typeof OVERLAY_SUPERSAMPLE_FACTOR === "number") {
      const factor =
        OVERLAY_SUPERSAMPLE_FACTOR > 0 ? OVERLAY_SUPERSAMPLE_FACTOR : 1;
      overlayCanvas.width = Math.round(currentResolutionWidth * factor);
      overlayCanvas.height = Math.round(currentResolutionHeight * factor);
      if (typeof overlayCtx !== "undefined" && overlayCtx) {
        overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    if (canvas) {
      initSimulationGrid(currentResolutionWidth, currentResolutionHeight);
    }

    canvasInitialized = true;
  }

  // Scale the displayed size to fill as much of the container as possible
  const container =
    (canvas && canvas.parentElement) ||
    (potentialCanvas && potentialCanvas.parentElement);

  if (container) {
    const rect = container.getBoundingClientRect();
    const gridWidth = currentResolutionWidth;
    const gridHeight = currentResolutionHeight;

    // Match the CSS breakpoint: on narrow layouts,
    // always use the full container width for the canvas
    // and derive height from the simulation aspect ratio.
    const isNarrowLayout =
      typeof window !== "undefined" && window.innerWidth <= 800;

    let displayWidth;
    let displayHeight;

    if (isNarrowLayout) {
      const widthCss = rect.width || window.innerWidth || gridWidth;
      const scale = widthCss / gridWidth;
      displayWidth = widthCss;
      displayHeight = gridHeight * scale;
      // Ensure the canvas container grows to fit the full canvas height
      container.style.height = `${displayHeight}px`;
    } else {
      const scaleX = rect.width / gridWidth;
      const scaleY = rect.height / gridHeight;
      const scale = Math.min(scaleX, scaleY);
      displayWidth = gridWidth * scale;
      displayHeight = gridHeight * scale;
      // Let layout control height on wide screens
      container.style.height = "";
    }

    if (canvas) {
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }
    if (potentialCanvas) {
      potentialCanvas.style.width = `${displayWidth}px`;
      potentialCanvas.style.height = `${displayHeight}px`;
    }
    if (typeof overlayCanvas !== "undefined" && overlayCanvas) {
      overlayCanvas.style.width = `${displayWidth}px`;
      overlayCanvas.style.height = `${displayHeight}px`;
    }
  }

  drawScene();
  updateParticleOverlay();
}

function getScalePos(width) {
  return (BASE_SCALE_POS * width) / BASE_RESOLUTION;
}

function getParticleGeometry() {
  if (!canvas) return null;

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return null;

  const state = getControlsState();

  const scalePos = getScalePos(width);
  const centerX = width / 2 + state.x * scalePos;
  const centerY = height / 2 - state.y * scalePos;

  let sigma = state.sigmaX;
  if (!Number.isFinite(sigma) || sigma <= 0) {
    sigma = 0;
  }
  // Display radius is chosen to be twice the physical sigma extent
  const radius = Math.max(
    MIN_PARTICLE_RADIUS_PX,
    2 * Math.abs(sigma * scalePos)
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
    scalePos,
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
  const radius = geom.radius * scaleCssX;

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

  const scalePos = getScalePos(width);
  const centerXInternal = width / 2;
  const centerYInternal = height / 2;

  const state = getControlsState();

  if (particleDragMode === "center") {
    // Work in deltas from the drag start so free motion and
    // constrained motion are both well-behaved.
    const dxInternal = pxInternal - centerDragStartInternalX;
    const dyInternal = pyInternal - centerDragStartInternalY;

    let dxWorld = dxInternal / scalePos;
    let dyWorld = -dyInternal / scalePos;

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

    const xWorld = centerDragStartXWorld + dxWorld;
    const yWorld = centerDragStartYWorld + dyWorld;
    setSliderValue("x", xWorld);
    setSliderValue("y", yWorld);
    return;
  }

  const centerX = centerXInternal + state.x * scalePos;
  const centerY = centerYInternal - state.y * scalePos;

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
    // Circle is drawn at radius = 2 * sigma * scalePos,
    // so invert that factor here when dragging.
    let sigma = dist / (2 * scalePos);
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
        const scalePos = width ? getScalePos(width) : 1;
        centerDragStartInternalX = width / 2 + centerDragStartXWorld * scalePos;
        centerDragStartInternalY = height / 2 - centerDragStartYWorld * scalePos;
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

function getCanvasCoords(event) {
  if (!potentialCanvas) return null;
  const rect = potentialCanvas.getBoundingClientRect();
  const scaleX = potentialCanvas.width / rect.width;
  const scaleY = potentialCanvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
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

  const threshold = BUCKET_TOLERANCE;

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

  const vMax = Number.isFinite(currentVMax) && currentVMax > 0 ? currentVMax : INITIAL_V_MAX;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const base = idx * 4;
      const r = data[base];
      const g = data[base + 1];
      const b = data[base + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const normalized = gray / 255;
      const value = Math.max(0, Math.min(1, normalized * vMax));
      potentialField[idx] = value;
    }
  }

  if (typeof savePotentialHistory === "function") {
    savePotentialHistory();
  }
  redrawPotential();
  if (typeof drawScene === "function") {
    drawScene();
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
      bucketFill(coords.x, coords.y);
      redrawPotential();
      savePotentialHistory();
       if (typeof drawScene === "function") {
        drawScene();
      }
      console.log(
        "[Schrödinger] Bucket fill at",
        coords.x,
        coords.y,
        "gray =",
        potentialGray
      );
      return;
    }

    if (currentTool === "eyedropper") {
      isEyedropperSampling = true;
      sampleEyedropperAt(coords.x, coords.y, event);
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

      const startX = coords.x;
      const startY = coords.y;
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
      moveDragStartX = coords.x;
      moveDragStartY = coords.y;

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

      shapeStartX = coords.x;
      shapeStartY = coords.y;
      shapeCurrentX = coords.x;
      shapeCurrentY = coords.y;
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
        sampleEyedropperAt(coords.x, coords.y, event);
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

    let x = coords.x;
    let y = coords.y;

    if (currentTool === "brush" || currentTool === "eraser") {
      // Allow enabling constraint any time Shift is held during the stroke.
      // Once a constraint direction is chosen, it stays fixed until stroke end.
      if (event.shiftKey) {
        strokeConstrainActive = true;
      }

      if (strokeConstrainActive) {
        if (!strokeConstrainMode) {
          const dx0 = x - strokeStartX;
          const dy0 = y - strokeStartY;
          if (dx0 !== 0 || dy0 !== 0) {
            strokeConstrainMode =
              Math.abs(dx0) >= Math.abs(dy0) ? "horizontal" : "vertical";
          }
        }

        if (strokeConstrainMode === "horizontal") {
          y = strokeStartY;
        } else if (strokeConstrainMode === "vertical") {
          x = strokeStartX;
        }
      }

      const erase = currentTool === "eraser";
      const point = { x, y };

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

      const dx = Math.round(x - moveDragStartX);
      const dy = Math.round(y - moveDragStartY);

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

      shapeCurrentX = x;
      shapeCurrentY = y;

      potentialField.set(shapeBaseField);
      drawShapeStroke(shapeStartX, shapeStartY, x, y);
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
      applyBrushSizeDelta(-1);
      return;
    }
    if (key === "]" && (currentTool === "brush" || currentTool === "eraser")) {
      event.preventDefault();
      applyBrushSizeDelta(1);
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

    wavefunction = {
      width: simWidth,
      height: simHeight,
      re,
      im,
      normFactor,
      simTime: savedSimTime,
      frameCount: savedFrameCount,
    };
  }

  const payload = {
    version: wavefunction ? 2 : 1,
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
    potential: {
      width: potentialWidth,
      height: potentialHeight,
      data: Array.from(potentialField),
    },
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
    },
  };

  if (wavefunction) {
    payload.wavefunction = wavefunction;
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
}

function applySetupObject(setup) {
  if (!setup || typeof setup !== "object") return;

  let appliedWavefunction = false;

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
        potentialField[i] = Number.isFinite(v)
          ? Math.max(0, Math.min(1, v))
          : 0;
      }
      redrawPotential();
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

      if (typeof initialPsiDirty !== "undefined") {
        initialPsiDirty = false;
      }

      if (typeof wavefunctionCanBeReconstructedFromControls !== "undefined") {
        wavefunctionCanBeReconstructedFromControls = false;
      }

      appliedWavefunction = true;

      if (typeof creationToolsVisible !== "undefined") {
        creationToolsVisible = false;
      }
    }
  }

  if (typeof savePotentialHistory === "function") {
    savePotentialHistory();
  }

  drawScene();
  updateParticleOverlay();
  console.log(
    "[Schrödinger] Setup imported from JSON file",
    appliedWavefunction ? "(including explicit wavefunction)" : ""
  );
}
