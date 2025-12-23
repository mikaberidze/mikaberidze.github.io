// Lightweight GA wrapper and shared analytics state.

const DEFAULT_EXPERIMENT_NAME = "Custom setup";
let analyticsExperimentName = DEFAULT_EXPERIMENT_NAME;
let analyticsExperimentSource = "custom";
let analyticsSimulationStart = null;

function analyticsTimestampMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function trackAnalyticsEvent(eventName, params = {}) {
  if (!eventName) return;
  try {
    if (typeof gtag === "function") {
      gtag("event", eventName, params);
    } else if (typeof window !== "undefined" && Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...params });
    }
  } catch (err) {
    console.warn("[Schrödinger] Analytics event failed:", err);
  }
}

function setAnalyticsExperiment(name, source = "custom", options = {}) {
  const normalizedName =
    name && String(name).trim()
      ? String(name).trim()
      : DEFAULT_EXPERIMENT_NAME;

  analyticsExperimentName = normalizedName;
  analyticsExperimentSource = source || "custom";

  const emitEvent =
    !options || typeof options.emitEvent === "undefined"
      ? true
      : !!options.emitEvent;

  if (emitEvent) {
    trackAnalyticsEvent("experiment_loaded", {
      experiment_name: analyticsExperimentName,
      experiment_source: analyticsExperimentSource,
    });
  }

  // Reset any in-progress timer when switching experiments.
  analyticsSimulationStart = null;
}

function startSimulationAnalytics() {
  if (analyticsSimulationStart === null) {
    analyticsSimulationStart = analyticsTimestampMs();
  }
}

function stopSimulationAnalytics(reason = "stop") {
  if (analyticsSimulationStart === null) return;
  const durationMs = Math.max(0, analyticsTimestampMs() - analyticsSimulationStart);
  analyticsSimulationStart = null;

  if (durationMs < 10) return;

  trackAnalyticsEvent("simulation_duration", {
    experiment_name: analyticsExperimentName,
    experiment_source: analyticsExperimentSource,
    duration_ms: Math.round(durationMs),
    duration_seconds: Number((durationMs / 1000).toFixed(2)),
    stop_reason: reason,
  });
}

function trackToolUsage(category, detail = {}) {
  if (!category) return;
  trackAnalyticsEvent("tool_usage", {
    tool_category: category,
    ...detail,
  });
}

// Register the default starting experiment.
setAnalyticsExperiment(DEFAULT_EXPERIMENT_NAME, "default");
