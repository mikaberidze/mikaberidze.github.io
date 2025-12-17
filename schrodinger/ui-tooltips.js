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
