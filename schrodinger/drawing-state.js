// Shared drawing state for the potential editor and particle overlay.

let potentialCanvas;
let potentialCtx;

let brushPreview = null;
let eyedropperOverlay = null;

let isEyedropperSampling = false;

let creationToolsVisible = true;
// True when the simulation has never been started or was explicitly reset/stopped.
let simulationStopped = true;

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
let bucketTolerance = BUCKET_TOLERANCE;

function updateCurrentVMaxFromField() {
  if (!potentialField || !potentialField.length) return;
  const scale =
    typeof POTENTIAL_SCALE === "number" && Number.isFinite(POTENTIAL_SCALE)
      ? POTENTIAL_SCALE
      : 1;
  let maxVal = 0;
  const n = potentialField.length;
  for (let i = 0; i < n; i++) {
    const v = potentialField[i];
    if (!Number.isFinite(v)) continue;
    const physical = v * scale;
    if (physical > maxVal) maxVal = physical;
  }
  currentVMax = maxVal;

  if (typeof syncVMaxInputsGlobal === "function") {
    syncVMaxInputsGlobal(currentVMax);
  } else if (typeof document !== "undefined") {
    const vMaxEdit = document.getElementById("v-max-edit");
    const vMaxSlider = document.getElementById("v-max-slider");
    if (vMaxEdit && document.activeElement !== vMaxEdit) {
      vMaxEdit.value = currentVMax.toFixed(2);
    }
    if (vMaxSlider && document.activeElement !== vMaxSlider) {
      vMaxSlider.value = String(currentVMax);
    }
  }
}

function isGaussianWavefunctionTabActive() {
  if (typeof document === "undefined") return true;
  const gaussianTab = document.querySelector('.wf-tab[data-tab="gaussian"]');
  if (!gaussianTab) return true;
  return gaussianTab.classList.contains("is-active");
}

function computeCreationToolsVisibility() {
  const gaussianTabActive = isGaussianWavefunctionTabActive();
  const playing = typeof isPlaying !== "undefined" ? isPlaying : false;
  const stopped =
    typeof simulationStopped !== "undefined" ? simulationStopped : !playing;
  return gaussianTabActive && stopped && !playing;
}

function syncCreationToolsVisibility() {
  if (typeof creationToolsVisible !== "undefined") {
    creationToolsVisible = computeCreationToolsVisibility();
  }
  if (typeof updateParticleOverlay === "function") {
    updateParticleOverlay();
  }
}

function markSimulationStarted() {
  simulationStopped = false;
  syncCreationToolsVisibility();
}

function markSimulationStopped() {
  simulationStopped = true;
  syncCreationToolsVisibility();
}

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
