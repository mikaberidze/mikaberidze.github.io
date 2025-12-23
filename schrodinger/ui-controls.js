// Core UI controls: sliders, inputs, dropdowns, and bootstrap wiring.

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

let generalPropertiesDefaults = null;

// Parse simple mathematical expressions used in text inputs, such as
// "10^5", "10^{-6}", or plain numeric/scientific-notation values.
function parseEquationInput(text, options) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s) return null;

  // Match 10^exp with optional braces around the exponent, e.g. 10^-6 or 10^{-6}.
  const powMatch = /^10\s*\^\s*\{?\s*([+-]?\d+)\s*\}?\s*$/i.exec(s);
  if (powMatch) {
    const exp = parseInt(powMatch[1], 10);
    if (Number.isFinite(exp)) {
      let value = Math.pow(10, exp);
      if (options && options.integer) {
        value = Math.round(value);
      }
      return value;
    }
  }

  const numeric = Number(s);
  if (Number.isFinite(numeric)) {
    let value = numeric;
    if (options && options.integer) {
      value = Math.round(value);
    }
    return value;
  }

  return null;
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
  // Clamp to the mathematical domain of asin to avoid NaNs,
  // but do not apply an additional component-wise momentum cap here.
  const clamped = Math.max(-2, Math.min(2, p));
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

    // Match x,y slider ranges to the full simulation domain (in world units)
    if (id === "x" || id === "y") {
      const halfRange = BASE_RESOLUTION / (2 * BASE_SCALE_POS);
      slider.min = String(-halfRange);
      slider.max = String(halfRange);
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

    if (typeof trackToolUsage === "function") {
      trackToolUsage("general_properties", {
        property: "lattice",
        width: w,
        height: h,
      });
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

  if (selectEl.classList.contains("colormap-select")) {
    wrapper.classList.add("select-enhancer-colormap");
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

  const tooltipText =
    typeof selectEl.getAttribute === "function"
      ? selectEl.getAttribute("data-tooltip")
      : null;
  if (tooltipText) {
    display.setAttribute("data-tooltip", tooltipText);
  }

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

    const colormapId =
      selected && selected.dataset ? selected.dataset.colormapId : null;
    if (display.classList.contains("colormap-select")) {
      if (colormapId) {
        display.dataset.colormapId = colormapId;
      } else {
        display.removeAttribute("data-colormap-id");
      }
    }

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
        if (option.dataset && option.dataset.colormapId) {
          btn.dataset.colormapId = option.dataset.colormapId;
        }
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

  // Initialize hidden sliders for momentum and sigma from constants.
  const pxSlider = document.getElementById("px");
  const pySlider = document.getElementById("py");
  if (pxSlider) {
    const pxInitial = Number.isFinite(INITIAL_PX_INTERNAL)
      ? INITIAL_PX_INTERNAL
      : parseFloat(pxSlider.value) || 0;
    pxSlider.value = String(pxInitial);
  }
  if (pySlider) {
    const pyInitial = Number.isFinite(INITIAL_PY_INTERNAL)
      ? INITIAL_PY_INTERNAL
      : parseFloat(pySlider.value) || 0;
    pySlider.value = String(pyInitial);
  }

  const sigmaXSlider = document.getElementById("sigma-x-slider");
  const sigmaPSlider = document.getElementById("sigma-p-slider");
  if (sigmaXSlider && sigmaPSlider) {
    const min = parseFloat(sigmaXSlider.min) || 0;
    const max = parseFloat(sigmaXSlider.max) || 1;
    const clampPos = (pos) => Math.max(min, Math.min(max, pos));

    const sigmaInitial =
      Number.isFinite(INITIAL_SIGMA_R) && INITIAL_SIGMA_R > 0
        ? INITIAL_SIGMA_R
        : positionToValue(parseFloat(sigmaXSlider.value));
    const sigmaPInitial =
      sigmaInitial > 0 ? PRODUCT_TARGET / sigmaInitial : Infinity;

    const posX = clampPos(valueToPosition(sigmaInitial));
    const posP = clampPos(valueToPosition(sigmaPInitial));

    sigmaXSlider.value = String(posX);
    sigmaPSlider.value = String(posP);
  }

  const recordButton = document.getElementById("record-toggle");
  if (recordButton) {
    recordButton.addEventListener("click", () => {
      const wasRecording =
        typeof isRecording !== "undefined" ? !!isRecording : false;

      if (!wasRecording) {
        // Start a new recording session.
        isRecording = true;
        recordButton.classList.add("recording");
        recordButton.setAttribute("aria-pressed", "true");
        if (typeof trackToolUsage === "function") {
          trackToolUsage("recording", { action: "start" });
        }

        if (isPlaying) {
          startCanvasRecorderIfNeeded();
          resumeCanvasRecorder();
        }
      } else {
        // Stop the current recording session and prompt a download.
        if (typeof stopCanvasRecorderAndPromptDownload === "function") {
          stopCanvasRecorderAndPromptDownload();
        }
        isRecording = false;
        recordButton.classList.remove("recording");
        recordButton.setAttribute("aria-pressed", "false");
        if (typeof trackToolUsage === "function") {
          trackToolUsage("recording", { action: "stop" });
        }
      }

      if (typeof updateRecordBlink === "function") {
        updateRecordBlink();
      }
    });
  }

  const pipButton = document.getElementById("pip-toggle");
  if (pipButton) {
    if (
      typeof isPictureInPictureSupported === "function" &&
      !isPictureInPictureSupported()
    ) {
      pipButton.disabled = true;
      pipButton.setAttribute(
        "data-tooltip",
        "Picture-in-Picture is not supported in this browser."
      );
    } else if (typeof togglePictureInPicture === "function") {
      pipButton.addEventListener("click", () => {
        togglePictureInPicture();
      });
    }
  }

  const fullscreenButton = document.getElementById("fullscreen-toggle");
  if (fullscreenButton && typeof toggleFullscreen === "function") {
    fullscreenButton.addEventListener("click", () => {
      toggleFullscreen();
    });
    if (typeof updateFullscreenButtonVisualState === "function") {
      updateFullscreenButtonVisualState();
    }
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
  const eigenCountInput = document.getElementById("eigenstates-count");
  const eigenGoButton = document.getElementById("eigenstates-go");
  const eigenThresholdInput = document.getElementById("eigenstates-threshold");
  const eigenMaxItersInput = document.getElementById("eigenstates-max-iters");
  const eigenListEl = document.getElementById("eigenstates-list");
  const eigenStatusEl = document.getElementById("eigenstates-status");
  let eigenSearchRecentlyAborted = false;

  // Keep the eigenstate GO button disabled while the simulation is running.
  const updateEigenGoButtonDisabled = () => {
    if (!eigenGoButton) return;
    const playing =
      typeof isPlaying !== "undefined" ? !!isPlaying : false;
    eigenGoButton.disabled = playing;
  };
  updateEigenGoButtonDisabled();

  const sectionToggles = document.querySelectorAll("[data-section-toggle]");
  const sectionTitles = document.querySelectorAll(".controls-section-title");

  const setSectionVisibility = (key, expanded) => {
    const panel = document.querySelector(
      `[data-section-panel="${key}"]`
    );
    const toggle = document.querySelector(
      `[data-section-toggle="${key}"]`
    );
    if (toggle) {
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  };

  const animatePanel = (panel, expanded) => {
    if (!panel) return;
    const currentHeight = panel.getBoundingClientRect().height;
    panel.style.maxHeight = `${currentHeight}px`;
    panel.style.overflow = "hidden";
    // Force reflow before changing max-height
    // eslint-disable-next-line no-unused-expressions
    panel.offsetHeight;
    if (expanded) {
      const target = panel.scrollHeight;
      panel.classList.remove("is-collapsed");
      panel.style.maxHeight = `${target}px`;
      const clearMax = () => {
        panel.style.maxHeight = "none";
        panel.style.overflow = "visible";
        panel.removeEventListener("transitionend", clearMax);
      };
      panel.addEventListener("transitionend", clearMax);
    } else {
      const target = currentHeight || panel.scrollHeight;
      panel.style.maxHeight = `${target}px`;
      // Force reflow then collapse
      // eslint-disable-next-line no-unused-expressions
      panel.offsetHeight;
      panel.classList.add("is-collapsed");
      panel.style.maxHeight = "0px";
      const clearOverflow = () => {
        panel.style.overflow = "hidden";
        panel.removeEventListener("transitionend", clearOverflow);
      };
      panel.addEventListener("transitionend", clearOverflow);
    }
  };

  sectionToggles.forEach((toggle) => {
    const key = toggle.getAttribute("data-section-toggle");
    if (!key) return;
    const panel = document.querySelector(
      `[data-section-panel="${key}"]`
    );
    if (!panel) return;
    toggle.addEventListener("click", () => {
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      const next = !isExpanded;
      animatePanel(panel, next);
      setSectionVisibility(key, next);
    });
  });

  sectionTitles.forEach((title) => {
    const toggle = title.querySelector("[data-section-toggle]");
    const resetButton = title.querySelector("[data-section-reset]");
    const key = toggle ? toggle.getAttribute("data-section-toggle") : null;
    if (!toggle || !key) return;
    title.addEventListener("click", (event) => {
      const isToggleTarget =
        event.target === toggle || toggle.contains(event.target);
      const isResetTarget =
        resetButton &&
        (event.target === resetButton || resetButton.contains(event.target));
      if (isToggleTarget || isResetTarget) return;
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      const next = !isExpanded;
      const panel = document.querySelector(
        `[data-section-panel="${key}"]`
      );
      if (panel && !next) {
        // Collapse: ensure we start from current height to avoid clipping
        panel.style.maxHeight = `${panel.scrollHeight}px`;
      }
      animatePanel(panel, next);
      setSectionVisibility(key, next);
    });
  });

  const updateLatticeResolution = (w, h) => {
    if (
      typeof currentResolutionWidth === "undefined" ||
      typeof currentResolutionHeight === "undefined"
    ) {
      return false;
    }

    let nextW = Number.isFinite(w) ? Math.round(w) : currentResolutionWidth;
    let nextH = Number.isFinite(h) ? Math.round(h) : currentResolutionHeight;

    nextW = Math.max(50, Math.min(2000, nextW));
    nextH = Math.max(50, Math.min(2000, nextH));

    const changed =
      nextW !== currentResolutionWidth || nextH !== currentResolutionHeight;

    currentResolutionWidth = nextW;
    currentResolutionHeight = nextH;

    if (latticeWidthInput) {
      latticeWidthInput.value = String(nextW);
    }
    if (latticeHeightInput) {
      latticeHeightInput.value = String(nextH);
    }

    if (changed) {
      if (typeof canvasInitialized !== "undefined") {
        canvasInitialized = false;
      }
      if (typeof resizeCanvas === "function") {
        resizeCanvas();
      }
    }

    return changed;
  };

  const applyGridFromInputs = () => {
    if (!latticeWidthInput || !latticeHeightInput) {
      return;
    }

    const w = parseInt(latticeWidthInput.value, 10);
    const h = parseInt(latticeHeightInput.value, 10);

    const changed = updateLatticeResolution(w, h);

    if (changed && typeof savePotentialHistory === "function") {
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

  let setTimeStepValue = null;

  if (timeStepInput) {
    // Initialize from currentTimeStep (if available) or TIME_STEP.
    const baseDt =
      typeof currentTimeStep !== "undefined"
        ? currentTimeStep
        : typeof TIME_STEP !== "undefined"
        ? TIME_STEP
        : 0.1;

    setTimeStepValue = (
      dtRaw,
      { recordHistory = true, track = true } = {}
    ) => {
      let dt = parseFloat(dtRaw);
      if (!Number.isFinite(dt)) {
        dt = baseDt;
      }
      dt = Math.max(0.001, Math.min(1, dt));
      currentTimeStep = dt;
      timeStepInput.value = String(dt);

      if (recordHistory && typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
      if (track && typeof trackToolUsage === "function") {
        trackToolUsage("general_properties", {
          property: "time_step",
          value: dt,
        });
      }
      return dt;
    };

    setTimeStepValue(baseDt, { recordHistory: false, track: false });

    timeStepInput.addEventListener("change", () => {
      setTimeStepValue(timeStepInput.value, {
        recordHistory: true,
        track: true,
      });
    });
  }

  // Eigenstate convergence threshold control.
  if (eigenThresholdInput) {
    const baseExponent =
      typeof EIGENSTATE_RELAXATION_DELTA_EXP === "number" &&
      Number.isFinite(EIGENSTATE_RELAXATION_DELTA_EXP)
        ? EIGENSTATE_RELAXATION_DELTA_EXP
        : -6;
    const defaultThresholdValue = Math.pow(10, baseExponent);
    const defaultThresholdExpr = `10^${baseExponent}`;

    if (typeof eigenstateRelaxationDelta !== "undefined") {
      eigenstateRelaxationDelta = defaultThresholdValue;
    }

    eigenThresholdInput.value = defaultThresholdExpr;

    eigenThresholdInput.addEventListener("change", () => {
      const parsed = parseEquationInput(
        eigenThresholdInput.value,
        { integer: false }
      );
      let value = parsed;
      if (!Number.isFinite(value) || value <= 0) {
        value = defaultThresholdValue;
        eigenThresholdInput.value = defaultThresholdExpr;
      }
      if (typeof eigenstateRelaxationDelta !== "undefined") {
        eigenstateRelaxationDelta = value;
      }
      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
    });
  }

  // Eigenstate maximum iterations-per-state control.
  if (eigenMaxItersInput) {
    const baseExponent =
      typeof EIGENSTATE_MAX_ITERATIONS_EXP === "number" &&
      Number.isFinite(EIGENSTATE_MAX_ITERATIONS_EXP)
        ? EIGENSTATE_MAX_ITERATIONS_EXP
        : 5;
    const defaultMaxItersValue = Math.max(
      1,
      Math.round(Math.pow(10, baseExponent))
    );
    const defaultMaxItersExpr = `10^${baseExponent}`;

    if (typeof eigenstateMaxIterationsPerState !== "undefined") {
      eigenstateMaxIterationsPerState = defaultMaxItersValue;
    }

    eigenMaxItersInput.value = defaultMaxItersExpr;

    eigenMaxItersInput.addEventListener("change", () => {
      const parsed = parseEquationInput(
        eigenMaxItersInput.value,
        { integer: true }
      );
      let maxIters = parsed;
      if (!Number.isFinite(maxIters) || maxIters <= 0) {
        maxIters = defaultMaxItersValue;
        eigenMaxItersInput.value = defaultMaxItersExpr;
      }
      maxIters = Math.max(1, Math.round(maxIters));
      if (typeof eigenstateMaxIterationsPerState !== "undefined") {
        eigenstateMaxIterationsPerState = maxIters;
      }
      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
    });
  }

  // Time integrator selection (Euler vs Crank–Nicolson).
  const integratorEulerInput = document.getElementById("integrator-euler");
  const integratorCrankInput = document.getElementById("integrator-crank");

  const applyIntegratorSelection = (scheme) => {
    const mode = scheme === "euler" ? "euler" : "crank";

    if (typeof integratorScheme !== "undefined") {
      integratorScheme = mode;
    }

    if (integratorEulerInput) {
      integratorEulerInput.checked = mode === "euler";
    }
    if (integratorCrankInput) {
      integratorCrankInput.checked = mode === "crank";
    }
  };

  // Remember the real-time integrator to restore after leaving imaginary time.
  let prevRealTimeIntegrator = null;

  // Remember the ψ rescale mode to restore after leaving imaginary time.
  let prevPsiRescaleModeOnImaginaryToggle = null;

  if (integratorEulerInput || integratorCrankInput) {
    const initialIntegrator =
      typeof integratorScheme === "string" ? integratorScheme : "crank";
    applyIntegratorSelection(initialIntegrator);

    if (integratorEulerInput) {
      integratorEulerInput.addEventListener("change", () => {
        // Treat as exclusive selection: always switch to Euler on interaction.
        applyIntegratorSelection("euler");
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (typeof trackToolUsage === "function") {
          trackToolUsage("general_properties", {
            property: "integrator",
            value: "euler",
          });
        }
      });
    }

    if (integratorCrankInput) {
      integratorCrankInput.addEventListener("change", () => {
        // Treat as exclusive selection: always switch to Crank–Nicolson.
        applyIntegratorSelection("crank");
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (typeof trackToolUsage === "function") {
          trackToolUsage("general_properties", {
            property: "integrator",
            value: "crank",
          });
        }
      });
    }
  }

  if (wavefunctionTabs.length && wavefunctionPanels.length) {
    let activeEigenstateIndex = -1;
    let eigenSearchAbortController = null;

    const renderEigenstatesList = () => {
      if (!eigenListEl) return;

      const list =
        typeof getDiscoveredEigenstates === "function"
          ? getDiscoveredEigenstates()
          : [];

      eigenListEl.innerHTML = "";

      if (!list.length) {
        return;
      }

      list.forEach((_, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "eigenstate-pill";
        btn.innerHTML = `\\(\\psi_{${index}}\\)`;
        btn.setAttribute("data-tooltip", "n-th eigenstate.");
        btn.setAttribute("data-eigen-index", String(index));
        if (index === activeEigenstateIndex) {
          btn.classList.add("is-active");
        }
        btn.addEventListener("click", () => {
          if (
            typeof isEigenstateSearchRunning === "function" &&
            isEigenstateSearchRunning()
          ) {
            return;
          }
          if (typeof applyEigenstateToWavefunction === "function") {
            applyEigenstateToWavefunction(index);
            activeEigenstateIndex = index;
            renderEigenstatesList();
            if (eigenListEl) {
              const activeBtn = eigenListEl.querySelector(
                `button.eigenstate-pill[data-eigen-index="${index}"]`
              );
              if (activeBtn && typeof activeBtn.focus === "function") {
                activeBtn.focus();
              }
            }
          }
        });

        if (
          typeof scheduleHoverTooltip === "function" &&
          typeof hideHoverTooltip === "function"
        ) {
          const handleEnter = () => {
            scheduleHoverTooltip(btn);
          };
          const handleLeave = () => {
            hideHoverTooltip(btn);
          };
          const handleFocus = () => {
            scheduleHoverTooltip(btn);
          };
          btn.addEventListener("mouseenter", handleEnter);
          btn.addEventListener("mouseleave", handleLeave);
          btn.addEventListener("focus", handleFocus);
          btn.addEventListener("blur", handleLeave);
        }

        eigenListEl.appendChild(btn);
      });

      // Append a trash-can clear button at the end of the list when there are eigenstates.
      if (
        typeof clearEigenstates === "function" &&
        list.length > 0
      ) {
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "eigenstate-pill eigenstate-clear";
        clearBtn.setAttribute("aria-label", "Clear eigenstates");

        const img = document.createElement("img");
        img.src = "icons/trash.png";
        img.alt = "";
        clearBtn.appendChild(img);

        clearBtn.addEventListener("click", () => {
          if (
            typeof isEigenstateSearchRunning === "function" &&
            isEigenstateSearchRunning()
          ) {
            return;
          }
          clearEigenstates();
          activeEigenstateIndex = -1;
          renderEigenstatesList();
          if (eigenStatusEl) {
            eigenStatusEl.textContent = "";
          }
        });

        eigenListEl.appendChild(clearBtn);
      }

      typesetMathInElement(eigenListEl);
    };
    window.updateEigenstateList = renderEigenstatesList;

    if (eigenListEl) {
      eigenListEl.addEventListener("keydown", (event) => {
        const key = event.key;
        if (key !== "ArrowLeft" && key !== "ArrowRight") {
          return;
        }

        const target = event.target;
        if (
          !target ||
          !(target instanceof HTMLElement) ||
          !target.classList.contains("eigenstate-pill") ||
          target.classList.contains("eigenstate-clear")
        ) {
          return;
        }

        if (
          typeof isEigenstateSearchRunning === "function" &&
          isEigenstateSearchRunning()
        ) {
          return;
        }

        const currentIndexAttr = target.getAttribute("data-eigen-index");
        const currentIndex = currentIndexAttr
          ? parseInt(currentIndexAttr, 10)
          : -1;
        if (!Number.isFinite(currentIndex) || currentIndex < 0) {
          return;
        }

        const list =
          typeof getDiscoveredEigenstates === "function"
            ? getDiscoveredEigenstates()
            : [];
        const count = Array.isArray(list) ? list.length : 0;
        if (!count) {
          return;
        }

        let nextIndex = currentIndex;
        if (key === "ArrowRight") {
          nextIndex = Math.min(count - 1, currentIndex + 1);
        } else if (key === "ArrowLeft") {
          nextIndex = Math.max(0, currentIndex - 1);
        }

        if (nextIndex === currentIndex) {
          return;
        }

        event.preventDefault();

        if (typeof applyEigenstateToWavefunction === "function") {
          applyEigenstateToWavefunction(nextIndex);
        }
        activeEigenstateIndex = nextIndex;
        renderEigenstatesList();

        const nextBtn = eigenListEl.querySelector(
          `button.eigenstate-pill[data-eigen-index="${nextIndex}"]`
        );
        if (nextBtn && typeof nextBtn.focus === "function") {
          nextBtn.focus();
        }
      });
    }

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

      // If an eigenstate search was recently aborted and the user switches
      // back to the Gaussian tab, restore the Gaussian wave-packet controls
      // and redraw the corresponding wave-packet on the canvas.
      if (targetName === "gaussian" && eigenSearchRecentlyAborted) {
        eigenSearchRecentlyAborted = false;
        if (typeof markSimulationStopped === "function") {
          markSimulationStopped();
        } else if (typeof simulationStopped !== "undefined") {
          simulationStopped = true;
        }
        if (typeof resetWavefunctionFromControls === "function") {
          resetWavefunctionFromControls();
        }
        if (typeof drawScene === "function") {
          drawScene();
        }
        if (typeof updateParticleOverlay === "function") {
          updateParticleOverlay();
        }
      }

      // Wave-packet creation tools depend on both the active tab and simulation state.
      if (typeof syncCreationToolsVisibility === "function") {
        syncCreationToolsVisibility();
      } else if (typeof creationToolsVisible !== "undefined") {
        creationToolsVisible = targetName === "gaussian";
        if (typeof updateParticleOverlay === "function") {
          updateParticleOverlay();
        }
      }

      if (targetName === "eigenstates") {
        renderEigenstatesList();
      }
    };

    wavefunctionTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-tab");
        if (!name) return;
        activateWavefunctionTab(name);
      });
    });

    // Initialize the eigenstate list in case any are present after load.
    renderEigenstatesList();

    if (eigenGoButton && eigenCountInput) {
      eigenGoButton.addEventListener("click", async () => {
        // Do not start a new eigenstate search while the simulation is running.
        if (typeof isPlaying !== "undefined" && isPlaying) {
          return;
        }
        // If a search is already running, treat this as an abort request.
        if (
          typeof isEigenstateSearchRunning === "function" &&
          isEigenstateSearchRunning()
        ) {
          if (eigenSearchAbortController && typeof eigenSearchAbortController === "object") {
            eigenSearchAbortController.aborted = true;
          }
          if (eigenStatusEl) {
            eigenStatusEl.textContent = "Aborting eigenstate search\u2026";
          }
          return;
        }

        let count = parseInt(eigenCountInput.value, 10);
        if (!Number.isFinite(count) || count <= 0) {
          count = 1;
        }
        eigenCountInput.value = String(count);

        // Remember current imaginary-time / rescaling toggle states so we can
        // restore them after the eigenstate search finishes.
        const prevImaginaryChecked =
          typeof imaginaryToggle !== "undefined" && imaginaryToggle
            ? imaginaryToggle.checked
            : null;
        const prevRescaleNormChecked =
          typeof rescaleNormInput !== "undefined" && rescaleNormInput
            ? rescaleNormInput.checked
            : null;
        const prevRescaleMaxChecked =
          typeof rescaleMaxInput !== "undefined" && rescaleMaxInput
            ? rescaleMaxInput.checked
            : null;

        const prevImaginaryDisabled =
          imaginaryToggle && typeof imaginaryToggle.disabled === "boolean"
            ? imaginaryToggle.disabled
            : null;
        const prevRescaleNormDisabled =
          rescaleNormInput && typeof rescaleNormInput.disabled === "boolean"
            ? rescaleNormInput.disabled
            : null;
        const prevRescaleMaxDisabled =
          rescaleMaxInput && typeof rescaleMaxInput.disabled === "boolean"
            ? rescaleMaxInput.disabled
            : null;

        // Remember current integrator selection so we can restore it after
        // the eigenstate search finishes.
        const prevIntegratorScheme =
          typeof integratorScheme === "string" ? integratorScheme : null;

        // Remember current play / reset button disabled states so we can
        // restore them after the eigenstate search finishes.
        const prevPlayPauseDisabled =
          playPauseButton && typeof playPauseButton.disabled === "boolean"
            ? playPauseButton.disabled
            : null;
        const prevResetDisabled =
          resetButton && typeof resetButton.disabled === "boolean"
            ? resetButton.disabled
            : null;

        // Labels for frozen checkboxes, so we can visually fade them.
        const imaginaryToggleLabel = imaginaryToggle
          ? imaginaryToggle.closest(".toggle-label")
          : null;
        const rescaleNormLabel = rescaleNormInput
          ? rescaleNormInput.closest(".toggle-label")
          : null;
        const rescaleMaxLabel = rescaleMaxInput
          ? rescaleMaxInput.closest(".toggle-label")
          : null;
        const frozenLabels = [
          imaginaryToggleLabel,
          rescaleNormLabel,
          rescaleMaxLabel,
        ].filter(Boolean);

        // Visually reflect that imaginary-time evolution with Norm rescaling
        // is active during eigenstate searches.
        if (imaginaryToggle) {
          imaginaryToggle.checked = true;
          imaginaryToggle.disabled = true;
        }
        if (rescaleNormInput) {
          rescaleNormInput.checked = true;
          rescaleNormInput.disabled = true;
        }
        if (rescaleMaxInput) {
          rescaleMaxInput.checked = false;
          rescaleMaxInput.disabled = true;
        }

        // While eigenstate computation runs, temporarily switch to Euler
        // for imaginary-time evolution but leave the integrator toggles
        // interactive so the user can override if desired.
        if (typeof applyIntegratorSelection === "function") {
          applyIntegratorSelection("euler");
        }

        // Freeze and dim the start/stop controls while eigenstate computation runs.
        if (playPauseButton) {
          playPauseButton.disabled = true;
        }
        if (resetButton) {
          resetButton.disabled = true;
        }

        // Apply a faded style to all frozen checkbox labels.
        frozenLabels.forEach((label) => {
          label.classList.add("is-frozen-search");
        });

        if (typeof findEigenstates !== "function") {
          console.error(
            "[Schrödinger] findEigenstates() is not available in this build"
          );

          // Restore disabled state if we cannot start the search.
          if (imaginaryToggle && prevImaginaryDisabled !== null) {
            imaginaryToggle.disabled = prevImaginaryDisabled;
          }
          if (rescaleNormInput && prevRescaleNormDisabled !== null) {
            rescaleNormInput.disabled = prevRescaleNormDisabled;
          }
          if (rescaleMaxInput && prevRescaleMaxDisabled !== null) {
            rescaleMaxInput.disabled = prevRescaleMaxDisabled;
          }

          if (
            typeof applyIntegratorSelection === "function" &&
            prevIntegratorScheme
          ) {
            applyIntegratorSelection(prevIntegratorScheme);
          }

          if (playPauseButton && prevPlayPauseDisabled !== null) {
            playPauseButton.disabled = prevPlayPauseDisabled;
          }
          if (resetButton && prevResetDisabled !== null) {
            resetButton.disabled = prevResetDisabled;
          }

          frozenLabels.forEach((label) => {
            label.classList.remove("is-frozen-search");
          });
          return;
        }

        // While search is running, this button acts as an ABORT control.
        eigenGoButton.textContent = "ABORT";
        eigenCountInput.disabled = true;
        if (eigenStatusEl) {
          if (count === 1) {
            eigenStatusEl.innerHTML =
              "Finding ground-state eigenfunction ψ<sub>0</sub>…";
          } else {
            eigenStatusEl.textContent = `Finding first ${count} eigenstates…`;
          }
        }

        const abortController = { aborted: false };
        eigenSearchAbortController = abortController;
        eigenSearchRecentlyAborted = false;

        if (typeof trackToolUsage === "function") {
          trackToolUsage("eigenstate_computation", {
            action: "start",
            count,
          });
        }

        try {
          const result = await findEigenstates(count, {
            onProgress: (info) => {
              if (!eigenStatusEl || !info) return;
              const idx = info.stateIndex ?? 0;
              const iter = info.iteration ?? 0;
              const delta = info.maxDelta;
              const deltaText =
                typeof delta === "number" && Number.isFinite(delta)
                  ? delta.toExponential(2)
                  : "\u2014";
              const safeIdx = Number.isFinite(idx) ? idx : 0;
              const safeIter = Number.isFinite(iter) ? iter : 0;
              const safeDelta = String(deltaText);
              eigenStatusEl.innerHTML =
                `Relaxing ψ<sub>${safeIdx}</sub>: ` +
                `step ${safeIter}, ` +
                `‖Δψ‖<sub>&infin;</sub> ≈ ${safeDelta}`;
            },
            signal: abortController,
          });

          renderEigenstatesList();

          // On completion or cancellation, do not show a final status message;
          // just leave the eigenstate list updated.
          if (!result || result.cancelled) {
            // Optionally clear any in-progress status message.
            if (eigenStatusEl) {
              eigenStatusEl.textContent = "";
            }
          }
        } catch (err) {
          console.error("[Schrödinger] Eigenstate search failed:", err);
          if (eigenStatusEl) {
            eigenStatusEl.textContent = "Eigenstate search failed.";
          }
        } finally {
          eigenGoButton.textContent = "GO";
          eigenSearchAbortController = null;
          eigenCountInput.disabled = false;

          // Restore original toggle states.
          if (imaginaryToggle && prevImaginaryChecked !== null) {
            imaginaryToggle.checked = prevImaginaryChecked;
          }
          if (imaginaryToggle && prevImaginaryDisabled !== null) {
            imaginaryToggle.disabled = prevImaginaryDisabled;
          }
          if (rescaleNormInput && prevRescaleNormChecked !== null) {
            rescaleNormInput.checked = prevRescaleNormChecked;
          }
          if (rescaleMaxInput && prevRescaleMaxChecked !== null) {
            rescaleMaxInput.checked = prevRescaleMaxChecked;
          }
          if (rescaleNormInput && prevRescaleNormDisabled !== null) {
            rescaleNormInput.disabled = prevRescaleNormDisabled;
          }
          if (rescaleMaxInput && prevRescaleMaxDisabled !== null) {
            rescaleMaxInput.disabled = prevRescaleMaxDisabled;
          }

          if (
            typeof applyIntegratorSelection === "function" &&
            prevIntegratorScheme
          ) {
            applyIntegratorSelection(prevIntegratorScheme);
          }

          if (playPauseButton && prevPlayPauseDisabled !== null) {
            playPauseButton.disabled = prevPlayPauseDisabled;
          }
          if (resetButton && prevResetDisabled !== null) {
            resetButton.disabled = prevResetDisabled;
          }

          frozenLabels.forEach((label) => {
            label.classList.remove("is-frozen-search");
          });

          const wasCancelled =
            result && typeof result.cancelled === "boolean"
              ? !!result.cancelled
              : false;
          eigenSearchRecentlyAborted = wasCancelled;

          // If recording was enabled during the eigenstate search, finalize
          // the video and disable further recording until explicitly re-enabled.
          if (typeof isRecording !== "undefined" && isRecording) {
            if (typeof stopCanvasRecorderAndPromptDownload === "function") {
              stopCanvasRecorderAndPromptDownload();
            }
            isRecording = false;
            const recordButtonEl = document.getElementById("record-toggle");
            if (recordButtonEl) {
              recordButtonEl.classList.remove("recording");
              recordButtonEl.setAttribute("aria-pressed", "false");
            }
            if (typeof updateRecordBlink === "function") {
              updateRecordBlink();
            }
            if (typeof trackToolUsage === "function") {
              trackToolUsage("recording", {
                action: "stop_auto",
                reason: "eigen_search",
              });
            }
          }
        }
      });
    }
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

     // When Norm rescaling is selected, renormalize the wavefunction and
     // recompute the fixed plotting scale. For Max, use a unit plotting scale.
     if (normalizedMode === "norm") {
       if (typeof normalizeWavefunctionToUnitNorm === "function") {
         normalizeWavefunctionToUnitNorm();
       }
       if (typeof updatePlotScaleFromCurrentPsi === "function") {
         updatePlotScaleFromCurrentPsi();
       }
     } else if (normalizedMode === "max") {
       if (typeof plotScaleFactor !== "undefined") {
         plotScaleFactor = 1;
       }
     }
  };

  if (rescaleNormInput || rescaleMaxInput) {
    // Initialize from global psiRescaleMode if available.
    const initialMode =
      typeof psiRescaleMode === "string" ? psiRescaleMode : "none";
    applyPsiRescaleSelection(initialMode);

    if (rescaleNormInput) {
      rescaleNormInput.addEventListener("change", () => {
        let mode;
        if (rescaleNormInput.checked) {
          mode = "norm";
          applyPsiRescaleSelection(mode);
        } else {
          // If Norm is turned off and Max is on, stay in Max; otherwise behave like "none".
          mode =
            rescaleMaxInput && rescaleMaxInput.checked ? "max" : "none";
          applyPsiRescaleSelection(mode);
        }
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (typeof trackToolUsage === "function") {
          trackToolUsage("general_properties", {
            property: "psi_rescale",
            value: mode || "none",
          });
        }
      });
    }

    if (rescaleMaxInput) {
      rescaleMaxInput.addEventListener("change", () => {
        let mode;
        if (rescaleMaxInput.checked) {
          mode = "max";
          applyPsiRescaleSelection(mode);
        } else {
          // If Max is turned off and Norm is on, stay in Norm; otherwise behave like "none".
          mode =
            rescaleNormInput && rescaleNormInput.checked ? "norm" : "none";
          applyPsiRescaleSelection(mode);
        }
        if (typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (typeof trackToolUsage === "function") {
          trackToolUsage("general_properties", {
            property: "psi_rescale",
            value: mode || "none",
          });
        }
      });
    }
  }

  let setImaginaryTimeEnabled = null;
  const imaginaryToggle = document.getElementById("imaginary-time-toggle");
  if (imaginaryToggle) {
    setImaginaryTimeEnabled = (
      enabled,
      { recordHistory = true, track = true } = {}
    ) => {
      const nextImaginary = !!enabled;
      const prevImaginary =
        typeof isImaginaryTime === "boolean" ? isImaginaryTime : false;

      if (typeof isImaginaryTime !== "undefined") {
        isImaginaryTime = nextImaginary;
      }
      imaginaryToggle.checked = nextImaginary;

      if (nextImaginary && !prevImaginary) {
        // Switching into imaginary-time evolution: remember the current
        // real-time integrator so we can restore it later, and temporarily
        // switch to Euler for imaginary-time evolution.
        const currentScheme =
          typeof integratorScheme === "string" ? integratorScheme : "crank";
        prevRealTimeIntegrator = currentScheme;

        if (typeof applyIntegratorSelection === "function") {
          applyIntegratorSelection("euler");
        }

        // Remember current ψ rescale mode so we can restore it when leaving
        // imaginary-time evolution.
        prevPsiRescaleModeOnImaginaryToggle =
          typeof psiRescaleMode === "string" ? psiRescaleMode : null;

        // Enabling imaginary-time evolution should also enable Norm rescaling.
        if (typeof applyPsiRescaleSelection === "function") {
          applyPsiRescaleSelection("norm");
        }
      } else if (!nextImaginary && prevImaginary) {
        // Leaving imaginary-time evolution: restore the previously selected
        // real-time integrator and ψ rescaling mode, if we have them.
        const schemeToRestore =
          typeof prevRealTimeIntegrator === "string"
            ? prevRealTimeIntegrator
            : typeof integratorScheme === "string"
            ? integratorScheme
            : "crank";
        if (typeof applyIntegratorSelection === "function") {
          applyIntegratorSelection(schemeToRestore);
        }

        if (prevPsiRescaleModeOnImaginaryToggle !== null) {
          if (typeof applyPsiRescaleSelection === "function") {
            applyPsiRescaleSelection(prevPsiRescaleModeOnImaginaryToggle);
          }
          prevPsiRescaleModeOnImaginaryToggle = null;
        }
      }

      if (recordHistory && typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
      if (track && typeof trackToolUsage === "function") {
        trackToolUsage("general_properties", {
          property: "imaginary_time",
          value: nextImaginary,
        });
      }
    };

    // Initialize from global flag if available.
    if (typeof isImaginaryTime !== "undefined") {
      setImaginaryTimeEnabled(isImaginaryTime, {
        recordHistory: false,
        track: false,
      });
    }

    imaginaryToggle.addEventListener("change", () => {
      setImaginaryTimeEnabled(imaginaryToggle.checked, {
        recordHistory: true,
        track: true,
      });
    });
  }

  if (saveSetupButton && typeof exportCurrentSetup === "function") {
    saveSetupButton.addEventListener("click", () => {
      exportCurrentSetup();
      if (typeof trackToolUsage === "function") {
        trackToolUsage("experiment_setup_save_load", {
          action: "save",
          experiment_name: analyticsExperimentName,
        });
      }
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
      const wasPlaying =
        typeof isPlaying === "boolean" ? isPlaying : false;
      const fileLabel = (file.name || "Custom setup").replace(
        /\.(psi|json)$/i,
        ""
      );
      const fileType = isPsi ? "psi" : "json";

      if (typeof stopSimulationAnalytics === "function") {
        stopSimulationAnalytics("experiment_change");
      }

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

          if (typeof setAnalyticsExperiment === "function") {
            const source = isPsi ? "custom_psi" : "custom_json";
            setAnalyticsExperiment(fileLabel, source);
          }
          const playingAfterLoad =
            typeof isPlaying === "boolean" ? isPlaying : wasPlaying;
          if (playingAfterLoad && typeof startSimulationAnalytics === "function") {
            startSimulationAnalytics();
          }
          if (typeof trackToolUsage === "function") {
            trackToolUsage("experiment_setup_save_load", {
              action: "load_file",
              file_type: fileType,
              experiment_name: fileLabel,
            });
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
  const presetLoading = document.getElementById("preset-loading");

  const setPresetLoadingVisible = (visible) => {
    if (!presetLoading) return;
    if (visible) {
      presetLoading.classList.add("is-visible");
      presetLoading.setAttribute("aria-hidden", "false");
    } else {
      presetLoading.classList.remove("is-visible");
      presetLoading.setAttribute("aria-hidden", "true");
    }
  };

  if (presetSelect && typeof loadSetupFromPsiArrayBuffer === "function") {
    const renumberPresetOptions = () => {
      const opts = Array.from(presetSelect.options);
      let idx = 1;
      opts.forEach((opt) => {
        if (!opt.value) return;
        const baseLabel = opt.dataset.label || opt.textContent || "";
        opt.dataset.label = baseLabel.trim();
        opt.textContent = `${idx}. ${opt.dataset.label}`;
        opt.style.textAlign = "left";
        idx += 1;
      });
    };

    const getPresetParamFromURL = () => {
      if (typeof window === "undefined" || typeof window.location === "undefined") {
        return "";
      }
      try {
        const url = new URL(window.location.href);
        return url.searchParams.get("preset") || "";
      } catch (err) {
        console.error("[Schrödinger] Failed to parse preset from URL:", err);
        return "";
      }
    };

    const updatePresetQueryParam = (presetId) => {
      if (
        typeof window === "undefined" ||
        !window.history ||
        typeof window.location === "undefined"
      ) {
        return;
      }
      try {
        const url = new URL(window.location.href);
        if (presetId) {
          url.searchParams.set("preset", presetId);
        } else {
          url.searchParams.delete("preset");
        }
        window.history.replaceState(null, "", url.toString());
      } catch (err) {
        console.error("[Schrödinger] Failed to update preset URL:", err);
      }
    };

    const loadPresetByPath = async (
      url,
      { fromURL = false, label = "" } = {}
    ) => {
      if (!url) return;
      const experimentLabel = (() => {
        if (label && label.trim()) {
          return label.trim();
        }
        const filename = url.split("/").pop() || "";
        const base = filename.replace(/\.psi$/i, "");
        const cleaned = base.replace(/_/g, " ").trim();
        return cleaned || DEFAULT_EXPERIMENT_NAME;
      })();

      if (typeof stopSimulationAnalytics === "function") {
        stopSimulationAnalytics("experiment_change");
      }

      try {
        setPresetLoadingVisible(true);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} while fetching ${url}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        await loadSetupFromPsiArrayBuffer(arrayBuffer);
        const playingAfterLoad =
          typeof isPlaying === "boolean" ? isPlaying : false;

        if (typeof setAnalyticsExperiment === "function") {
          setAnalyticsExperiment(experimentLabel, "preset");
        }
        if (typeof trackToolUsage === "function") {
          trackToolUsage("experiment_setup_save_load", {
            action: fromURL ? "load_preset_auto" : "load_preset",
            experiment_name: experimentLabel,
          });
        }
        if (playingAfterLoad && typeof startSimulationAnalytics === "function") {
          startSimulationAnalytics();
        }

        // When loaded via user interaction, clear the selection so the
        // label stays as "Preset Experiments" and nothing remains selected.
        if (!fromURL) {
          presetSelect.value = "";
          const dropdownApi = enhancedDropdowns.get(presetSelect);
          if (dropdownApi && typeof dropdownApi.updateDisplay === "function") {
            dropdownApi.updateDisplay();
          }
        }
      } catch (err) {
        console.error("[Schrödinger] Failed to load preset setup:", err);
      } finally {
        setPresetLoadingVisible(false);
      }
    };

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
          opt.dataset.filename = preset.path.split("/").pop() || "";
          presetSelect.appendChild(opt);
        });

        renumberPresetOptions();

        // If the URL encodes a preset choice (e.g. ?preset=Double-slit.psi
        // or ?preset=Double-slit), automatically load the matching preset
        // once the list is available.
        const presetParam = getPresetParamFromURL();
        if (presetParam) {
          const match = presets.find((preset) => {
            const filename = preset.path.split("/").pop() || "";
            const base = filename.replace(/\.psi$/i, "");
            return presetParam === filename || presetParam === base;
          });
          if (match) {
            loadPresetByPath(match.path, {
              fromURL: true,
              label: match.label,
            });
          }
        }
      } catch (err) {
        console.error("[Schrödinger] Failed to load preset list:", err);
      }
    };

    loadPresetList();

    presetSelect.addEventListener("change", async () => {
      const url = presetSelect.value;
      if (!url) return;

      const selectedOption =
        presetSelect.selectedOptions && presetSelect.selectedOptions[0];
      const presetLabel = selectedOption
        ? selectedOption.dataset.label || selectedOption.textContent || ""
        : "";
      const filename = url.split("/").pop() || "";
      if (filename) {
        updatePresetQueryParam(filename);
      }

      await loadPresetByPath(url, { fromURL: false, label: presetLabel });
    });

    enhanceDropdown(presetSelect, { staticLabel: "Preset Experiments" });
  }

  const colormapSelect = document.getElementById("colormap-select");
  if (colormapSelect) {
    enhanceDropdown(colormapSelect, { align: "left" });

    const applyColormapFromSelect = () => {
      const schemeId = colormapSelect.value || "phase";
      if (
        typeof activeColorSchemeId !== "undefined" &&
        typeof COMPLEX_COLOR_SCHEMES === "object" &&
        COMPLEX_COLOR_SCHEMES !== null
      ) {
        if (COMPLEX_COLOR_SCHEMES[schemeId]) {
          activeColorSchemeId = schemeId;
        } else {
          activeColorSchemeId = "phase";
        }
      }
      if (typeof drawScene === "function") {
        drawScene();
      }
    };

    colormapSelect.addEventListener("change", applyColormapFromSelect);
    applyColormapFromSelect();
  }

  const playPauseButton = document.getElementById("play-pause");
  if (playPauseButton) {
    const playPauseIcon =
      playPauseButton.querySelector(".transport-icon") || playPauseButton;

    playPauseButton.addEventListener("click", () => {
      const nextPlaying = !isPlaying;
      isPlaying = nextPlaying;
      playPauseIcon.textContent = isPlaying ? "⏸" : "▶";
      updateEigenGoButtonDisabled();
      if (saveSetupButton) {
        saveSetupButton.disabled = isPlaying;
      }
      if (isPlaying) {
        if (initialPsiDirty) {
          resetWavefunctionFromControls();
        }
        console.log("[Schrödinger] Simulation started");
        if (typeof markSimulationStarted === "function") {
          markSimulationStarted();
        } else {
          creationToolsVisible = false;
        }

        if (typeof startSimulationAnalytics === "function") {
          startSimulationAnalytics();
        }
        if (
          typeof isGaussianWavefunctionTabActive === "function" &&
          isGaussianWavefunctionTabActive() &&
          typeof getControlsState === "function" &&
          typeof trackToolUsage === "function"
        ) {
          const state = getControlsState();
          trackToolUsage("gaussian_packet", {
            action: "play",
            px: Number(((state && state.px) || 0).toFixed(3)),
            py: Number(((state && state.py) || 0).toFixed(3)),
            sigma_x: Number(((state && state.sigmaX) || 0).toFixed(3)),
            sigma_p: Number(((state && state.sigmaP) || 0).toFixed(3)),
          });
        }

        // Resume recording if enabled.
        if (isRecording) {
          startCanvasRecorderIfNeeded();
          resumeCanvasRecorder();
        }
      } else {
        if (typeof stopSimulationAnalytics === "function") {
          stopSimulationAnalytics("pause");
        }
        console.log("[Schrödinger] Simulation paused at t =", simTime.toFixed(3));
        // Pausing does not automatically bring back creation tools
        if (isRecording) {
          pauseCanvasRecorder();
        }
      }

      updateRecordBlink();
      updateParticleOverlay();
      if (!isPlaying && typeof syncCreationToolsVisibility === "function") {
        syncCreationToolsVisibility();
      }
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

  const phaseCircleToggle = document.getElementById("toggle-phase-circle");
  if (phaseCircleToggle) {
    phaseCircleToggle.checked = false;
    phaseCircleToggle.addEventListener("change", () => {
      if (typeof showPhaseCircle !== "undefined") {
        showPhaseCircle = !!phaseCircleToggle.checked;
      }
      drawScene();
    });
  }

  const resetButton = document.getElementById("reset-packet");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (!canvas) return;
      if (typeof stopSimulationAnalytics === "function") {
        stopSimulationAnalytics("reset");
      }
      // Reset wavefunction, pause simulation, and re-enable creation tools
      isPlaying = false;
      updateEigenGoButtonDisabled();
      simTime = 0;
      frameCount = 0;
      if (typeof markSimulationStopped === "function") {
        markSimulationStopped();
      } else if (typeof creationToolsVisible !== "undefined") {
        const gaussianTab = document.querySelector(
          '.wf-tab[data-tab="gaussian"]'
        );
        creationToolsVisible =
          !gaussianTab || gaussianTab.classList.contains("is-active");
      }
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
      if (typeof syncCreationToolsVisibility === "function") {
        syncCreationToolsVisibility();
      }

       // Finalize and download the recording if one is in progress.
       if (isRecording) {
         stopCanvasRecorderAndPromptDownload();
         isRecording = false;
         const recordButton = document.getElementById("record-toggle");
         if (recordButton) {
           recordButton.classList.remove("recording");
           recordButton.setAttribute("aria-pressed", "false");
         }
         if (typeof trackToolUsage === "function") {
           trackToolUsage("recording", {
             action: "stop_auto",
             reason: "reset",
           });
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
  const bucketToleranceSlider = document.getElementById("bucket-tolerance");
  const bucketToleranceEdit = document.getElementById("bucket-tolerance-edit");
  const bucketToleranceToggle = document.querySelector(
    '[data-slider-toggle="bucket-tolerance"]'
  );
  const bucketTolerancePopup = document.querySelector(
    '.slider-popup[data-for="bucket-tolerance"]'
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
  let applyVMaxGlobal = null;
  let syncVMaxInputsGlobal = null;

  function getPhysicalPotentialMax() {
    const scale =
      typeof POTENTIAL_SCALE === "number" && Number.isFinite(POTENTIAL_SCALE)
        ? POTENTIAL_SCALE
        : 1;
    if (!potentialField || !potentialField.length) return 0;
    let maxVal = 0;
    const n = potentialField.length;
    for (let i = 0; i < n; i++) {
      const v = potentialField[i];
      if (!Number.isFinite(v)) continue;
      const physical = v * scale;
      if (physical > maxVal) maxVal = physical;
    }
    return maxVal;
  }

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

  if (bucketToleranceSlider) {
    const applyToleranceFromSlider = () => {
      let v = parseFloat(bucketToleranceSlider.value);
      if (!Number.isFinite(v)) v = bucketTolerance;
      v = Math.max(0, Math.min(1, v));
      bucketTolerance = v;
      bucketToleranceSlider.value = String(v);
      if (
        bucketToleranceEdit &&
        document.activeElement !== bucketToleranceEdit
      ) {
        bucketToleranceEdit.value = v.toFixed(2);
      }
    };

    bucketToleranceSlider.addEventListener("input", applyToleranceFromSlider);
    bucketToleranceSlider.value = String(
      Number.isFinite(bucketTolerance) ? bucketTolerance : bucketToleranceSlider.value || 0.1
    );
    applyToleranceFromSlider();

    if (bucketToleranceEdit) {
      bucketToleranceEdit.value = Number.isFinite(bucketTolerance)
        ? bucketTolerance.toFixed(2)
        : (bucketToleranceSlider.value || "0.10");
      const commitBucketToleranceEdit = () => {
        let v = parseFloat(bucketToleranceEdit.value);
        if (!Number.isFinite(v)) {
          v = Number.isFinite(bucketTolerance) ? bucketTolerance : 0.1;
        }
        v = Math.max(0, Math.min(1, v));
        bucketToleranceSlider.value = String(v);
        applyToleranceFromSlider();
      };
      bucketToleranceEdit.addEventListener("change", commitBucketToleranceEdit);
      bucketToleranceEdit.addEventListener("blur", commitBucketToleranceEdit);
      bucketToleranceEdit.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitBucketToleranceEdit();
          bucketToleranceEdit.blur();
        }
      });
    }

    if (bucketToleranceToggle && bucketTolerancePopup) {
      bucketToleranceToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const control = bucketTolerancePopup.closest(".top-control");
        if (!control) return;
        const alreadyOpen = control.classList.contains("slider-open");
        closeAllSliderPopups();
        if (!alreadyOpen) {
          control.classList.add("slider-open");
          bucketToleranceToggle.setAttribute("aria-expanded", "true");
          bucketToleranceSlider.focus({ preventScroll: true });
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

    const syncVMaxInputs = (value) => {
      const physicalMax = getPhysicalPotentialMax();
      const defaultMax = Math.max(physicalMax * 2 || 0, POTENTIAL_SCALE || 1, 1);
      if (vMaxEdit) {
        vMaxEdit.min = String(vMaxMin);
        vMaxEdit.max = "";
        if (!vMaxEdit.step) {
          vMaxEdit.step = "0.01";
        }
        if (document.activeElement !== vMaxEdit) {
          vMaxEdit.value = Number.isFinite(value) ? value.toFixed(2) : "";
        }
      }
      if (vMaxSlider) {
        vMaxSlider.min = String(vMaxMin);
        vMaxSlider.max = String(defaultMax);
        if (!vMaxSlider.step) {
          vMaxSlider.step = "0.01";
        }
        if (Number.isFinite(physicalMax) && physicalMax > 0 && physicalMax * 1.2 > defaultMax) {
          vMaxSlider.max = String(physicalMax * 1.2);
        }
        if (document.activeElement !== vMaxSlider) {
          vMaxSlider.value = Number.isFinite(value)
            ? String(value)
            : String(physicalMax || 0);
        }
      }
    };

    const applyVMax = (nextV, { rescale = true, recordHistory = true } = {}) => {
      if (!Number.isFinite(nextV)) {
        nextV = getPhysicalPotentialMax();
      }
      nextV = Math.max(vMaxMin, nextV || 0);

      const physicalMax = getPhysicalPotentialMax();
      const hasField =
        potentialField && potentialWidth > 0 && potentialHeight > 0;

      if (rescale && hasField && Number.isFinite(physicalMax) && physicalMax > 0) {
        const factor = nextV / physicalMax;
        const n = potentialField.length;
        for (let i = 0; i < n; i++) {
          const val = potentialField[i] || 0;
          potentialField[i] = Number.isFinite(val) ? val * factor : 0;
        }
        redrawPotential();
        if (recordHistory && typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (typeof drawScene === "function") {
          drawScene();
        }
      }

      currentVMax = nextV;
      syncVMaxInputs(currentVMax);
    };

    const initialV = (() => {
      const physicalMax = getPhysicalPotentialMax();
      if (Number.isFinite(physicalMax) && physicalMax > 0) return physicalMax;
      if (Number.isFinite(currentVMax) && currentVMax > 0) return currentVMax;
      return POTENTIAL_SCALE > 0 ? POTENTIAL_SCALE : 1;
    })();
    applyVMax(initialV, { rescale: false, recordHistory: false });

    if (vMaxEdit) {
      const commitVMaxEdit = () => {
        const v = parseFloat(vMaxEdit.value);
        applyVMax(v, { rescale: true, recordHistory: true });
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
        applyVMax(v, { rescale: true, recordHistory: true });
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

    applyVMaxGlobal = applyVMax;
    syncVMaxInputsGlobal = syncVMaxInputs;
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
      const physicalMax =
        Number.isFinite(currentVMax) && currentVMax >= 0
          ? currentVMax
          : getPhysicalPotentialMax();
      const vMax = Math.max(0, physicalMax);
      const scale =
        typeof POTENTIAL_SCALE === "number" && Number.isFinite(POTENTIAL_SCALE)
          ? POTENTIAL_SCALE
          : 1;
      const n = potentialField.length;
      for (let i = 0; i < n; i++) {
        const val = potentialField[i] || 0;
        const physicalVal = val * scale;
        const nextPhysical = Math.max(0, vMax - physicalVal);
        const next = scale !== 0 ? nextPhysical / scale : 0;
        potentialField[i] = next;
      }
      currentVMax = vMax;
      redrawPotential();
      if (typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
      if (typeof drawScene === "function") {
        drawScene();
      }
      if (typeof syncVMaxInputsGlobal === "function") {
        syncVMaxInputsGlobal(currentVMax);
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
  const bucketSettingControls = document.querySelectorAll(
    ".top-control.bucket-setting"
  );
  const moveSettingControls = document.querySelectorAll(
    ".top-control.move-setting"
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

      // Bucket controls only when Bucket tool is active
      bucketSettingControls.forEach((el) => {
        setControlAndSeparatorVisibility(el, isBucket);
      });

      // Move-specific controls
      moveSettingControls.forEach((el) => {
        const showForMove = isMove;
        const alsoUpload = el.classList.contains("upload-setting") && isUpload;
        setControlAndSeparatorVisibility(el, showForMove || alsoUpload);
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

    const applyToolSelection = (
      tool,
      sourceButton = null,
      { trackEvent = true } = {}
    ) => {
      if (!tool || tool === "clear") {
        return false;
      }

      const buttonsArray = Array.from(toolButtons);
      const targetButton =
        sourceButton ||
        buttonsArray.find((btn) => btn.dataset.tool === tool);
      if (!targetButton) {
        return false;
      }

      currentTool = tool;
      buttonsArray.forEach((b) => {
        b.classList.toggle("active", b === targetButton);
      });
      updateTopControlsVisibility();

      if (typeof hideBrushPreview === "function") {
        hideBrushPreview();
      }

      if (trackEvent && typeof trackToolUsage === "function") {
        const category =
          tool === "upload"
            ? "potential_image_upload"
            : tool === "function"
            ? "potential_equation_editor"
            : "potential_editor_drawing";
        trackToolUsage(category, { action: "select_tool", tool });
      }

      return true;
    };

    window.setActiveTool = (tool, options = {}) =>
      applyToolSelection(tool, null, options);

    toolButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        const tool = button.dataset.tool;
        if (!tool) return;
        const trackEvent = !event || event.isTrusted !== false;

        // "Clear" acts immediately and does not change the active drawing tool
        if (tool === "clear") {
          clearPotential();
          redrawPotential();
          if (typeof drawScene === "function") {
            drawScene();
          }
          console.log("[Schrödinger] Potential cleared");
          updateTopControlsVisibility();
          if (trackEvent && typeof trackToolUsage === "function") {
            trackToolUsage("potential_editor_drawing", {
              action: "clear_potential",
            });
          }
          return;
        }

        applyToolSelection(tool, button, { trackEvent });
      });
    });

    // Default to brush tool on load
    const initialTool = "brush";
    const initialButton = Array.from(toolButtons).find(
      (btn) => btn.dataset.tool === initialTool
    );
    const didSetInitialTool =
      initialButton &&
      applyToolSelection(initialTool, initialButton, { trackEvent: false });

    // Initialize visibility based on default tool
    if (!didSetInitialTool) {
      updateTopControlsVisibility();
    }
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
      return mode;
    };

    boundaryRadios.forEach((input) => {
      input.addEventListener("change", (event) => {
        const mode = applyBoundaryFromRadios();
        if (event.isTrusted && typeof savePotentialHistory === "function") {
          savePotentialHistory();
        }
        if (event.isTrusted && typeof trackToolUsage === "function") {
          trackToolUsage("general_properties", {
            property: "boundary_mode",
            value: mode,
          });
        }
      });
    });

    applyBoundaryFromRadios();
  }

  const readGeneralPropertiesState = () => {
    const boundarySelection =
      boundaryRadios.find((input) => input.checked) || null;
    const boundaryValue =
      boundarySelection && boundarySelection.value === "closed"
        ? "closed"
        : "open";

    const rescaleValue =
      typeof psiRescaleMode === "string"
        ? psiRescaleMode
        : rescaleNormInput && rescaleNormInput.checked
        ? "norm"
        : rescaleMaxInput && rescaleMaxInput.checked
        ? "max"
        : "none";

    const colormapValue =
      (colormapSelect && colormapSelect.value) ||
      (typeof activeColorSchemeId === "string"
        ? activeColorSchemeId
        : "phase");

    return {
      latticeWidth:
        typeof currentResolutionWidth === "number"
          ? currentResolutionWidth
          : parseInt(
              latticeWidthInput && latticeWidthInput.value,
              10
            ) || TARGET_RESOLUTION_WIDTH,
      latticeHeight:
        typeof currentResolutionHeight === "number"
          ? currentResolutionHeight
          : parseInt(
              latticeHeightInput && latticeHeightInput.value,
              10
            ) || TARGET_RESOLUTION_HEIGHT,
      timeStep:
        typeof currentTimeStep === "number"
          ? currentTimeStep
          : parseFloat(timeStepInput && timeStepInput.value) || TIME_STEP,
      imaginaryTime:
        typeof isImaginaryTime === "boolean"
          ? isImaginaryTime
          : !!(imaginaryToggle && imaginaryToggle.checked),
      integrator:
        typeof integratorScheme === "string"
          ? integratorScheme
          : integratorEulerInput && integratorEulerInput.checked
          ? "euler"
          : "crank",
      rescaleMode: rescaleValue,
      boundaryMode: boundaryValue,
      overlays: {
        colorbar:
          typeof showColorbar !== "undefined"
            ? !!showColorbar
            : !!(colorbarToggle && colorbarToggle.checked),
        energy:
          typeof showEnergy !== "undefined"
            ? !!showEnergy
            : !!(energyToggle && energyToggle.checked),
        phaseCircle:
          typeof showPhaseCircle !== "undefined"
            ? !!showPhaseCircle
            : !!(phaseCircleToggle && phaseCircleToggle.checked),
      },
      colormap: colormapValue,
    };
  };

  const applyGeneralPropertiesDefaults = () => {
    if (!generalPropertiesDefaults) return false;

    const state = generalPropertiesDefaults;
    const latticeChanged = updateLatticeResolution(
      state.latticeWidth,
      state.latticeHeight
    );

    if (typeof setTimeStepValue === "function") {
      setTimeStepValue(state.timeStep, {
        recordHistory: false,
        track: false,
      });
    } else if (Number.isFinite(state.timeStep)) {
      currentTimeStep = Math.max(0.001, Math.min(1, state.timeStep));
      if (timeStepInput) {
        timeStepInput.value = String(currentTimeStep);
      }
    }

    if (typeof setImaginaryTimeEnabled === "function") {
      setImaginaryTimeEnabled(state.imaginaryTime, {
        recordHistory: false,
        track: false,
      });
    } else if (typeof isImaginaryTime !== "undefined") {
      isImaginaryTime = !!state.imaginaryTime;
      if (imaginaryToggle) {
        imaginaryToggle.checked = !!state.imaginaryTime;
      }
    }

    if (typeof applyIntegratorSelection === "function") {
      applyIntegratorSelection(state.integrator);
    }

    if (typeof applyPsiRescaleSelection === "function") {
      applyPsiRescaleSelection(state.rescaleMode);
    }

    if (state.boundaryMode && boundaryRadios.length) {
      boundaryRadios.forEach((input) => {
        input.checked = input.value === state.boundaryMode;
      });
      if (typeof boundaryMode !== "undefined") {
        boundaryMode =
          state.boundaryMode === "closed" ? "closed" : "open";
      }
    }

    let redrawNeeded = !latticeChanged;

    if (state.overlays) {
      if (
        typeof showColorbar !== "undefined" &&
        typeof state.overlays.colorbar === "boolean"
      ) {
        showColorbar = state.overlays.colorbar;
      }
      if (
        typeof showEnergy !== "undefined" &&
        typeof state.overlays.energy === "boolean"
      ) {
        showEnergy = state.overlays.energy;
      }
      if (
        typeof showPhaseCircle !== "undefined" &&
        typeof state.overlays.phaseCircle === "boolean"
      ) {
        showPhaseCircle = state.overlays.phaseCircle;
      }

      if (colorbarToggle) {
        colorbarToggle.checked = !!state.overlays.colorbar;
      }
      if (energyToggle) {
        energyToggle.checked = !!state.overlays.energy;
      }
      if (phaseCircleToggle) {
        phaseCircleToggle.checked = !!state.overlays.phaseCircle;
      }
      redrawNeeded = true;
    }

    if (state.colormap) {
      if (colormapSelect) {
        colormapSelect.value = state.colormap;
        colormapSelect.dispatchEvent(
          new Event("change", { bubbles: true })
        );
        const dropdownApi = enhancedDropdowns.get(colormapSelect);
        if (
          dropdownApi &&
          typeof dropdownApi.updateDisplay === "function"
        ) {
          dropdownApi.updateDisplay();
        }
      } else if (
        typeof activeColorSchemeId !== "undefined" &&
        typeof COMPLEX_COLOR_SCHEMES === "object" &&
        COMPLEX_COLOR_SCHEMES !== null &&
        COMPLEX_COLOR_SCHEMES[state.colormap]
      ) {
        activeColorSchemeId = state.colormap;
        redrawNeeded = true;
      }
    }

    if (redrawNeeded && typeof drawScene === "function") {
      drawScene();
    }
    if (!latticeChanged && typeof updateParticleOverlay === "function") {
      updateParticleOverlay();
    }

    return true;
  };

  const captureGeneralPropertiesDefaults = () => {
    generalPropertiesDefaults = readGeneralPropertiesState();
  };

  const generalResetButton = document.getElementById("general-reset");
  if (generalResetButton) {
    generalResetButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const applied = applyGeneralPropertiesDefaults();
      if (applied && typeof savePotentialHistory === "function") {
        savePotentialHistory();
      }
    });
  }

  window.captureGeneralPropertiesDefaults = captureGeneralPropertiesDefaults;
  captureGeneralPropertiesDefaults();

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

function setupPanelResizer() {
  if (typeof document === "undefined") return;

  const resizer = document.getElementById("panel-resizer");
  const toggleButton = document.getElementById("panel-toggle");
  const panel = document.getElementById("particle-controls");
  const canvasContainer = document.querySelector(".canvas-container");
  const shell = document.querySelector(".canvas-shell");

  if (!resizer || !panel || !canvasContainer || !shell) return;

  const potentialEditor = document.querySelector(".potential-editor");

  const isNarrowLayout = () =>
    typeof window !== "undefined" && window.innerWidth <= 800;

  const MIN_PANEL_WIDTH = 260;
  const MAX_PANEL_WIDTH = 640;
  const MIN_CANVAS_WIDTH = 320;

  let isCollapsed = false;
  let lastExpandedWidth = panel.getBoundingClientRect().width || MIN_PANEL_WIDTH;

  const applyCollapsedState = () => {
    const narrow = isNarrowLayout();

    if (isCollapsed) {
      panel.classList.add("particle-controls-collapsed");
      panel.style.width = "0px";
      panel.style.paddingLeft = "0";
      panel.style.paddingRight = "0";
      if (toggleButton) {
        toggleButton.setAttribute(
          "aria-label",
          "Expand experiment setup panel"
        );
        toggleButton.setAttribute("aria-expanded", "false");
        toggleButton.textContent = "◀";
      }
    } else {
      panel.classList.remove("particle-controls-collapsed");
      if (narrow) {
        // On narrow layouts, let CSS control width (100% in stacked layout).
        panel.style.width = "";
      } else {
        panel.style.width = `${lastExpandedWidth}px`;
      }
      panel.style.paddingLeft = "";
      panel.style.paddingRight = "";
      if (toggleButton) {
        toggleButton.setAttribute(
          "aria-label",
          "Collapse experiment setup panel"
        );
        toggleButton.setAttribute("aria-expanded", "true");
        toggleButton.textContent = "▶";
      }
    }

    if (typeof resizeCanvas === "function") {
      resizeCanvas();
    }
  };

  applyCollapsedState();

  const handleWindowResizeForPanel = () => {
    applyCollapsedState();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleWindowResizeForPanel);
  }

  if (toggleButton) {
    toggleButton.addEventListener("click", () => {
      isCollapsed = !isCollapsed;
      applyCollapsedState();
    });
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("is-resizing-panel");
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (event) => {
    if (!dragging || !shell) return;

    // Disable interactive horizontal resizing on narrow stacked layouts.
    if (isNarrowLayout()) return;

    const shellRect = shell.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const potentialRect = potentialEditor
      ? potentialEditor.getBoundingClientRect()
      : { width: 0 };

    const deltaX = startX - event.clientX;
    let nextWidth = startWidth + deltaX;

    nextWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, nextWidth));

    const availableWidth =
      shellRect.width - potentialRect.width - resizer.offsetWidth;
    const maxPanelFromCanvas = availableWidth - MIN_CANVAS_WIDTH;
    if (Number.isFinite(maxPanelFromCanvas) && maxPanelFromCanvas > 0) {
      nextWidth = Math.min(nextWidth, maxPanelFromCanvas);
    }

    lastExpandedWidth = nextWidth;
    isCollapsed = false;
    panel.classList.remove("particle-controls-collapsed");
    panel.style.width = `${nextWidth}px`;
    panel.style.paddingLeft = "";
    panel.style.paddingRight = "";

    if (typeof resizeCanvas === "function") {
      resizeCanvas();
    }
  };

  const handleMouseUp = () => {
    stopDrag();
  };

  resizer.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (isNarrowLayout()) return;
    if (!panel) return;

    dragging = true;
    startX = event.clientX;
    const rect = panel.getBoundingClientRect();
    startWidth = rect.width || lastExpandedWidth || MIN_PANEL_WIDTH;
    document.body.classList.add("is-resizing-panel");

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  });
}

function getFullscreenTargetElement() {
  if (typeof document === "undefined") return null;
  const shell = document.querySelector(".canvas-shell");
  if (shell && typeof shell.requestFullscreen === "function") {
    return shell;
  }
  const container = document.querySelector(".canvas-container");
  if (container && typeof container.requestFullscreen === "function") {
    return container;
  }
  return document.documentElement || null;
}

function isFullscreenActive() {
  if (typeof document === "undefined") return false;
  return !!document.fullscreenElement;
}

function updateFullscreenButtonVisualState() {
  const button = document.getElementById("fullscreen-toggle");
  if (!button) return;
  const icon = button.querySelector(".fullscreen-icon");
  const active = isFullscreenActive();

  button.classList.toggle("fullscreen-button-active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.setAttribute(
    "aria-label",
    active ? "Exit fullscreen" : "Enter fullscreen"
  );
  button.setAttribute(
    "data-tooltip",
    active ? "Exit fullscreen" : "Enter fullscreen"
  );

  if (icon && icon.tagName === "IMG") {
    icon.src = active
      ? "icons/fullscreen-exit.png"
      : "icons/fullscreen.png";
  }
}

async function enterFullscreen() {
  if (typeof document === "undefined") return;
  const target = getFullscreenTargetElement();
  if (!target || typeof target.requestFullscreen !== "function") return;

  try {
    if (
      document.fullscreenElement &&
      document.fullscreenElement !== target &&
      typeof document.exitFullscreen === "function"
    ) {
      await document.exitFullscreen();
    }
    await target.requestFullscreen();
  } catch (err) {
    console.warn("[Schrödinger] Failed to enter fullscreen:", err);
  }
}

async function exitFullscreen() {
  if (typeof document === "undefined") return;
  if (
    !document.fullscreenElement ||
    typeof document.exitFullscreen !== "function"
  ) {
    return;
  }
  try {
    await document.exitFullscreen();
  } catch (err) {
    console.warn("[Schrödinger] Failed to exit fullscreen:", err);
  }
}

async function toggleFullscreen() {
  if (isFullscreenActive()) {
    await exitFullscreen();
  } else {
    await enterFullscreen();
  }
  if (typeof updateFullscreenButtonVisualState === "function") {
    updateFullscreenButtonVisualState();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initApp();
  setupPanelResizer();
  setupHoverTooltips();
  if (typeof syncCreationToolsVisibility === "function") {
    syncCreationToolsVisibility();
  }

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

document.addEventListener("fullscreenchange", () => {
  if (typeof updateFullscreenButtonVisualState === "function") {
    updateFullscreenButtonVisualState();
  }
});

// Global keyboard shortcuts.
document.addEventListener("keydown", (event) => {
  // Toggle play/pause with the spacebar when appropriate.
  const isSpace =
    event.code === "Space" || event.key === " " || event.key === "Spacebar";
  if (!isSpace) return;

  // Ignore if focus is inside an editable control.
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable)
  ) {
    return;
  }

  const playPauseButton = document.getElementById("play-pause");
  if (!playPauseButton || playPauseButton.disabled) return;

  event.preventDefault();
  playPauseButton.click();
});
