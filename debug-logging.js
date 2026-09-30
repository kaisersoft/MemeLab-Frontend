(() => {
  const apiBase = window.MEMELAB_API_BASE;
  const panel = document.querySelector("#debug-panel");
  const status = document.querySelector("#debug-api-status");
  const switches = [...document.querySelectorAll("[data-log-toggle]")];
  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const render = settings => {
    switches.forEach(control => {
      const enabled = Boolean(settings?.[control.dataset.logToggle]);
      control.setAttribute("aria-checked", String(enabled));
      const label = control.parentElement.querySelector(".debug-log-status");
      if (label) label.textContent = enabled ? "ON" : "OFF";
    });
  };
  const loadSettings = async () => {
    const response = await fetch(`${apiBase}/logging`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Logging status request failed (${response.status})`);
    const data = await response.json();
    render(data.settings);
    setStatus("Logging status connected.");
  };

  document.querySelectorAll(".nav-btn[data-view]").forEach(button => button.addEventListener("click", () => {
    const visible = button.dataset.view === "debug";
    if (panel) panel.hidden = !visible;
    if (visible) loadSettings().catch(error => setStatus(error.message, true));
  }));

  switches.forEach(control => control.addEventListener("click", async () => {
    const name = control.dataset.logToggle;
    const enabled = control.getAttribute("aria-checked") !== "true";
    control.disabled = true;
    setStatus("Updating logging setting…");
    try {
      const response = await fetch(`${apiBase}/logging`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, enabled })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Logging update failed (${response.status})`);
      render(data.settings);
      setStatus("Logging setting updated.");
    } catch (error) {
      setStatus(error.message, true);
      loadSettings().catch(() => {});
    } finally {
      control.disabled = false;
    }
  }));
})();
