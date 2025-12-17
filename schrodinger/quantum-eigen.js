// --- Eigenstate utilities ---------------------------------------------------

function getDiscoveredEigenstates() {
  return eigenstates.slice();
}

function isEigenstateSearchRunning() {
  return eigenstateSearchInProgress;
}

function clearEigenstates() {
  eigenstates = [];
}

function applyEigenstateToWavefunction(index) {
  if (!eigenstates || index < 0 || index >= eigenstates.length) return;
  const state = eigenstates[index];
  if (!state || !state.re || !state.im) return;

  const w = simWidth;
  const h = simHeight;
  const count = w * h;
  if (!w || !h) return;
  if (
    state.re.length !== count ||
    state.im.length !== count
  ) {
    console.warn(
      "[Schrödinger] Stored eigenstate grid does not match current simulation grid"
    );
    return;
  }

  if (!psiRe || !psiIm || psiRe.length !== count || psiIm.length !== count) {
    initSimulationGrid(w, h);
  }

  for (let i = 0; i < count; i++) {
    psiRe[i] = state.re[i];
    psiIm[i] = state.im[i];
  }

  // Ensure eigenstate wavefunctions are normalized for consistent energy
  // and visualization, and recompute the plotting scale accordingly.
  normalizeWavefunctionToUnitNorm();
  updatePlotScaleFromCurrentPsi();

  initialPsiDirty = false;
  wavefunctionCanBeReconstructedFromControls = false;
  if (typeof simTime !== "undefined") {
    simTime = 0;
  }
  if (typeof frameCount !== "undefined") {
    frameCount = 0;
  }

  if (typeof drawScene === "function") {
    drawScene();
  }
  if (typeof updateParticleOverlay === "function") {
    updateParticleOverlay();
  }
  if (typeof markSimulationStarted === "function") {
    markSimulationStarted();
  }
}

function initializeRandomGaussianForEigensearch() {
  if (!canvas) return;

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;

  const centerX = width / 2;
  const centerY = height / 2;
  const scalePos =
    typeof getScalePos === "function"
      ? getScalePos(width)
      : (BASE_SCALE_POS * width) / BASE_RESOLUTION;

  const halfWidthWorld = (width / scalePos) * 0.5;
  const halfHeightWorld = (height / scalePos) * 0.5;

  // Random center within the interior of the domain.
  const mu_x = (Math.random() * 2 - 1) * halfWidthWorld * 0.8;
  const mu_y = (Math.random() * 2 - 1) * halfHeightWorld * 0.8;

  // Start with exactly zero momentum.
  const pxDisplay = 0;
  const pyDisplay = 0;

  const mu_px =
    typeof displayMomentumToInternal === "function"
      ? displayMomentumToInternal(pxDisplay)
      : pxDisplay;
  const mu_py =
    typeof displayMomentumToInternal === "function"
      ? displayMomentumToInternal(pyDisplay)
      : pyDisplay;

  const sigma =
    typeof EIGENSTATE_GAUSSIAN_SIGMA_R === "number" &&
    Number.isFinite(EIGENSTATE_GAUSSIAN_SIGMA_R) &&
    EIGENSTATE_GAUSSIAN_SIGMA_R > 0
      ? EIGENSTATE_GAUSSIAN_SIGMA_R
      : 0.5 * (halfWidthWorld + halfHeightWorld);

  const total = width * height;
  if (!psiRe || !psiIm || psiRe.length !== total || psiIm.length !== total) {
    initSimulationGrid(width, height);
  }

  let idx = 0;
  for (let j = 0; j < height; j++) {
    const yCoord = (centerY - j) / scalePos;
    for (let i = 0; i < width; i++) {
      const xCoord = (i - centerX) / scalePos;
      const psiVal = phi(
        xCoord,
        yCoord,
        mu_x,
        mu_y,
        sigma,
        sigma,
        mu_px,
        mu_py
      );

      if (idx === 0 && psiVal && typeof psiVal.normFactor === "number") {
        currentNormFactor = psiVal.normFactor;
      }

      psiRe[idx] = psiVal.re;
      psiIm[idx] = psiVal.im;
      idx++;
    }
  }

  // Normalize the initial random packet used for eigenstate search.
  normalizeWavefunctionToUnitNorm();
  updatePlotScaleFromCurrentPsi();

  initialPsiDirty = false;
  wavefunctionCanBeReconstructedFromControls = false;
}

function gramSchmidtAgainstEigenstates() {
  if (!psiRe || !psiIm) return;
  if (!eigenstates || !eigenstates.length) return;

  const n = psiRe.length;

  // Use the same spatial area element dA as in
  // normalizeWavefunctionToUnitNorm so that inner products
  // match the physical ⟨·,·⟩ used elsewhere.
  let dA = 1;
  if (typeof canvas !== "undefined" && canvas && canvas.width) {
    const width = canvas.width;
    const scalePos =
      typeof getScalePos === "function"
        ? getScalePos(width)
        : (BASE_SCALE_POS * width) / BASE_RESOLUTION;
    if (Number.isFinite(scalePos) && scalePos > 0) {
      dA = 1 / (scalePos * scalePos);
    }
  }

  for (let k = 0; k < eigenstates.length; k++) {
    const basis = eigenstates[k];
    if (
      !basis ||
      !basis.re ||
      !basis.im ||
      basis.re.length !== n ||
      basis.im.length !== n
    ) {
      continue;
    }

    const basisRe = basis.re;
    const basisIm = basis.im;

    let projRe = 0;
    let projIm = 0;
    for (let i = 0; i < n; i++) {
      const br = basisRe[i];
      const bi = basisIm[i];
      const vr = psiRe[i];
      const vi = psiIm[i];
      projRe += br * vr + bi * vi;
      projIm += br * vi - bi * vr;
    }

    // Approximate ⟨basis, ψ⟩ = Σ conj(basis) ψ dA with the
    // same area weight dA used in normalization.
    projRe *= dA;
    projIm *= dA;

    if (!Number.isFinite(projRe) && !Number.isFinite(projIm)) {
      continue;
    }

    for (let i = 0; i < n; i++) {
      const br = basisRe[i];
      const bi = basisIm[i];
      const vr = psiRe[i];
      const vi = psiIm[i];
      const subRe = projRe * br - projIm * bi;
      const subIm = projRe * bi + projIm * br;
      psiRe[i] = vr - subRe;
      psiIm[i] = vi - subIm;
    }
  }
}

function computeMaxWavefunctionDelta(oldRe, oldIm) {
  if (!psiRe || !psiIm || !oldRe || !oldIm) return 0;
  const n = Math.min(
    psiRe.length,
    psiIm.length,
    oldRe.length,
    oldIm.length
  );
  if (!Number.isFinite(n) || n <= 0) return 0;

  let maxDelta = 0;
  for (let i = 0; i < n; i++) {
    const dRe = psiRe[i] - oldRe[i];
    const dIm = psiIm[i] - oldIm[i];
    const d = Math.hypot(dRe, dIm);
    if (d > maxDelta) {
      maxDelta = d;
    }
  }
  return maxDelta;
}

async function findEigenstates(targetCount, options = {}) {
  if (!canvas) return { count: 0, cancelled: false };

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return { count: 0, cancelled: false };

  const onProgress =
    options && typeof options.onProgress === "function"
      ? options.onProgress
      : null;

  const requestedCount = Math.max(1, Math.floor(targetCount || 1));

  // Clamp to a reasonable maximum to avoid runaway work.
  const maxStates = 32;
  const existingCount = Array.isArray(eigenstates) ? eigenstates.length : 0;
  const remainingCapacity = Math.max(0, maxStates - existingCount);
  const additional = Math.min(requestedCount, remainingCapacity);

  if (additional <= 0) {
    return { count: existingCount, cancelled: false };
  }

  if (eigenstateSearchInProgress) {
    console.warn("[Schrödinger] Eigenstate search already in progress");
    return { count: eigenstates.length, cancelled: true };
  }

  eigenstateSearchInProgress = true;

  const prevIsPlaying = isPlaying;
  const prevImaginaryFlag =
    typeof isImaginaryTime !== "undefined" ? isImaginaryTime : false;
  const prevRescaleMode =
    typeof psiRescaleMode === "string" ? psiRescaleMode : "none";
  const prevCreationToolsVisible =
    typeof creationToolsVisible !== "undefined"
      ? creationToolsVisible
      : true;

  isPlaying = false;
  if (typeof markSimulationStarted === "function") {
    markSimulationStarted();
  } else if (typeof creationToolsVisible !== "undefined") {
    creationToolsVisible = false;
  }

  if (typeof isImaginaryTime !== "undefined") {
    isImaginaryTime = true;
  }
  if (typeof psiRescaleMode !== "undefined") {
    // Use norm-preserving rescaling during eigenstate search.
    psiRescaleMode = "norm";
  }

  const total = width * height;
  const oldRe = new Float32Array(total);
  const oldIm = new Float32Array(total);

  try {
    const startIndex = existingCount;
    const targetTotal = existingCount + additional;

    for (let stateIndex = startIndex; stateIndex < targetTotal; stateIndex++) {
      initializeRandomGaussianForEigensearch();

      // Make the initial condition orthogonal to any previously found states.
      if (eigenstates.length) {
        gramSchmidtAgainstEigenstates();
      }
      rescaleWavefunctionIfNeeded();

      let converged = false;

      const maxIters =
        typeof eigenstateMaxIterationsPerState === "number" &&
        Number.isFinite(eigenstateMaxIterationsPerState) &&
        eigenstateMaxIterationsPerState > 0
          ? eigenstateMaxIterationsPerState
          : typeof EIGENSTATE_MAX_ITERATIONS_EXP === "number" &&
            Number.isFinite(EIGENSTATE_MAX_ITERATIONS_EXP)
          ? Math.max(
              1,
              Math.round(Math.pow(10, EIGENSTATE_MAX_ITERATIONS_EXP))
            )
          : 4000;

      const threshold =
        typeof eigenstateRelaxationDelta === "number" &&
        Number.isFinite(eigenstateRelaxationDelta) &&
        eigenstateRelaxationDelta > 0
          ? eigenstateRelaxationDelta
          : typeof EIGENSTATE_RELAXATION_DELTA_EXP === "number" &&
            Number.isFinite(EIGENSTATE_RELAXATION_DELTA_EXP)
          ? Math.pow(10, EIGENSTATE_RELAXATION_DELTA_EXP)
          : 1e-6;

      const drawEvery =
        typeof EIGENSTATE_DRAW_EVERY_N_STEPS === "number" &&
        Number.isFinite(EIGENSTATE_DRAW_EVERY_N_STEPS) &&
        EIGENSTATE_DRAW_EVERY_N_STEPS > 0
          ? Math.floor(EIGENSTATE_DRAW_EVERY_N_STEPS)
          : 25;

      for (let iter = 0; iter < maxIters; iter++) {
        oldRe.set(psiRe);
        oldIm.set(psiIm);

        // Imaginary-time step using the standard integrator.
        stepSchrodinger();

        // Enforce orthogonality to previously found eigenstates.
        if (eigenstates.length) {
          gramSchmidtAgainstEigenstates();
        }

        // Rescale according to the selected mode (Max for eigenstate search).
        rescaleWavefunctionIfNeeded();

        const maxDelta = computeMaxWavefunctionDelta(oldRe, oldIm);

        if (onProgress) {
          onProgress({
            stateIndex,
            iteration: iter,
            maxDelta,
          });
        }

        if (maxDelta < threshold) {
          converged = true;
          break;
        }

        if (drawEvery > 0 && iter % drawEvery === 0) {
          if (typeof drawScene === "function") {
            drawScene();
          }
          // Capture a video frame during eigenstate relaxation if recording is enabled.
          if (
            typeof isRecording !== "undefined" &&
            isRecording &&
            typeof recordFrameIfNeeded === "function"
          ) {
            recordFrameIfNeeded();
          }
          await new Promise((resolve) => {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => resolve());
            } else {
              setTimeout(resolve, 0);
            }
          });
        }

        if (options && options.signal && options.signal.aborted) {
          return {
            count: eigenstates.length,
            cancelled: true,
          };
        }
      }

      if (!converged) {
        console.warn(
          `[Schrödinger] Eigenstate ψ_${stateIndex} did not fully converge`
        );
      }

      // Store a copy of the converged (or best-effort) wavefunction.
      eigenstates.push({
        re: new Float32Array(psiRe),
        im: new Float32Array(psiIm),
      });
    }

    // After the last state, draw the final wavefunction and capture a final frame.
    if (typeof drawScene === "function") {
      drawScene();
    }
    if (
      typeof isRecording !== "undefined" &&
      isRecording &&
      typeof recordFrameIfNeeded === "function"
    ) {
      recordFrameIfNeeded();
    }

    return {
      count: eigenstates.length,
      cancelled: false,
    };
  } finally {
    if (typeof isImaginaryTime !== "undefined") {
      isImaginaryTime = prevImaginaryFlag;
    }
    if (typeof psiRescaleMode !== "undefined") {
      psiRescaleMode = prevRescaleMode;
    }
    isPlaying = prevIsPlaying;
    // Once an eigenstate search has run, keep creation tools disabled until an explicit stop/reset.
    simulationStopped = false;

    eigenstateSearchInProgress = false;
    if (typeof syncCreationToolsVisibility === "function") {
      syncCreationToolsVisibility();
    }
  }
}
