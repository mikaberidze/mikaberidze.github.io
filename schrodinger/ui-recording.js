// Recording helpers, combined canvas compositing, Picture-in-Picture, and MathJax typesetting.

let isRecording = false;

// Offscreen canvas and MediaRecorder state used when recording is enabled.
let combinedCanvas = null;
let combinedCtx = null;
let recordingMediaRecorder = null;
let recordingChunks = [];
let recordingMimeType = "";
let recordingStream = null;

// Picture-in-Picture elements and state.
let pipVideoElement = null;
let pipStream = null;

const RECORDING_FPS = 30;

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

function typesetMathInElement(element) {
  if (!element || typeof window === "undefined") return;
  const mathJax = window.MathJax;
  if (!mathJax) {
    if (!element._mjPending) {
      element._mjPending = true;
      window.setTimeout(() => {
        element._mjPending = false;
        typesetMathInElement(element);
      }, 500);
    }
    return;
  }

  try {
    if (typeof mathJax.typesetPromise === "function") {
      mathJax.typesetPromise([element]).catch(() => {});
    } else if (typeof mathJax.typeset === "function") {
      mathJax.typeset([element]);
    }
  } catch (err) {
    // Fail silently; math rendering is cosmetic.
  }
}

function updateCombinedCanvas(includeWatermark) {
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

  const shouldWatermark =
    typeof includeWatermark === "undefined" ? true : !!includeWatermark;

  if (!shouldWatermark) {
    return;
  }

  // Signature only in exported video (recordings), not in live PiP.
  const watermarkText = "mikaberidze.github.io/schrodinger";
  const overlayScale = 1.5; // enlarge watermark in exports
  const margin = 10 * overlayScale;

  combinedCtx.save();
  combinedCtx.font = `${18 * overlayScale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  combinedCtx.textAlign = "right";
  combinedCtx.textBaseline = "bottom";
  const x = width - margin;
  const y = height - margin;

  // Thin black outline plus accent fill for the website watermark in downloads,
  // matching the overlay text styling (scaled with overlay supersampling).
  const strokeWidth = 3 * overlayScale;
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

function isPictureInPictureSupported() {
  if (typeof document === "undefined") return false;
  try {
    const enabled =
      "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
    const hasRequest =
      typeof HTMLVideoElement !== "undefined" &&
      HTMLVideoElement.prototype &&
      typeof HTMLVideoElement.prototype.requestPictureInPicture === "function";
    return !!(enabled && hasRequest);
  } catch {
    return false;
  }
}

function updatePipButtonVisualState(isActive) {
  const pipButton = document.getElementById("pip-toggle");
  if (!pipButton) return;
  const active = !!isActive;
  pipButton.classList.toggle("pip-button-active", active);
  pipButton.setAttribute("aria-pressed", active ? "true" : "false");
}

function ensurePipVideoElement() {
  if (!ensureCombinedCanvas()) {
    return false;
  }

  if (!pipVideoElement) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.setAttribute("aria-hidden", "true");
    video.style.position = "fixed";
    video.style.right = "0";
    video.style.bottom = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.zIndex = "-1";

    video.addEventListener("enterpictureinpicture", () => {
      updatePipButtonVisualState(true);
    });

    video.addEventListener("leavepictureinpicture", () => {
      updatePipButtonVisualState(false);
      if (pipStream && typeof pipStream.getTracks === "function") {
        pipStream.getTracks().forEach((track) => track.stop());
      }
      pipStream = null;
    });

    document.body.appendChild(video);
    pipVideoElement = video;
  }

  if (!pipStream) {
    pipStream = combinedCanvas.captureStream(RECORDING_FPS);
    if (!pipStream) {
      console.warn(
        "[Schrödinger] Unable to capture canvas stream for Picture-in-Picture"
      );
      return false;
    }
    pipVideoElement.srcObject = pipStream;
  }

  // Start playback so external PiP triggers (e.g. browser extension)
  // always see a live video element streaming the combined canvas.
  try {
    const playPromise = pipVideoElement.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch {
    // Ignore autoplay errors; PiP can still be requested explicitly.
  }

  return true;
}

async function enterPictureInPicture() {
  if (!isPictureInPictureSupported()) {
    console.warn("[Schrödinger] Picture-in-Picture is not supported");
    updatePipButtonVisualState(false);
    return;
  }

  if (!ensurePipVideoElement()) {
    console.warn(
      "[Schrödinger] Unable to initialize combined canvas for Picture-in-Picture"
    );
    updatePipButtonVisualState(false);
    return;
  }

  // Ensure the first PiP frame reflects the latest canvases without watermark.
  updateCombinedCanvas(false);

  try {

    // If another element is already in PiP, exit it first.
    if (
      typeof document.pictureInPictureElement !== "undefined" &&
      document.pictureInPictureElement &&
      document.pictureInPictureElement !== pipVideoElement
    ) {
      try {
        await document.exitPictureInPicture();
      } catch (err) {
        console.warn(
          "[Schrödinger] Failed to exit existing Picture-in-Picture element:",
          err
        );
      }
    }

    await pipVideoElement.requestPictureInPicture();
    updatePipButtonVisualState(true);
  } catch (err) {
    console.error("[Schrödinger] Failed to enter Picture-in-Picture:", err);
    updatePipButtonVisualState(false);
  }
}

async function exitPictureInPicture() {
  if (typeof document === "undefined") {
    updatePipButtonVisualState(false);
    return;
  }

  const isCurrentElement =
    document.pictureInPictureElement &&
    pipVideoElement &&
    document.pictureInPictureElement === pipVideoElement;

  try {
    if (isCurrentElement && typeof document.exitPictureInPicture === "function") {
      await document.exitPictureInPicture();
    }
  } catch (err) {
    console.warn("[Schrödinger] Failed to exit Picture-in-Picture:", err);
  }

  if (pipStream && typeof pipStream.getTracks === "function") {
    pipStream.getTracks().forEach((track) => track.stop());
  }
  pipStream = null;

  updatePipButtonVisualState(false);
}

async function togglePictureInPicture() {
  if (!isPictureInPictureSupported()) {
    console.warn("[Schrödinger] Picture-in-Picture is not supported");
    const pipButton = document.getElementById("pip-toggle");
    if (pipButton) {
      pipButton.disabled = true;
      pipButton.setAttribute(
        "data-tooltip",
        "Picture-in-Picture is not supported in this browser."
      );
    }
    return;
  }

  if (
    typeof document !== "undefined" &&
    document.pictureInPictureElement &&
    pipVideoElement &&
    document.pictureInPictureElement === pipVideoElement
  ) {
    await exitPictureInPicture();
  } else {
    await enterPictureInPicture();
  }
}

function updateCombinedCanvasForPip() {
  if (!ensureCombinedCanvas()) {
    return;
  }
  // Keep the combined potential+quantum+overlay canvas in sync continuously
  // so that both the built-in PiP toggle and any browser PiP extensions
  // always see an up-to-date stream.
  updateCombinedCanvas(false);

  // Ensure a hidden video element is streaming the combined canvas so
  // external PiP triggers (e.g. Chrome's PiP extension) can target it
  // even if the in-page PiP button has never been pressed.
  if (isPictureInPictureSupported()) {
    ensurePipVideoElement();
  }
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
