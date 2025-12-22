// Shared hover tooltip state
const HOVER_TOOLTIP_DELAY_MS = 1000;
let hoverTooltipEl = null;
let hoverTooltipTimer = null;
let hoverTooltipTarget = null;

function isMobileTooltipEnvironment() {
  if (typeof window === "undefined") return false;

  const hasTouch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

  const isCoarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  const isNarrowScreen =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px)").matches;

  return hasTouch && (isCoarsePointer || isNarrowScreen);
}

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
  const inPotentialEditor = !!target.closest(".potential-editor");
  const inCanvasTransport = !!target.closest(".canvas-transport");

  if (inPotentialEditor) {
    const left = rect.right + margin;
    const top = rect.top + rect.height / 2;
    hoverTooltipEl.style.left = `${left}px`;
    hoverTooltipEl.style.top = `${top}px`;
    hoverTooltipEl.style.transform = "translateY(-50%)";
  } else if (inCanvasTransport) {
    const left = rect.left + rect.width / 2;
    const top = rect.top - margin;
    hoverTooltipEl.style.left = `${left}px`;
    hoverTooltipEl.style.top = `${top}px`;
    hoverTooltipEl.style.transform = "translate(-50%, -100%)";
  } else {
    const left = rect.left + rect.width / 2;
    const top = rect.bottom + margin;
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
  el.innerHTML = text;
  const plainText = el.textContent || "";
  if (plainText.length > 120) {
    el.classList.add("is-wide");
  } else {
    el.classList.remove("is-wide");
  }
  if (typeof typesetMathInElement === "function") {
    try {
      typesetMathInElement(el);
    } catch (err) {
      // Math rendering is cosmetic; ignore failures.
    }
  }
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
  if (isMobileTooltipEnvironment()) {
    if (hoverTooltipEl) {
      hoverTooltipEl.classList.remove("is-visible");
    }
    return;
  }

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
