// Canvas sizing, potential rendering, and brush sizing helpers.
function applyBrushSizeDelta(delta) {
  const slider = document.getElementById("brush-size");

  if (slider) {
    const min =
      slider.min !== undefined && slider.min !== ""
        ? parseFloat(slider.min) || 1
        : 1;
    const max =
      slider.max !== undefined && slider.max !== ""
        ? parseFloat(slider.max) || 150
        : 150;

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
    next = Math.max(1, Math.min(150, next));
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

    if (typeof overlayCanvas !== "undefined" && overlayCanvas) {
      const baseWidth =
        typeof OVERLAY_CANVAS_BASE_WIDTH === "number" &&
        OVERLAY_CANVAS_BASE_WIDTH > 0
          ? OVERLAY_CANVAS_BASE_WIDTH
          : Math.max(1, Math.round(currentResolutionWidth));
      const aspect =
        currentResolutionWidth > 0 && currentResolutionHeight > 0
          ? currentResolutionHeight / currentResolutionWidth
          : 1;
      overlayCanvas.width = Math.round(baseWidth);
      overlayCanvas.height = Math.max(1, Math.round(baseWidth * aspect));
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

// Axis-aware helpers to allow non-square canvases to map world units correctly.
function getScalePosForDimension(size) {
  return getScalePos(size);
}

function getScalePosY(height) {
  return getScalePos(height);
}
