// Potential and control history management (undo/redo snapshots).
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
    eigenstates:
      typeof eigenstates !== "undefined" && Array.isArray(eigenstates)
        ? eigenstates.map((st) => ({
            re:
              st && st.re && st.re.length
                ? new Float32Array(st.re)
                : null,
            im:
              st && st.im && st.im.length
                ? new Float32Array(st.im)
                : null,
          }))
        : null,
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
  if (typeof updateCurrentVMaxFromField === "function") {
    updateCurrentVMaxFromField();
  }
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

      if (typeof overlayCanvas !== "undefined" && overlayCanvas) {
        const aspect = h > 0 ? h / w : 1;
        overlayCanvas.width = Math.round(
          typeof OVERLAY_CANVAS_BASE_WIDTH === "number" && OVERLAY_CANVAS_BASE_WIDTH > 0
            ? OVERLAY_CANVAS_BASE_WIDTH
            : Math.max(1, w)
        );
        overlayCanvas.height = Math.max(
          1,
          Math.round(overlayCanvas.width * aspect)
        );
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

  // 2b) Eigenstates
  if (
    snapshot.eigenstates &&
    typeof eigenstates !== "undefined" &&
    Array.isArray(snapshot.eigenstates)
  ) {
    eigenstates = [];
    snapshot.eigenstates.forEach((st) => {
      if (!st || !st.re || !st.im) return;
      eigenstates.push({
        re: new Float32Array(st.re),
        im: new Float32Array(st.im),
      });
    });

    if (typeof updateEigenstateList === "function") {
      updateEigenstateList();
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
    if (typeof markSimulationStopped === "function") {
      markSimulationStopped();
    } else if (typeof creationToolsVisible !== "undefined") {
      creationToolsVisible = isGaussianWavefunctionTabActive();
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
    const eigenGoButton = document.getElementById("eigenstates-go");
    if (eigenGoButton) {
      eigenGoButton.disabled = false;
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

  if (typeof updateCurrentVMaxFromField === "function") {
    updateCurrentVMaxFromField();
  }

  if (typeof updateEigenstateList === "function") {
    updateEigenstateList();
  }
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
