/* MemeLab frontend runtime configuration.
   Set this mode to "cloud" in the VPS frontend deployment. */
(() => {
  // Change this deployment setting to "cloud" on the VPS.
  const CONFIGURED_MODE = "local";
  const API_BASES = {
    local: "http://127.0.0.1:8765/api",
    cloud: "/api",
  };

  const requestedMode = String(window.MEMELAB_RUNTIME_MODE || CONFIGURED_MODE).trim().toLowerCase();
  const mode = Object.prototype.hasOwnProperty.call(API_BASES, requestedMode) ? requestedMode : "local";
  const override = typeof window.MEMELAB_API_URL === "string"
    ? window.MEMELAB_API_URL.trim()
    : "";

  window.MEMELAB_RUNTIME_MODE = mode;
  window.MEMELAB_API_BASE = override || API_BASES[mode] || API_BASES.local;
})();
