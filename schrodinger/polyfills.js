// Minimal polyfills for older browsers (e.g. older iOS Safari).
// Currently provides a safe Event constructor used throughout the app.

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  var needsEventPolyfill = false;

  try {
    if (typeof window.Event === "function") {
      // Test if the native Event constructor works.
      var testEvent = new Event("test");
      if (!testEvent) {
        needsEventPolyfill = true;
      }
    } else {
      needsEventPolyfill = true;
    }
  } catch (err) {
    needsEventPolyfill = true;
  }

  if (!needsEventPolyfill) {
    return;
  }

  function EventPolyfill(type, params) {
    params = params || {};
    var bubbles =
      typeof params.bubbles === "boolean" ? params.bubbles : false;
    var cancelable =
      typeof params.cancelable === "boolean" ? params.cancelable : false;

    var evt;
    if (typeof document.createEvent === "function") {
      evt = document.createEvent("Event");
      evt.initEvent(type, bubbles, cancelable);
    } else {
      // Very old fallback: create a plain object with minimal shape.
      evt = { type: type, bubbles: bubbles, cancelable: cancelable };
    }
    return evt;
  }

  if (window.Event && window.Event.prototype) {
    EventPolyfill.prototype = window.Event.prototype;
  }

  window.Event = EventPolyfill;
})();

