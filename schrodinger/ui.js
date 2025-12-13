// General UI: sliders, controls, and app bootstrap

let isRecording = false;

// Offscreen canvas and MediaRecorder state used when recording is enabled.
let combinedCanvas = null;
let combinedCtx = null;
let recordingMediaRecorder = null;
let recordingChunks = [];
let recordingMimeType = "";
let recordingStream = null;

const RECORDING_FPS = 30;

// Shared hover tooltip state
const HOVER_TOOLTIP_DELAY_MS = 1000;
let hoverTooltipEl = null;
let hoverTooltipTimer = null;
let hoverTooltipTarget = null;

function getOrCreateHoverTooltipElement() {
  if (hoverTooltipEl) return hoverTooltipEl;
  const el = document.createElement("div");
  el.className = "help-tooltip";
  document.body.appendChild(el);
  hoverTooltipEl = el;
  return el;
}

function positionHoverTooltip(target) {
  if (!hoverTooltipEl || !target) return;
  const rect = target.getBoundingClientRect();
  const margin = 8;
  const viewportWidth =
    window.innerWidth ||
    document.documentElement.clientWidth ||
    document.body.clientWidth ||
    0;
  const viewportHeight =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    document.body.clientHeight ||
    0;

  const inPotentialEditor = !!target.closest(".potential-editor");

  if (inPotentialEditor) {
    let left = rect.right + margin;
    let top = rect.top + rect.height / 2;

    left = Math.min(left, viewportWidth - margin);
    top = Math.max(margin, Math.min(viewportHeight - margin, top));

    hoverTooltipEl.style.left = `${left}px`;
    hoverTooltipEl.style.top = `${top}px`;
    hoverTooltipEl.style.transform = "translateY(-50%)";
  } else {
    let left = rect.left + rect.width / 2;
    left = Math.max(margin, Math.min(viewportWidth - margin, left));
    let top = rect.bottom + margin;
    top = Math.max(margin, Math.min(viewportHeight - margin, top));

    hoverTooltipEl.style.left = `${left}px`;
    hoverTooltipEl.style.top = `${top}px`;
    hoverTooltipEl.style.transform = "translate(-50%, 0)";
  }
}

function showHoverTooltipNow(target) {
  const text =
    target && typeof target.getAttribute === "function"
      ? target.getAttribute("data-tooltip")
      : "";
  if (!text) return;
  const el = getOrCreateHoverTooltipElement();
  hoverTooltipTarget = target;
  el.textContent = text;
  positionHoverTooltip(target);
  el.classList.add("is-visible");
}

function scheduleHoverTooltip(target) {
  if (!target || !target.getAttribute("data-tooltip")) return;
  if (hoverTooltipTimer) {
    clearTimeout(hoverTooltipTimer);
    hoverTooltipTimer = null;
  }
  hoverTooltipTimer = window.setTimeout(() => {
    showHoverTooltipNow(target);
  }, HOVER_TOOLTIP_DELAY_MS);
}

function hideHoverTooltip(target) {
  if (hoverTooltipTimer) {
    clearTimeout(hoverTooltipTimer);
    hoverTooltipTimer = null;
  }
  if (!hoverTooltipEl) return;
  if (target && hoverTooltipTarget && target !== hoverTooltipTarget) {
    return;
  }
  hoverTooltipTarget = null;
  hoverTooltipEl.classList.remove("is-visible");
}

function setupHoverTooltips() {
  const tooltipTargets = Array.from(
    document.querySelectorAll("[data-tooltip]")
  );

  tooltipTargets.forEach((el) => {
    const handleEnter = () => {
      scheduleHoverTooltip(el);
    };
    const handleLeave = () => {
      hideHoverTooltip(el);
    };
    const handleFocus = () => {
      scheduleHoverTooltip(el);
    };

    el.addEventListener("mouseenter", handleEnter);
    el.addEventListener("mouseleave", handleLeave);
    el.addEventListener("focus", handleFocus);
    el.addEventListener("blur", handleLeave);
  });
}

function ensureCombinedCanvas() {
  if (!canvas || !potentialCanvas) return false;

  const baseWidth =
    (typeof overlayCanvas !== "undefined" &&
      overlayCanvas &&
      overlayCanvas.width) ||
    canvas.width;
  const baseHeight =
    (typeof overlayCanvas !== "undefined" &&
      overlayCanvas &&
      overlayCanvas.height) ||
    canvas.height;
  if (!baseWidth || !baseHeight) return false;

  if (!combinedCanvas) {
    combinedCanvas = document.createElement("canvas");
    combinedCtx = combinedCanvas.getContext("2d");
  }

  if (
    combinedCanvas.width !== baseWidth ||
    combinedCanvas.height !== baseHeight
  ) {
    combinedCanvas.width = baseWidth;
    combinedCanvas.height = baseHeight;
  }

  return !!combinedCtx;
}

function updateCombinedCanvas() {
  if (!ensureCombinedCanvas()) return;
  const width = combinedCanvas.width;
  const height = combinedCanvas.height;

  combinedCtx.clearRect(0, 0, width, height);
  // Draw potential first, then the quantum canvas on top.
  combinedCtx.drawImage(potentialCanvas, 0, 0, width, height);
  combinedCtx.drawImage(canvas, 0, 0, width, height);
  // High-resolution overlay (colorbar, energy) next.
  if (typeof overlayCanvas !== "undefined" && overlayCanvas) {
    combinedCtx.drawImage(overlayCanvas, 0, 0, width, height);
  }

  // Signature only in exported video, not on the live page.
  const watermarkText = "mikaberidze.github.io/schrodinger";
  const overlayScale =
    overlayCanvas && potentialCanvas && potentialCanvas.width
      ? Math.max(1, overlayCanvas.width / potentialCanvas.width)
      : 1;
  const margin = 10 * overlayScale;

  combinedCtx.save();
  combinedCtx.font = `${12 * overlayScale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  combinedCtx.textAlign = "right";
  combinedCtx.textBaseline = "bottom";
  const x = width - margin;
  const y = height - margin;

  // Thin black outline plus accent fill for the website watermark in downloads,
  // matching the overlay text styling (scaled with overlay supersampling).
  const strokeWidth = 2 * overlayScale;
  combinedCtx.lineWidth = strokeWidth;
  combinedCtx.strokeStyle = "rgba(0, 0, 0, 1)";
  combinedCtx.lineJoin = "round";
  combinedCtx.miterLimit = 2;
  combinedCtx.strokeText(watermarkText, x, y);

  combinedCtx.fillStyle =
    typeof OVERLAY_ACCENT_COLOR === "string"
      ? OVERLAY_ACCENT_COLOR
      : "#00ffff";
  combinedCtx.fillText(watermarkText, x, y);
  combinedCtx.restore();
}

function startCanvasRecorderIfNeeded() {
  if (!isRecording) return;
  if (recordingMediaRecorder || !ensureCombinedCanvas()) return;
  if (typeof MediaRecorder === "undefined") {
    console.warn("[Schrödinger] MediaRecorder not available, recording disabled");
    return;
  }

  const stream = combinedCanvas.captureStream(RECORDING_FPS);
  if (!stream) {
    console.warn("[Schrödinger] Unable to capture canvas stream for recording");
    return;
  }

  let options = {};
  let mimeType = "";

  if (typeof MediaRecorder.isTypeSupported === "function") {
    const candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        options.mimeType = type;
        break;
      }
    }
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, options);
  } catch (err) {
    console.error("[Schrödinger] Failed to start MediaRecorder:", err);
    return;
  }

  recordingChunks = [];
  recordingMimeType = mimeType || recorder.mimeType || "";
  recordingMediaRecorder = recorder;
  recordingStream = stream;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    if (!recordingChunks.length) {
      if (recordingStream && typeof recordingStream.getTracks === "function") {
        recordingStream.getTracks().forEach((track) => track.stop());
      }
      recordingMediaRecorder = null;
      recordingStream = null;
      recordingMimeType = "";
      return;
    }

    const type = recordingMimeType || "video/webm";
    const blob = new Blob(recordingChunks, { type });
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `schrodinger-simulation.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);

    if (recordingStream && typeof recordingStream.getTracks === "function") {
      recordingStream.getTracks().forEach((track) => track.stop());
    }

    recordingMediaRecorder = null;
    recordingStream = null;
    recordingChunks = [];
    recordingMimeType = "";
  });

  recorder.start();
  console.log(
    "[Schrödinger] Recording started with mimeType =",
    recordingMimeType || recorder.mimeType || "(default)"
  );
}

function pauseCanvasRecorder() {
  if (
    recordingMediaRecorder &&
    recordingMediaRecorder.state === "recording"
  ) {
    recordingMediaRecorder.pause();
    console.log("[Schrödinger] Recording paused");
  }
}

function resumeCanvasRecorder() {
  if (
    recordingMediaRecorder &&
    recordingMediaRecorder.state === "paused"
  ) {
    recordingMediaRecorder.resume();
    console.log("[Schrödinger] Recording resumed");
  }
}

function stopCanvasRecorderAndPromptDownload() {
  if (!recordingMediaRecorder) return;
  if (recordingMediaRecorder.state === "inactive") return;
  recordingMediaRecorder.stop();
}

function recordFrameIfNeeded() {
  if (!isRecording) return;
  if (!canvas || !potentialCanvas) return;

  updateCombinedCanvas();
  if (!recordingMediaRecorder || recordingMediaRecorder.state === "inactive") {
    startCanvasRecorderIfNeeded();
  }
}

function updateRecordBlink() {
  const recordButton = document.getElementById("record-toggle");
  if (!recordButton) return;
  const dot = recordButton.querySelector(".record-dot");
  if (!dot) return;
  const shouldBlink = isRecording && isPlaying;
  dot.classList.toggle("record-dot-blinking", shouldBlink);
}

// Utility functions for sigma sliders
function positionToValue(z) {
  // Sigma from slider position: sigma = z / (1 - z), z in [0, 1)
  if (z <= 0) return 0;
  if (z >= 1) return Infinity;
  return z / (1 - z);
}

function valueToPosition(v) {
  // Inverse: z = sigma / (1 + sigma), sigma in [0, ∞)
  if (!Number.isFinite(v)) return 1;
  if (v <= 0) return 0;
  return v / (1 + v);
}

function formatSigmaValue(v) {
  if (!Number.isFinite(v)) return "∞";
  if (Math.abs(v) < 1e-12) return "0";
  return v.toFixed(4);
}

function formatBasicSliderValue(v) {
  return v.toFixed(2);
}

function getMomentumDisplayScale() {
  if (
    typeof currentResolutionWidth === "number" &&
    currentResolutionWidth > 0 &&
    typeof getScalePos === "function"
  ) {
    const scalePos = getScalePos(currentResolutionWidth);
    if (Number.isFinite(scalePos) && scalePos > 0) {
      // Internal plane-wave parameter μ relates to lattice momentum k via:
      // k = μ / scalePos. We want the displayed momentum p to be k, so
      // μ = p * scalePos and internalMomentumToDisplay(μ) = μ / scalePos.
      return scalePos;
    }
  }
  return 1;
}

function internalMomentumToDisplay(mu) {
  const scalePos = getMomentumDisplayScale();
  if (!Number.isFinite(mu)) return 0;
  if (!Number.isFinite(scalePos) || scalePos === 0) return mu;

  // Lattice wavenumber k = μ / scalePos.
  const k = mu / scalePos;
  // Define displayed momentum p so that for a plane wave
  // with wavenumbers (k_x, k_y), the discrete dispersion
  // E = 2 - cos k_x - cos k_y = 2 sin^2(k_x/2) + 2 sin^2(k_y/2)
  // becomes E = p_x^2/2 + p_y^2/2, with
  // p = 2 * sin(k / 2).
  return 2 * Math.sin(k / 2);
}

function displayMomentumToInternal(p) {
  const scalePos = getMomentumDisplayScale();
  if (!Number.isFinite(p)) return 0;
  if (!Number.isFinite(scalePos) || scalePos === 0) return p;

  // Inverse of internalMomentumToDisplay:
  // p = 2 * sin(k / 2)  ⇒
  // k = 2 * asin(p / 2).
  // Clamp to the domain of asin to avoid NaNs.
  const maxP =
    typeof MAX_P === "number" && Number.isFinite(MAX_P) && MAX_P > 0
      ? MAX_P
      : 2;
  const clamped = Math.max(-maxP, Math.min(maxP, p));
  const k = 2 * Math.asin(clamped / 2);
  return k * scalePos;
}

// Enforce the maximum momentum constraint on the
// full vector length: |p| <= MAX_P.
function clampMomentumDisplayVector(pxDisplay, pyDisplay) {
  let px = Number.isFinite(pxDisplay) ? pxDisplay : 0;
  let py = Number.isFinite(pyDisplay) ? pyDisplay : 0;
  const r = Math.hypot(px, py);

  const maxP =
    typeof MAX_P === "number" && Number.isFinite(MAX_P) && MAX_P > 0
      ? MAX_P
      : 2;

  if (Number.isFinite(r) && r > maxP && maxP > 0) {
    const s = maxP / r;
    px *= s;
    py *= s;
  }

  return { px, py };
}

// Helper used from both UI sliders and the particle overlay
// to update the momentum sliders from display-space values
// while respecting the vector-length constraint.
function setMomentumFromDisplay(pxDisplay, pyDisplay) {
  if (typeof displayMomentumToInternal !== "function") {
    return;
  }

  const { px, py } = clampMomentumDisplayVector(pxDisplay, pyDisplay);
  const pxInternal = displayMomentumToInternal(px);
  const pyInternal = displayMomentumToInternal(py);

  if (typeof setSliderValue === "function") {
    setSliderValue("px", pxInternal);
    setSliderValue("py", pyInternal);
  } else {
    const sliderPx = document.getElementById("px");
    const sliderPy = document.getElementById("py");
    if (sliderPx) sliderPx.value = String(pxInternal);
    if (sliderPy) sliderPy.value = String(pyInternal);
  }
}

function setupBasicSliders() {
  const ids = ["x", "y", "px", "py"];

  ids.forEach((id) => {
    const slider = document.getElementById(id);
    if (!slider) return;

    // Match x,y slider ranges to canvas/world boundaries (in world units)
    if (id === "x") {
      const halfRangeX = BASE_RESOLUTION / (2 * BASE_SCALE_POS);
      slider.min = String(-halfRangeX);
      slider.max = String(halfRangeX);
    } else if (id === "y") {
      const aspect = TARGET_RESOLUTION_HEIGHT / TARGET_RESOLUTION_WIDTH;
      const halfRangeY =
        (BASE_RESOLUTION * aspect) / (2 * BASE_SCALE_POS);
      slider.min = String(-halfRangeY);
      slider.max = String(halfRangeY);
    } else if (id === "px" || id === "py") {
      // Choose internal μ range so that the displayed momentum
      // can reach |p| = MAX_P at the slider endpoints.
      const scalePos = getMomentumDisplayScale();
      const maxP =
        typeof MAX_P === "number" && Number.isFinite(MAX_P) && MAX_P > 0
          ? MAX_P
          : 2;
      const ratio = Math.max(-1, Math.min(1, maxP / 2));
      const kMax = 2 * Math.asin(ratio); // corresponding lattice wavenumber

      if (Number.isFinite(scalePos) && scalePos > 0 && Number.isFinite(kMax) && kMax > 0) {
        const muMax = kMax * scalePos;
        slider.min = String(-muMax);
        slider.max = String(muMax);
      }
    }

    const update = () => {
      const raw = parseFloat(slider.value) || 0;
      let v =
        id === "px" || id === "py"
          ? internalMomentumToDisplay(raw)
          : raw;

      if (id === "px" || id === "py") {
        const state = getControlsState();
        const currentPxDisplay = state.px;
        const currentPyDisplay = state.py;
        let nextPxDisplay = id === "px" ? v : currentPxDisplay;
        let nextPyDisplay = id === "py" ? v : currentPyDisplay;

        const clamped = clampMomentumDisplayVector(
          nextPxDisplay,
          nextPyDisplay
        );
        nextPxDisplay = clamped.px;
        nextPyDisplay = clamped.py;

        const pxInternal = displayMomentumToInternal(nextPxDisplay);
        const pyInternal = displayMomentumToInternal(nextPyDisplay);

        const sliderPx = document.getElementById("px");
        const sliderPy = document.getElementById("py");
        if (sliderPx) sliderPx.value = String(pxInternal);
        if (sliderPy) sliderPy.value = String(pyInternal);

        v = id === "px" ? nextPxDisplay : nextPyDisplay;
      }

      const edit = document.getElementById(`${id}-edit`);
      if (edit && document.activeElement !== edit) {
        edit.value = formatBasicSliderValue(v);
      }
      markInitialPsiDirty();
      drawScene();
      updateParticleOverlay();
      console.log(
        `[Schrödinger] Slider ${id} = ${v.toFixed(2)}, reset initial state`
      );
    };

    slider.addEventListener("input", update);
    slider.addEventListener("change", () => {
      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
    });
    update();

    const edit = document.getElementById(`${id}-edit`);
    if (edit) {
      const raw = parseFloat(slider.value) || 0;
      const initialDisplay =
        id === "px" || id === "py"
          ? internalMomentumToDisplay(raw)
          : raw;
      edit.value = formatBasicSliderValue(initialDisplay);
      const commit = () => {
        const v = parseFloat(edit.value);
        if (Number.isFinite(v)) {
          if (id === "px" || id === "py") {
            // For momentum, treat edit value as display momentum
            // and enforce vector-length constraint jointly.
            const state = getControlsState();
            const currentPxDisplay = state.px;
            const currentPyDisplay = state.py;
            const nextPxDisplay = id === "px" ? v : currentPxDisplay;
            const nextPyDisplay = id === "py" ? v : currentPyDisplay;

            if (typeof setMomentumFromDisplay === "function") {
              setMomentumFromDisplay(nextPxDisplay, nextPyDisplay);
            }
          } else {
            setSliderValue(id, v);
          }
          if (typeof savePotentialHistory === "function") {
            savePotentialHistory();
          }
        } else {
          const currentRaw = parseFloat(slider.value) || 0;
          const currentDisplay =
            id === "px" || id === "py"
              ? internalMomentumToDisplay(currentRaw)
              : currentRaw;
          edit.value = formatBasicSliderValue(currentDisplay);
        }
      };
      edit.addEventListener("change", commit);
      edit.addEventListener("blur", commit);
      edit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commit();
          edit.blur();
        }
      });
    }
  });
}

function setupSigmaSliders() {
  const sliderX = document.getElementById("sigma-x-slider");
  const sliderP = document.getElementById("sigma-p-slider");
  const editX = document.getElementById("sigma-x-edit");
  const editP = document.getElementById("sigma-p-edit");

  // Helper to get normalized slider position in [0,1]
  const getPosition = (slider) => parseFloat(slider.value);

  const setPositionSafely = (slider, pos) => {
    if (!Number.isFinite(pos)) {
      // If position is infinite or invalid, clamp to slider max
      pos = parseFloat(slider.max);
    }
    pos = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), pos));
    slider.value = pos;
  };

  const updateFromSlider = (changed) => {
    const other = changed === sliderX ? sliderP : sliderX;

    // Current position of changed slider
    const zChanged = getPosition(changed);
    const sigmaChanged = positionToValue(zChanged);

    let sigmaOther;
    if (sigmaChanged === 0) {
      sigmaOther = Infinity;
    } else {
      sigmaOther = PRODUCT_TARGET / sigmaChanged;
    }

    const zOther = valueToPosition(sigmaOther);

    // Update other slider position
    setPositionSafely(other, zOther);

    // Recompute actual values after clamping
    const zX = getPosition(sliderX);
    const zP = getPosition(sliderP);
    const sigmaX = positionToValue(zX);
    const sigmaP = positionToValue(zP);

    if (editX && document.activeElement !== editX) {
      editX.value = Number.isFinite(sigmaX) ? sigmaX.toFixed(4) : "";
    }
    if (editP && document.activeElement !== editP) {
      editP.value = Number.isFinite(sigmaP) ? sigmaP.toFixed(4) : "";
    }

    markInitialPsiDirty();
    drawScene();
    updateParticleOverlay();
    console.log(
      `[Schrödinger] Sigma sliders: sigma_x = ${formatSigmaValue(
        sigmaX
      )}, sigma_p = ${formatSigmaValue(sigmaP)}`
    );
  };

  sliderX.addEventListener("input", () => updateFromSlider(sliderX));
  sliderP.addEventListener("input", () => updateFromSlider(sliderP));

  const commitSigmaHistory = () => {
    if (typeof savePotentialHistory === "function") {
      savePotentialHistory();
    }
  };

  sliderX.addEventListener("change", commitSigmaHistory);
  sliderP.addEventListener("change", commitSigmaHistory);

  if (editX) {
    const commitX = () => {
      const v = parseFloat(editX.value);
      if (Number.isFinite(v) && v > 0) {
        const pos = valueToPosition(v);
        sliderX.value = String(pos);
        updateFromSlider(sliderX);
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
      } else {
        // Reset display from current slider
        const zX = parseFloat(sliderX.value);
        const sigmaX = positionToValue(zX);
        editX.value = Number.isFinite(sigmaX) ? sigmaX.toFixed(4) : "";
      }
    };
    editX.addEventListener("change", commitX);
    editX.addEventListener("blur", commitX);
    editX.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commitX();
        editX.blur();
      }
    });
  }

  if (editP) {
    const commitP = () => {
      const v = parseFloat(editP.value);
      if (Number.isFinite(v) && v > 0) {
        const pos = valueToPosition(v);
        sliderP.value = String(pos);
        updateFromSlider(sliderP);
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
      } else {
        const zP = parseFloat(sliderP.value);
        const sigmaP = positionToValue(zP);
        editP.value = Number.isFinite(sigmaP) ? sigmaP.toFixed(4) : "";
      }
    };
    editP.addEventListener("change", commitP);
    editP.addEventListener("blur", commitP);
    editP.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commitP();
        editP.blur();
      }
    });
  }

  // Initialize with a consistent state
  updateFromSlider(sliderX);
}

function getControlsState() {
  const x = parseFloat(document.getElementById("x").value) || 0;
  const y = parseFloat(document.getElementById("y").value) || 0;
  const rawPx = parseFloat(document.getElementById("px").value) || 0;
  const rawPy = parseFloat(document.getElementById("py").value) || 0;
  const px =
    typeof internalMomentumToDisplay === "function"
      ? internalMomentumToDisplay(rawPx)
      : rawPx;
  const py =
    typeof internalMomentumToDisplay === "function"
      ? internalMomentumToDisplay(rawPy)
      : rawPy;

  const zX = parseFloat(document.getElementById("sigma-x-slider").value);
  const zP = parseFloat(document.getElementById("sigma-p-slider").value);
  const sigmaX = positionToValue(zX);
  const sigmaP = positionToValue(zP);

  return { x, y, px, py, sigmaX, sigmaP };
}

const enhancedDropdowns = new WeakMap();

function enhanceDropdown(selectEl, { align = "center", staticLabel = "" } = {}) {
  if (!selectEl || enhancedDropdowns.has(selectEl) || !selectEl.parentElement) {
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "select-enhancer";
  wrapper.dataset.align = align;

  const originalStyles = window.getComputedStyle(selectEl);
  wrapper.style.flex = originalStyles.flex || "1 1 auto";
  if (originalStyles.maxWidth && originalStyles.maxWidth !== "none") {
    wrapper.style.maxWidth = originalStyles.maxWidth;
  }
  if (originalStyles.minWidth && originalStyles.minWidth !== "auto") {
    wrapper.style.minWidth = originalStyles.minWidth;
  }

  selectEl.parentElement.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  const mirrorClasses = Array.from(selectEl.classList);
  selectEl.classList.add("select-native-hidden");
  selectEl.setAttribute("tabindex", "-1");
  selectEl.setAttribute("aria-hidden", "true");

  const display = document.createElement("button");
  display.type = "button";
  display.className = "select-display";
  mirrorClasses.forEach((cls) => display.classList.add(cls));
  display.setAttribute("aria-haspopup", "listbox");
  display.setAttribute("aria-expanded", "false");
  display.setAttribute("role", "combobox");

  const displayLabel = document.createElement("span");
  displayLabel.className = "select-display-label";
  display.appendChild(displayLabel);

  wrapper.appendChild(display);

  const optionsPanel = document.createElement("div");
  optionsPanel.className = "select-options";
  optionsPanel.setAttribute("role", "listbox");
  const optionsId = `${selectEl.id || "dropdown"}-options`;
  optionsPanel.id = optionsId;
  display.setAttribute("aria-controls", optionsId);
  wrapper.appendChild(optionsPanel);

  let isOpen = false;

  const updateDisplay = () => {
    const selected =
      (selectEl.selectedOptions && selectEl.selectedOptions[0]) ||
      selectEl.options[selectEl.selectedIndex] ||
      selectEl.options[0];
    displayLabel.textContent =
      staticLabel || (selected ? selected.textContent : "");

    optionsPanel
      .querySelectorAll(".select-option")
      .forEach((btn) => {
        const isActive = btn.dataset.value === selectEl.value;
        btn.classList.toggle("is-selected", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      });

    display.disabled = selectEl.disabled;
    wrapper.classList.toggle("is-disabled", !!selectEl.disabled);
  };

  const closeOptions = () => {
    if (!isOpen) return;
    isOpen = false;
    wrapper.classList.remove("is-open");
    display.setAttribute("aria-expanded", "false");
  };

  const openOptions = () => {
    if (isOpen || selectEl.disabled) return;
    isOpen = true;
    wrapper.classList.add("is-open");
    display.setAttribute("aria-expanded", "true");
  };

  if (selectEl.id) {
    const boundLabel = document.querySelector(`label[for="${selectEl.id}"]`);
    if (boundLabel) {
      boundLabel.addEventListener("click", (event) => {
        event.preventDefault();
        display.focus({ preventScroll: true });
        openOptions();
      });
    }
  }

  const setValue = (value, fireChange = true) => {
    if (selectEl.value === value) {
      updateDisplay();
      return;
    }
    selectEl.value = value;
    updateDisplay();
    if (fireChange) {
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const getEnabledOptions = () =>
    Array.from(optionsPanel.querySelectorAll(".select-option:not(:disabled)"));

  const focusOptionByIndex = (index) => {
    const options = getEnabledOptions();
    if (!options.length) return;
    const normalized = ((index % options.length) + options.length) % options.length;
    options[normalized].focus({ preventScroll: true });
  };

  const renderOptions = () => {
    optionsPanel.innerHTML = "";
    Array.from(selectEl.options)
      .filter((option) => !(staticLabel && option.value === ""))
      .forEach((option) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "select-option";
        btn.textContent = option.textContent;
        btn.dataset.value = option.value;
        btn.disabled = option.disabled;
        btn.setAttribute("role", "option");

        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          setValue(option.value, true);
          closeOptions();
          display.focus({ preventScroll: true });
        });

        btn.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            focusOptionByIndex(getEnabledOptions().indexOf(btn) + 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            focusOptionByIndex(getEnabledOptions().indexOf(btn) - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            btn.click();
          } else if (event.key === "Escape") {
            closeOptions();
            display.focus({ preventScroll: true });
          }
        });

        optionsPanel.appendChild(btn);
      });
    updateDisplay();
  };

  const observer = new MutationObserver(() => {
    renderOptions();
  });
  observer.observe(selectEl, { childList: true });

  display.addEventListener("click", (event) => {
    event.preventDefault();
    if (isOpen) {
      closeOptions();
      return;
    }
    openOptions();
    const selectedButton = optionsPanel.querySelector(".select-option.is-selected");
    (selectedButton || getEnabledOptions()[0])?.focus({ preventScroll: true });
  });

  display.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === " " || event.key === "Enter") {
      event.preventDefault();
      openOptions();
      const selectedButton = optionsPanel.querySelector(".select-option.is-selected");
      (selectedButton || getEnabledOptions()[0])?.focus({ preventScroll: true });
    } else if (event.key === "Escape") {
      closeOptions();
    }
  });

  display.addEventListener("blur", (event) => {
    if (!wrapper.contains(event.relatedTarget)) {
      closeOptions();
    }
  });

  optionsPanel.addEventListener("focusout", (event) => {
    if (!wrapper.contains(event.relatedTarget)) {
      closeOptions();
    }
  });

  const onOutsidePointer = (event) => {
    if (!wrapper.contains(event.target)) {
      closeOptions();
    }
  };

  document.addEventListener("mousedown", onOutsidePointer);
  document.addEventListener("touchstart", onOutsidePointer);
  selectEl.addEventListener("change", updateDisplay);

  enhancedDropdowns.set(selectEl, {
    renderOptions,
    updateDisplay,
    destroy() {
      observer.disconnect();
      document.removeEventListener("mousedown", onOutsidePointer);
      document.removeEventListener("touchstart", onOutsidePointer);
    },
  });

  renderOptions();
}

function initApp() {
  if (typeof OVERLAY_ACCENT_COLOR === "string" && OVERLAY_ACCENT_COLOR) {
    document.documentElement.style.setProperty(
      "--overlay-accent",
      OVERLAY_ACCENT_COLOR
    );
  }

  canvas = document.getElementById("quantum-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  potentialCanvas = document.getElementById("potential-canvas");
  if (potentialCanvas) {
    potentialCtx = potentialCanvas.getContext("2d");
  }

  overlayCanvas = document.getElementById("overlay-canvas");
  if (overlayCanvas) {
    overlayCtx = overlayCanvas.getContext("2d");
  }

  const recordButton = document.getElementById("record-toggle");
  if (recordButton) {
    recordButton.addEventListener("click", () => {
      isRecording = !isRecording;
      recordButton.classList.toggle("recording", isRecording);
      recordButton.setAttribute("aria-pressed", isRecording ? "true" : "false");

      // When recording is turned off explicitly, pause the recorder but do not
      // finalize the video until the stop button is pressed.
      if (!isRecording) {
        pauseCanvasRecorder();
      } else if (isPlaying) {
        startCanvasRecorderIfNeeded();
        resumeCanvasRecorder();
      }

      updateRecordBlink();
    });
  }

  const undoButton = document.getElementById("undo-button");
  if (undoButton && typeof undoPotentialEdit === "function") {
    undoButton.addEventListener("click", () => {
      undoPotentialEdit();
    });
  }

  const redoButton = document.getElementById("redo-button");
  if (redoButton && typeof redoPotentialEdit === "function") {
    redoButton.addEventListener("click", () => {
      redoPotentialEdit();
    });
  }

  const latticeWidthInput = document.getElementById("lattice-width");
  const latticeHeightInput = document.getElementById("lattice-height");
  const timeStepInput = document.getElementById("time-step-edit");
  const saveSetupButton = document.getElementById("save-setup");
  const loadSetupButton = document.getElementById("load-setup");
  const wavefunctionTabs = document.querySelectorAll(".wf-tab");
  const wavefunctionPanels = document.querySelectorAll(".wf-tab-panel");
  const applyGridFromInputs = () => {
    if (
      typeof currentResolutionWidth === "undefined" ||
      typeof currentResolutionHeight === "undefined"
    ) {
      return;
    }

    let w = parseInt(latticeWidthInput.value, 10);
    let h = parseInt(latticeHeightInput.value, 10);

    if (!Number.isFinite(w)) w = currentResolutionWidth;
    if (!Number.isFinite(h)) h = currentResolutionHeight;

    w = Math.max(50, Math.min(2000, w));
    h = Math.max(50, Math.min(2000, h));

    if (w === currentResolutionWidth && h === currentResolutionHeight) return;

    currentResolutionWidth = w;
    currentResolutionHeight = h;

    latticeWidthInput.value = String(w);
    latticeHeightInput.value = String(h);

    // Reinitialize canvases and simulation grid at the new resolution.
    if (typeof canvasInitialized !== "undefined") {
      canvasInitialized = false;
    }
    if (typeof resizeCanvas === "function") {
      resizeCanvas();
    }

    if (typeof savePotentialHistory === "function") {
      savePotentialHistory();
    }
  };

  if (latticeWidthInput && latticeHeightInput) {
    latticeWidthInput.value =
      typeof currentResolutionWidth !== "undefined"
        ? String(currentResolutionWidth)
        : latticeWidthInput.value || "";
    latticeHeightInput.value =
      typeof currentResolutionHeight !== "undefined"
        ? String(currentResolutionHeight)
        : latticeHeightInput.value || "";

    latticeWidthInput.addEventListener("change", applyGridFromInputs);
    latticeHeightInput.addEventListener("change", applyGridFromInputs);
  }

  if (timeStepInput) {
    // Initialize from currentTimeStep (if available) or TIME_STEP.
    const baseDt =
      typeof currentTimeStep !== "undefined"
        ? currentTimeStep
        : typeof TIME_STEP !== "undefined"
        ? TIME_STEP
        : 0.1;
    timeStepInput.value = String(baseDt);

    timeStepInput.addEventListener("change", () => {
      let dt = parseFloat(timeStepInput.value);
      if (!Number.isFinite(dt)) {
        dt = baseDt;
      }
      dt = Math.max(0.001, Math.min(1, dt));
      currentTimeStep = dt;
      timeStepInput.value = String(dt);

      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
    });
  }

  if (wavefunctionTabs.length && wavefunctionPanels.length) {
    const activateWavefunctionTab = (targetName) => {
      wavefunctionTabs.forEach((tab) => {
        const name = tab.getAttribute("data-tab");
        const isActive = name === targetName;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      wavefunctionPanels.forEach((panel) => {
        const name = panel.getAttribute("data-tab-panel");
        const isActive = name === targetName;
        panel.classList.toggle("is-active", isActive);
      });
    };

    wavefunctionTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-tab");
        if (!name) return;
        activateWavefunctionTab(name);
      });
    });
  }

  // Ψ rescaling mode: two mutually exclusive checkboxes (Norm / Max).
  const rescaleNormInput = document.getElementById("psi-rescale-norm");
  const rescaleMaxInput = document.getElementById("psi-rescale-max");

  const applyPsiRescaleSelection = (mode) => {
    const normalizedMode =
      mode === "norm" || mode === "max" ? mode : "none";

    if (typeof psiRescaleMode !== "undefined") {
      psiRescaleMode = normalizedMode;
    }

    if (rescaleNormInput) {
      rescaleNormInput.checked = normalizedMode === "norm";
    }
    if (rescaleMaxInput) {
      rescaleMaxInput.checked = normalizedMode === "max";
    }
  };

  if (rescaleNormInput || rescaleMaxInput) {
    // Initialize from global psiRescaleMode if available.
    const initialMode =
      typeof psiRescaleMode === "string" ? psiRescaleMode : "none";
    applyPsiRescaleSelection(initialMode);

    if (rescaleNormInput) {
      rescaleNormInput.addEventListener("change", () => {
        if (rescaleNormInput.checked) {
          applyPsiRescaleSelection("norm");
        } else {
          // If Norm is turned off and Max is on, stay in Max; otherwise behave like "none".
          const nextMode =
            rescaleMaxInput && rescaleMaxInput.checked ? "max" : "none";
          applyPsiRescaleSelection(nextMode);
        }
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
      });
    }

    if (rescaleMaxInput) {
      rescaleMaxInput.addEventListener("change", () => {
        if (rescaleMaxInput.checked) {
          applyPsiRescaleSelection("max");
        } else {
          // If Max is turned off and Norm is on, stay in Norm; otherwise behave like "none".
          const nextMode =
            rescaleNormInput && rescaleNormInput.checked ? "norm" : "none";
          applyPsiRescaleSelection(nextMode);
        }
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
      });
    }
  }

  const imaginaryToggle = document.getElementById("imaginary-time-toggle");
  if (imaginaryToggle) {
    // Initialize from global flag if available.
    if (typeof isImaginaryTime !== "undefined") {
      imaginaryToggle.checked = !!isImaginaryTime;
    }

    imaginaryToggle.addEventListener("change", () => {
      if (typeof isImaginaryTime !== "undefined") {
        isImaginaryTime = !!imaginaryToggle.checked;
      }
      // Enabling imaginary-time evolution should also enable Norm rescaling.
      if (imaginaryToggle.checked && typeof applyPsiRescaleSelection === "function") {
        applyPsiRescaleSelection("norm");
      }
      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
    });
  }

  if (saveSetupButton && typeof exportCurrentSetup === "function") {
    saveSetupButton.addEventListener("click", () => {
      exportCurrentSetup();
    });
  }

  if (loadSetupButton && typeof applySetupObject === "function") {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".psi,application/json,.json";
    fileInput.style.display = "none";

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      const isPsi = /\.psi$/i.test(file.name);

      reader.onload = async () => {
        try {
          if (isPsi) {
            if (typeof loadSetupFromPsiArrayBuffer === "function") {
              await loadSetupFromPsiArrayBuffer(reader.result);
            } else {
              console.error(
                "[Schrödinger] loadSetupFromPsiArrayBuffer() is not available"
              );
            }
          } else {
            const jsonText =
              typeof reader.result === "string" ? reader.result : "";
            const obj = JSON.parse(String(jsonText || ""));
            applySetupObject(obj);
          }
        } catch (err) {
          console.error("[Schrödinger] Failed to load setup:", err);
        } finally {
          fileInput.value = "";
        }
      };

      if (isPsi) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });

    document.body.appendChild(fileInput);

    loadSetupButton.addEventListener("click", () => {
      fileInput.click();
    });
  }

  const presetSelect = document.getElementById("preset-select");
  if (presetSelect && typeof loadSetupFromPsiArrayBuffer === "function") {
    const loadPresetList = async () => {
      try {
        const response = await fetch("setup_files/index.json", {
          cache: "no-cache",
        });
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status} while fetching setup_files/index.json`
          );
        }
        const filenames = await response.json();
        if (!Array.isArray(filenames)) return;

        const presets = filenames
          .filter((name) => typeof name === "string" && /\.psi$/i.test(name))
          .map((filename) => {
            const path = `setup_files/${filename}`;
            const base = filename.replace(/\.psi$/i, "");
            // Use the full base name as the label, replacing underscores with spaces.
            const label = base.replace(/_/g, " ");
            return { label, path };
          });

        // Preserve the order from index.json when adding options.
        presets.forEach((preset) => {
          const opt = document.createElement("option");
          opt.value = preset.path;
          opt.textContent = preset.label;
          presetSelect.appendChild(opt);
        });
      } catch (err) {
        console.error("[Schrödinger] Failed to load preset list:", err);
      }
    };

    loadPresetList();

    presetSelect.addEventListener("change", async () => {
      const url = presetSelect.value;
      if (!url) return;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} while fetching ${url}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        await loadSetupFromPsiArrayBuffer(arrayBuffer);
        // Reset selection so the display label stays constant and nothing is preselected next time.
        presetSelect.value = "";
        const dropdownApi = enhancedDropdowns.get(presetSelect);
        if (dropdownApi && typeof dropdownApi.updateDisplay === "function") {
          dropdownApi.updateDisplay();
        }
      } catch (err) {
        console.error("[Schrödinger] Failed to load preset setup:", err);
      }
    });

    enhanceDropdown(presetSelect, { align: "center", staticLabel: "Preset Experiments" });
  }

  const playPauseButton = document.getElementById("play-pause");
  if (playPauseButton) {
    const playPauseIcon =
      playPauseButton.querySelector(".transport-icon") || playPauseButton;

    playPauseButton.addEventListener("click", () => {
      isPlaying = !isPlaying;
      playPauseIcon.textContent = isPlaying ? "⏸" : "▶";
      if (saveSetupButton) {
        saveSetupButton.disabled = isPlaying;
      }
      if (isPlaying) {
        if (initialPsiDirty) {
          resetWavefunctionFromControls();
        }
        console.log("[Schrödinger] Simulation started");
        // Hide wave-packet creation tools while simulation runs
        creationToolsVisible = false;

        // Resume recording if enabled.
        if (isRecording) {
          startCanvasRecorderIfNeeded();
          resumeCanvasRecorder();
        }
      } else {
        console.log("[Schrödinger] Simulation paused at t =", simTime.toFixed(3));
        // Pausing does not automatically bring back creation tools
        if (isRecording) {
          pauseCanvasRecorder();
        }
      }

      updateRecordBlink();
      updateParticleOverlay();
    });
  }

  // Overlay toggles (colorbar and energy), enabled by default.
  const colorbarToggle = document.getElementById("toggle-colorbar");
  if (colorbarToggle) {
    colorbarToggle.checked = true;
    colorbarToggle.addEventListener("change", () => {
      if (typeof showColorbar !== "undefined") {
        showColorbar = !!colorbarToggle.checked;
      }
      drawScene();
    });
  }

  const energyToggle = document.getElementById("toggle-energy");
  if (energyToggle) {
    energyToggle.checked = true;
    energyToggle.addEventListener("change", () => {
      if (typeof showEnergy !== "undefined") {
        showEnergy = !!energyToggle.checked;
      }
      drawScene();
    });
  }

  const resetButton = document.getElementById("reset-packet");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (!canvas) return;
      // Reset wavefunction, pause simulation, and re-enable creation tools
      isPlaying = false;
      simTime = 0;
      frameCount = 0;
      creationToolsVisible = true;
      if (saveSetupButton) {
        saveSetupButton.disabled = false;
      }
      if (playPauseButton) {
        const playPauseIcon =
          playPauseButton.querySelector(".transport-icon") || playPauseButton;
        playPauseIcon.textContent = "▶";
      }
      resetWavefunctionFromControls();
      drawScene();
      updateParticleOverlay();

       // Finalize and download the recording if one is in progress.
       if (isRecording) {
         stopCanvasRecorderAndPromptDownload();
         isRecording = false;
         const recordButton = document.getElementById("record-toggle");
         if (recordButton) {
           recordButton.classList.remove("recording");
           recordButton.setAttribute("aria-pressed", "false");
         }
       }

      updateRecordBlink();

      console.log("[Schrödinger] Wave packet reset from controls and tools shown");
    });
  }

  const graySlider = document.getElementById("potential-gray");
  const grayEdit = document.getElementById("potential-gray-edit");
  const grayToggle = document.querySelector(
    '[data-slider-toggle="potential-gray"]'
  );
  const grayPopup = document.querySelector(
    '.slider-popup[data-for="potential-gray"]'
  );

  const vMaxEdit = document.getElementById("v-max-edit");
  const vMaxSlider = document.getElementById("v-max-slider");
  const vMaxToggle = document.querySelector('[data-slider-toggle="v-max"]');
  const vMaxPopup = document.querySelector(
    '.slider-popup[data-for="v-max"]'
  );
  const uploadBrowseButton = document.getElementById("upload-browse");
  const uploadInvertButton = document.getElementById("upload-invert");
  const functionInput = document.getElementById("potential-function-input");

  const sizeSlider = document.getElementById("brush-size");
  const sizeEdit = document.getElementById("brush-size-edit");
  const sizeToggle = document.querySelector('[data-slider-toggle="brush-size"]');
  const sizePopup = document.querySelector(
    '.slider-popup[data-for="brush-size"]'
  );

  const shapeThicknessSlider = document.getElementById("shape-thickness");
  const shapeThicknessEdit = document.getElementById("shape-thickness-edit");
  const shapeThicknessToggle = document.querySelector(
    '[data-slider-toggle="shape-thickness"]'
  );
  const shapeThicknessPopup = document.querySelector(
    '.slider-popup[data-for="shape-thickness"]'
  );

  const hardnessSlider = document.getElementById("brush-hardness");
  const hardnessEdit = document.getElementById("brush-hardness-edit");
  const hardnessToggle = document.querySelector(
    '[data-slider-toggle="brush-hardness"]'
  );
  const hardnessPopup = document.querySelector(
    '.slider-popup[data-for="brush-hardness"]'
  );

  const sliderPopups = Array.from(document.querySelectorAll(".slider-popup"));

  const closeAllSliderPopups = () => {
    sliderPopups.forEach((popup) => {
      const control = popup.closest(".top-control");
      if (control) {
        control.classList.remove("slider-open");
        const toggle = control.querySelector(".slider-toggle");
        if (toggle) {
          toggle.setAttribute("aria-expanded", "false");
        }
      }
    });
  };

  if (graySlider) {
    const applyGrayFromSlider = () => {
      const raw = parseInt(graySlider.value, 10);
      if (!Number.isFinite(raw)) return;
      potentialGray = raw;
      if (grayEdit && document.activeElement !== grayEdit) {
        const normalized = raw / 255;
        grayEdit.value = normalized.toFixed(2);
      }
    };

    graySlider.addEventListener("input", applyGrayFromSlider);
    applyGrayFromSlider();

    if (grayEdit) {
      const raw = Number.isFinite(potentialGray)
        ? potentialGray
        : parseInt(graySlider.value, 10) || 0;
      const normalized = raw / 255;
      grayEdit.value = normalized.toFixed(2);
      const commitGrayEdit = () => {
        let normalized = parseFloat(grayEdit.value);
        if (!Number.isFinite(normalized)) {
          normalized = Number.isFinite(potentialGray)
            ? potentialGray / 255
            : 0;
        }
        normalized = Math.max(0, Math.min(1, normalized));
        const raw = Math.round(normalized * 255);
        graySlider.value = String(raw);
        applyGrayFromSlider();
      };
      grayEdit.addEventListener("change", commitGrayEdit);
      grayEdit.addEventListener("blur", commitGrayEdit);
      grayEdit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitGrayEdit();
          grayEdit.blur();
        }
      });
    }

    if (grayToggle && grayPopup) {
      grayToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const control = grayPopup.closest(".top-control.potential-setting");
        if (!control) return;
        const alreadyOpen = control.classList.contains("slider-open");
        closeAllSliderPopups();
        if (!alreadyOpen) {
          control.classList.add("slider-open");
          grayToggle.setAttribute("aria-expanded", "true");
          graySlider.focus({ preventScroll: true });
        }
      });
    }
  }

  if (sizeSlider) {
    const applySizeFromSlider = () => {
      const v = parseFloat(sizeSlider.value);
      if (Number.isFinite(v) && v > 0) {
        brushSize = v;
        if (sizeEdit && document.activeElement !== sizeEdit) {
          sizeEdit.value = String(v);
        }
      }
    };

    sizeSlider.addEventListener("input", applySizeFromSlider);
    applySizeFromSlider();

    if (sizeEdit) {
      sizeEdit.value = String(
        Number.isFinite(brushSize) ? brushSize : sizeSlider.value
      );
      const commitSizeEdit = () => {
        let v = parseFloat(sizeEdit.value);
        if (!Number.isFinite(v) || v <= 0) {
          v = brushSize;
        }
        const min = parseFloat(sizeSlider.min);
        const max = parseFloat(sizeSlider.max);
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        sizeSlider.value = String(v);
        applySizeFromSlider();
      };
      sizeEdit.addEventListener("change", commitSizeEdit);
      sizeEdit.addEventListener("blur", commitSizeEdit);
      sizeEdit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitSizeEdit();
          sizeEdit.blur();
        }
      });
    }

    if (sizeToggle && sizePopup) {
      sizeToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const control = sizePopup.closest(".top-control");
        if (!control) return;
        const alreadyOpen = control.classList.contains("slider-open");
        closeAllSliderPopups();
        if (!alreadyOpen) {
          control.classList.add("slider-open");
          sizeToggle.setAttribute("aria-expanded", "true");
          sizeSlider.focus({ preventScroll: true });
        }
      });
    }
  }

  if (vMaxEdit || vMaxSlider) {
    const vMaxMin = 0;
    const vMaxMax =
      typeof POTENTIAL_SCALE === "number" && POTENTIAL_SCALE > 0
        ? POTENTIAL_SCALE
        : 1;

    if (vMaxEdit) {
      vMaxEdit.min = String(vMaxMin);
      vMaxEdit.max = String(vMaxMax);
      if (!vMaxEdit.step) {
        vMaxEdit.step = (vMaxMax / 100).toString();
      }
    }
    if (vMaxSlider) {
      vMaxSlider.min = String(vMaxMin);
      vMaxSlider.max = String(vMaxMax);
      const sliderStep = vMaxMax / 100;
      if (Number.isFinite(sliderStep) && sliderStep > 0) {
        vMaxSlider.step = String(sliderStep);
      }
    }

    const applyVMax = (nextV) => {
      if (!Number.isFinite(nextV)) {
        nextV = Number.isFinite(currentVMax) ? currentVMax : INITIAL_V_MAX;
      }
      nextV = Math.max(vMaxMin, Math.min(vMaxMax, nextV));

      const oldVMax = currentVMax;
      currentVMax = nextV;

      if (vMaxEdit && document.activeElement !== vMaxEdit) {
        vMaxEdit.value = currentVMax.toFixed(2);
      }
      if (vMaxSlider && document.activeElement !== vMaxSlider) {
        vMaxSlider.value = String(currentVMax);
      }

      if (
        potentialField &&
        potentialWidth > 0 &&
        potentialHeight > 0 &&
        Number.isFinite(oldVMax) &&
        oldVMax > 0 &&
        oldVMax !== currentVMax
      ) {
        const scale = currentVMax / oldVMax;
        const n = potentialField.length;
        for (let i = 0; i < n; i++) {
          const val = potentialField[i] || 0;
          const next = Math.max(0, Math.min(1, val * scale));
          potentialField[i] = next;
        }
        redrawPotential();
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (typeof drawScene === "function") {
          drawScene();
        }
      }
    };

    const initialV =
      Number.isFinite(currentVMax) && currentVMax >= vMaxMin
        ? currentVMax
        : INITIAL_V_MAX;
    applyVMax(initialV);

    if (vMaxEdit) {
      const commitVMaxEdit = () => {
        const v = parseFloat(vMaxEdit.value);
        applyVMax(v);
      };
      vMaxEdit.addEventListener("change", commitVMaxEdit);
      vMaxEdit.addEventListener("blur", commitVMaxEdit);
      vMaxEdit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitVMaxEdit();
          vMaxEdit.blur();
        }
      });
    }

    if (vMaxSlider) {
      const applyVMaxFromSlider = () => {
        const v = parseFloat(vMaxSlider.value);
        applyVMax(v);
      };
      vMaxSlider.addEventListener("input", applyVMaxFromSlider);
    }

    if (vMaxToggle && vMaxPopup && vMaxSlider) {
      vMaxToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const control = vMaxPopup.closest(".top-control");
        if (!control) return;
        const alreadyOpen = control.classList.contains("slider-open");
        closeAllSliderPopups();
        if (!alreadyOpen) {
          control.classList.add("slider-open");
          vMaxToggle.setAttribute("aria-expanded", "true");
          vMaxSlider.focus({ preventScroll: true });
        }
      });
    }
  }

  if (uploadBrowseButton) {
    uploadBrowseButton.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            applyImageAsPotential(img);
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }

  if (uploadInvertButton) {
    uploadInvertButton.addEventListener("click", () => {
      if (!potentialField || potentialWidth === 0 || potentialHeight === 0) {
        return;
      }
      const rawVMax =
        Number.isFinite(currentVMax) && currentVMax >= 0
          ? currentVMax
          : INITIAL_V_MAX;
      const vMax =
        typeof POTENTIAL_SCALE === "number" && POTENTIAL_SCALE > 0
          ? Math.max(0, Math.min(POTENTIAL_SCALE, rawVMax))
          : Math.max(0, rawVMax);
      const n = potentialField.length;
      for (let i = 0; i < n; i++) {
        const val = potentialField[i] || 0;
        const next = Math.max(0, Math.min(1, vMax - val));
        potentialField[i] = next;
      }
      redrawPotential();
      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
      if (typeof drawScene === "function") {
        drawScene();
      }
    });
  }

  if (functionInput) {
    const applyFunctionPotentialFromInput = () => {
      const expr = functionInput.value.trim();
      if (!expr) return;
      if (typeof applyFunctionAsPotential === "function") {
        applyFunctionAsPotential(expr);
      } else {
        alert("Function-defined potentials are not available in this build.");
      }
    };

    functionInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (currentTool === "function") {
          applyFunctionPotentialFromInput();
        }
        functionInput.blur();
      }
    });
  }

  // brush size control removed for shapes; brushSize is still adjusted by keyboard shortcuts.

  if (shapeThicknessSlider) {
    const applyThicknessFromSlider = () => {
      const v = parseFloat(shapeThicknessSlider.value);
      if (Number.isFinite(v) && v > 0) {
        shapeThickness = v;
        if (shapeThicknessEdit && document.activeElement !== shapeThicknessEdit) {
          shapeThicknessEdit.value = String(v);
        }
      }
    };

    shapeThicknessSlider.addEventListener("input", applyThicknessFromSlider);
    applyThicknessFromSlider();

    if (shapeThicknessEdit) {
      shapeThicknessEdit.value = String(
        Number.isFinite(shapeThickness)
          ? shapeThickness
          : shapeThicknessSlider.value
      );
      const commitThicknessEdit = () => {
        let v = parseFloat(shapeThicknessEdit.value);
        if (!Number.isFinite(v) || v <= 0) {
          v = shapeThickness;
        }
        const min = parseFloat(shapeThicknessSlider.min);
        const max = parseFloat(shapeThicknessSlider.max);
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        shapeThicknessSlider.value = String(v);
        applyThicknessFromSlider();
      };
      shapeThicknessEdit.addEventListener("change", commitThicknessEdit);
      shapeThicknessEdit.addEventListener("blur", commitThicknessEdit);
      shapeThicknessEdit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitThicknessEdit();
          shapeThicknessEdit.blur();
        }
      });
    }

    if (shapeThicknessToggle && shapeThicknessPopup) {
      shapeThicknessToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const control = shapeThicknessPopup.closest(".top-control");
        if (!control) return;
        const alreadyOpen = control.classList.contains("slider-open");
        closeAllSliderPopups();
        if (!alreadyOpen) {
          control.classList.add("slider-open");
          shapeThicknessToggle.setAttribute("aria-expanded", "true");
          shapeThicknessSlider.focus({ preventScroll: true });
        }
      });
    }
  }
  if (hardnessSlider) {
    const applyHardnessFromSlider = () => {
      const v = parseFloat(hardnessSlider.value);
      if (Number.isFinite(v)) {
        brushHardness = Math.max(0, Math.min(1, v));
        if (hardnessEdit && document.activeElement !== hardnessEdit) {
          hardnessEdit.value = v.toFixed(2);
        }
      }
    };

    hardnessSlider.addEventListener("input", applyHardnessFromSlider);
    applyHardnessFromSlider();

    if (hardnessEdit) {
      hardnessEdit.value = Number.isFinite(brushHardness)
        ? brushHardness.toFixed(2)
        : hardnessSlider.value;
      const commitHardnessEdit = () => {
        let v = parseFloat(hardnessEdit.value);
        if (!Number.isFinite(v)) {
          v = brushHardness;
        }
        const min = parseFloat(hardnessSlider.min);
        const max = parseFloat(hardnessSlider.max);
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        hardnessSlider.value = String(v);
        applyHardnessFromSlider();
      };
      hardnessEdit.addEventListener("change", commitHardnessEdit);
      hardnessEdit.addEventListener("blur", commitHardnessEdit);
      hardnessEdit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitHardnessEdit();
          hardnessEdit.blur();
        }
      });
    }

    if (hardnessToggle && hardnessPopup) {
      hardnessToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const control = hardnessPopup.closest(".top-control");
        if (!control) return;
        const alreadyOpen = control.classList.contains("slider-open");
        closeAllSliderPopups();
        if (!alreadyOpen) {
          control.classList.add("slider-open");
          hardnessToggle.setAttribute("aria-expanded", "true");
          hardnessSlider.focus({ preventScroll: true });
        }
      });
    }
  }

  // Shape top-bar controls (used when Shapes tool is active)
  const shapeDisplay = document.getElementById("shape-display");
  const shapeMenu = document.getElementById("shape-menu");
  const shapeOptions = shapeMenu
    ? Array.from(shapeMenu.querySelectorAll(".shape-option"))
    : [];
  const shapeFillToggle = document.getElementById("shape-fill-toggle");
  const shapeRegularToggle = document.getElementById("shape-regular-toggle");
  const shapeRegularLabelText = document.getElementById(
    "shape-regular-label-text"
  );
  const shapeSettingControls = document.querySelectorAll(
    ".top-control.shape-setting"
  );
  const shapeIconDisplay = shapeDisplay
    ? shapeDisplay.querySelector(".shape-icon")
    : null;

  const applyShapeSelection = (shape) => {
    if (!shape) return;
    currentShapeMode = shape;
    let selectedIcon = null;
    shapeOptions.forEach((opt) => {
      const isActive = opt.dataset.shape === shape;
      opt.setAttribute("aria-checked", isActive ? "true" : "false");
      if (isActive && !selectedIcon) {
        selectedIcon = opt.querySelector(".shape-icon");
      }
    });
    if (shapeIconDisplay && selectedIcon) {
      shapeIconDisplay.className = selectedIcon.className;
      shapeIconDisplay.innerHTML = selectedIcon.innerHTML;
    }
    if (shapeFillToggle) {
      const showFill = shape !== "line";
      const fillControl = shapeFillToggle.closest(".shape-fill-setting");
      if (fillControl) {
        fillControl.style.display = showFill ? "flex" : "none";
        const prev = fillControl.previousElementSibling;
        if (prev && prev.classList.contains("top-separator-left")) {
          prev.style.display = showFill ? "block" : "none";
        }
      }
    }

    if (shapeRegularToggle) {
      const isRegularShape =
        shape === "triangle" || shape === "square" || shape === "circle";
      const regularControl = shapeRegularToggle.closest(".shape-regular-setting");
      if (regularControl) {
        regularControl.style.display = isRegularShape ? "flex" : "none";
        const prev = regularControl.previousElementSibling;
        if (prev && prev.classList.contains("top-separator-left")) {
          prev.style.display = isRegularShape ? "block" : "none";
        }
      }
      if (shapeRegularLabelText) {
        shapeRegularLabelText.textContent =
          shape === "circle" ? "Circle" : "Regular";
      }
    }
  };

  if (shapeDisplay && shapeMenu) {
    shapeDisplay.addEventListener("click", (event) => {
      event.stopPropagation();
      const parent = shapeDisplay.closest(".shape-setting");
      if (!parent) return;
      const isOpen = parent.classList.contains("is-open");
      document
        .querySelectorAll(".shape-setting.is-open")
        .forEach((node) => node.classList.remove("is-open"));
      if (!isOpen) {
        parent.classList.add("is-open");
        shapeDisplay.setAttribute("aria-expanded", "true");
      } else {
        shapeDisplay.setAttribute("aria-expanded", "false");
      }
    });

    shapeOptions.forEach((opt) => {
      opt.addEventListener("click", (event) => {
        event.stopPropagation();
        const shape = opt.dataset.shape;
        applyShapeSelection(shape);
        const parent = shapeDisplay.closest(".shape-setting");
        if (parent) {
          parent.classList.remove("is-open");
        }
        shapeDisplay.setAttribute("aria-expanded", "false");
      });
    });

    applyShapeSelection(
      typeof currentShapeMode === "string" ? currentShapeMode : "line"
    );
  }

  if (shapeFillToggle) {
    shapeFillToggle.checked = !!shapeFillEnabled;
    shapeFillToggle.addEventListener("change", () => {
      shapeFillEnabled = !!shapeFillToggle.checked;
    });
  }

  if (shapeRegularToggle) {
    shapeRegularToggle.checked = !!shapeRegularEnabled;
    shapeRegularToggle.addEventListener("change", () => {
      shapeRegularEnabled = !!shapeRegularToggle.checked;
    });
  }

  // Close any open sliders or shape menu when clicking/tapping outside the top toolbar controls.
  const handleGlobalPointerDown = (event) => {
    const target = event.target;

    // Close slider popups if click is outside any potential-setting control.
    let insideSliderControl = false;
    const potentialControls = document.querySelectorAll(
      ".top-control.potential-setting, .top-control.shape-setting, .top-control.upload-setting, .top-control.function-setting"
    );
    potentialControls.forEach((control) => {
      if (control.contains(target)) {
        insideSliderControl = true;
      }
    });
    if (!insideSliderControl) {
      closeAllSliderPopups();
    }

    // Close shape menu if click is outside shape-setting container.
    if (shapeDisplay) {
      const container = shapeDisplay.closest(".shape-setting");
      if (container && !container.contains(target)) {
        container.classList.remove("is-open");
        shapeDisplay.setAttribute("aria-expanded", "false");
      }
    }
  };

  document.addEventListener("mousedown", handleGlobalPointerDown);
  document.addEventListener("pointerdown", handleGlobalPointerDown);


  const toolButtons = document.querySelectorAll(".tool-button[data-tool]");
  if (toolButtons.length) {
    const potentialSettingControls = document.querySelectorAll(
      ".top-control.potential-setting"
    );
    const uploadSettingControls = document.querySelectorAll(
      ".top-control.upload-setting"
    );
     const functionSettingControls = document.querySelectorAll(
      ".top-control.function-setting"
    );

    const setControlAndSeparatorVisibility = (el, visible) => {
      const displayValue = visible ? "flex" : "none";
      el.style.display = displayValue;
      const prev = el.previousElementSibling;
      if (prev && prev.classList.contains("top-separator-left")) {
        prev.style.display = visible ? "block" : "none";
      }
    };

    const updateTopControlsVisibility = () => {
      const isBrush = currentTool === "brush";
      const isEraser = currentTool === "eraser";
      const isBucket = currentTool === "bucket";
      const isEyedropper = currentTool === "eyedropper";
      const isMove = currentTool === "move";
      const isUpload = currentTool === "upload";
      const isFunctionTool = currentTool === "function";
      const isShapes = currentTool === "shapes";

      // Potential / size / hardness controls:
      potentialSettingControls.forEach((el) => {
        const isPotential = el.querySelector("#potential-gray-edit");
        const isSize = el.querySelector("#brush-size-edit");
        const isHardness = el.querySelector("#brush-hardness-edit");

        if (isMove) {
          // Hide all main potential controls for move
          setControlAndSeparatorVisibility(el, false);
        } else if (isPotential) {
          // Hide potential for eraser, upload, function, move
          setControlAndSeparatorVisibility(
            el,
            !isEraser && !isUpload && !isFunctionTool
          );
        } else if (isSize) {
          // Size only meaningful for brush/eraser
          setControlAndSeparatorVisibility(el, isBrush || isEraser);
        } else if (isHardness) {
          // Hardness meaningful for brush/eraser/shapes
          setControlAndSeparatorVisibility(el, isBrush || isEraser || isShapes);
        } else {
          // Fallback: show only for brush/eraser by default
          setControlAndSeparatorVisibility(el, isBrush || isEraser);
        }
      });

      // Shape-related controls only when Shapes tool is active
      shapeSettingControls.forEach((el) => {
        setControlAndSeparatorVisibility(el, isShapes);
      });

      // Upload controls only when Upload tool is active
      uploadSettingControls.forEach((el) => {
        setControlAndSeparatorVisibility(el, isUpload);
      });

      // Function controls only when Function tool is active
      functionSettingControls.forEach((el) => {
        setControlAndSeparatorVisibility(el, isFunctionTool);
      });

      if (isShapes) {
        applyShapeSelection(
          typeof currentShapeMode === "string" ? currentShapeMode : "line"
        );
      }
    };

    toolButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool;
        if (!tool) return;

        // "Clear" acts immediately and does not change the active drawing tool
        if (tool === "clear") {
          clearPotential();
          redrawPotential();
          if (typeof drawScene === "function") {
            drawScene();
          }
          console.log("[Schrödinger] Potential cleared");
          updateTopControlsVisibility();
          return;
        }

        currentTool = tool;
        toolButtons.forEach((b) => {
          b.classList.toggle("active", b === button);
        });
        updateTopControlsVisibility();

        if (typeof hideBrushPreview === "function") {
          hideBrushPreview();
        }
      });
    });

    // Default to brush tool on load
    const initialTool = "brush";
    const initialButton = Array.from(toolButtons).find(
      (btn) => btn.dataset.tool === initialTool
    );
    if (initialButton) {
      currentTool = initialTool;
      toolButtons.forEach((b) => {
        b.classList.toggle("active", b === initialButton);
      });
    }

    // Initialize visibility based on default tool
    updateTopControlsVisibility();
  }

  const boundaryRadios = Array.from(
    document.querySelectorAll('input[name="boundary-mode"]')
  );
  if (boundaryRadios.length) {
    const applyBoundaryFromRadios = () => {
      const checked = boundaryRadios.find((input) => input.checked);
      const mode = checked && checked.value === "closed" ? "closed" : "open";
      boundaryMode = mode;
      console.log("[Schrödinger] Boundary mode set to", mode);
    };

    boundaryRadios.forEach((input) => {
      input.addEventListener("change", (event) => {
        applyBoundaryFromRadios();
        if (event.isTrusted && typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
      });
    });

    applyBoundaryFromRadios();
  }

  setupBasicSliders();
  setupSigmaSliders();
  setupPotentialDrawing();
  resizeCanvas();
  if (typeof resetPotentialHistory === "function") {
    resetPotentialHistory();
  }
  setupParticleUI();

  // Enable drag-to-adjust behavior for labels of numeric inputs.
  const numericLabelTargets = [];
  document.querySelectorAll("label[for]").forEach((label) => {
    const id = label.getAttribute("for");
    if (!id) return;
    const input = document.getElementById(id);
    if (!input) return;
    if (input.tagName === "INPUT" && input.type === "number") {
      numericLabelTargets.push({ label, input });
      label.classList.add("numeric-drag-label");
    }
  });

  let activeNumericDrag = null;

  const endNumericDrag = () => {
    if (!activeNumericDrag) return;
    window.removeEventListener("mousemove", handleNumericMouseMove);
    window.removeEventListener("mouseup", handleNumericMouseUp);
    document.body.style.userSelect = activeNumericDrag.prevUserSelect || "";
    const { input, valueChanged } = activeNumericDrag;
    if (valueChanged) {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    activeNumericDrag = null;
  };

  const handleNumericMouseMove = (event) => {
    if (!activeNumericDrag) return;
    const { input, startX, startValue, step, min, max } = activeNumericDrag;
    const dx = event.clientX - startX;
    const pixelsPerStep = 5;
    const deltaSteps = Math.round(dx / pixelsPerStep);
    let next = startValue + deltaSteps * step;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    if (!Number.isFinite(next)) return;
    if (next === activeNumericDrag.currentValue) return;
    activeNumericDrag.currentValue = next;
    activeNumericDrag.valueChanged = true;
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const handleNumericMouseUp = () => {
    endNumericDrag();
  };

  numericLabelTargets.forEach(({ label, input }) => {
    label.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      input.focus({ preventScroll: true });

      const startValue = parseFloat(input.value);
      const step =
        (input.step && Number.isFinite(parseFloat(input.step)))
          ? Math.abs(parseFloat(input.step))
          : 1;
      const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
      const max = input.max !== "" ? parseFloat(input.max) : Infinity;

      activeNumericDrag = {
        input,
        startX: event.clientX,
        startValue: Number.isFinite(startValue) ? startValue : 0,
        step: Number.isFinite(step) && step > 0 ? step : 1,
        min,
        max,
        prevUserSelect: document.body.style.userSelect,
        currentValue: startValue,
        valueChanged: false,
      };

      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleNumericMouseMove);
      window.addEventListener("mouseup", handleNumericMouseUp);
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initApp();
  setupHoverTooltips();

  // Ensure layout (including MathJax) has settled, then resync sizes once
  window.addEventListener("load", () => {
    resizeCanvas();
    updateParticleOverlay();
  });

  // Start animation loop once everything is ready
  animationLoop();
});

window.addEventListener("resize", resizeCanvas);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (isRecording) {
      pauseCanvasRecorder();
      updateRecordBlink();
    }
  } else if (document.visibilityState === "visible") {
    if (isRecording && isPlaying) {
      startCanvasRecorderIfNeeded();
      resumeCanvasRecorder();
    }
    updateRecordBlink();
  }
});
