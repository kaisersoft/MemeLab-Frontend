const API_BASE = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";

const $ = (selector) => document.querySelector(selector);
let snapshot = null;
let selectedMint = null;
let pollTimer = null;

function shortMint(mint) {
  if (!mint) return "—";
  if (mint.length <= 12) return mint;
  return mint.slice(0, 6) + "…" + mint.slice(-4);
}

function pct(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

function score(value) {
  return Math.round(Number(value) || 0);
}

function lifecycleLabel(value) {
  const map = {
    DISCOVERY: "Discover",
    LAUNCH: "Launch",
    EARLY_TRADING: "Early Trading",
    MOMENTUM: "Momentum",
    DISTRIBUTION: "Distribution",
    DECAY: "Decay",
  };
  return map[value] || value || "—";
}

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

function renderDiscovery(tokens) {
  const grid = $(".token-grid");
  if (!grid) return;

  if (!tokens.length) {
    grid.innerHTML = '<div class="muted">Waiting for live Solana events…</div>';
    return;
  }

  grid.innerHTML = tokens.slice(0, 3).map((token, index) => {
    const mint = token.mint;
    const selected = mint === selectedMint || (!selectedMint && index === 0);
    return `
      <button class="token-card ${selected ? "selected" : ""}" data-token="${mint}">
        <strong>${shortMint(mint)}</strong>
        <span>Solana · ${lifecycleLabel(token.lifecycle)}</span>
        <div><label>Liquidity signal</label><b class="${pct(token.liquidity) >= 50 ? "positive" : "warning"}">${pct(token.liquidity)}</b></div>
        <div><label>Discovery rank</label><b>${score(token.rank)}</b></div>
      </button>
    `;
  }).join("");

  grid.querySelectorAll(".token-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMint = btn.dataset.token;
      renderSnapshot(snapshot);
    });
  });
}

function renderLifecycle(token) {
  const stages = ["DISCOVERY", "LAUNCH", "EARLY_TRADING", "MOMENTUM", "DISTRIBUTION", "DECAY"];
  const current = stages.indexOf(token?.lifecycle);
  document.querySelectorAll(".life").forEach((el, index) => {
    el.classList.toggle("active", current >= 0 && index <= current);
  });
}

function setMetric(id, value) {
  const el = $(id);
  if (!el) return;
  const v = pct(value);
  el.textContent = v;
  const bar = el.parentElement?.nextElementSibling?.querySelector("em");
  if (bar) bar.style.width = v + "%";
}

function renderSelectedToken(token) {
  if (!token) return;

  $("#score-token").textContent = shortMint(token.mint);
  $("#score").textContent = score(token.intelligence) + " / 100";
  $("#chart-label").textContent = shortMint(token.mint) + " / SOL · live";

  setMetric("#m-liq", token.liquidity);
  setMetric("#m-vol", token.activity);
  setMetric("#m-holder", token.actor_growth);
  setMetric("#m-social", token.confidence);

  const risk = $("#m-risk");
  if (risk) {
    risk.textContent = "—";
    const bar = risk.parentElement?.nextElementSibling?.querySelector("em");
    if (bar) bar.style.width = "0%";
  }

  renderLifecycle(token);
}

function renderMarketContext(market) {
  const regime = market?.regime || "—";
  const breadth = pct(market?.breadth);
  const pressure = pct(market?.buy_pressure);
  const activity = pct(market?.activity);

  const subtitle = document.querySelector(".discovery .panel-head span:not(.muted)");
  if (subtitle) {
    subtitle.textContent = `Solana · ${regime} · breadth ${breadth}`;
  }

  const scan = $("#scan-time");
  if (scan) scan.textContent = `Last event · ${formatTime(snapshot?.runtime?.last_event_at)}`;

  const live = $(".live-pill");
  if (live) {
    const running = Boolean(snapshot?.runtime?.running);
    live.innerHTML = `<i></i> ${running ? "ON-CHAIN LIVE" : "ON-CHAIN IDLE"}`;
    live.style.color = running ? "" : "#e6b24e";
  }

  const note = $(".risk-note");
  if (note) {
    note.innerHTML =
      `<b>Market context:</b> regime ${regime}, buy pressure ${pressure}, activity ${activity}, active tokens ${market?.active_tokens ?? 0}/${market?.total_tokens ?? 0}. Risk engine not connected in this phase.`;
  }
}

function renderSnapshot(data) {
  snapshot = data;
  const tokens = Array.isArray(data?.tokens) ? data.tokens : [];
  renderDiscovery(tokens);
  renderMarketContext(data?.market);

  if (!tokens.length) return;

  if (!selectedMint || !tokens.some((t) => t.mint === selectedMint)) {
    selectedMint = tokens[0].mint;
  }

  renderSelectedToken(tokens.find((t) => t.mint === selectedMint) || tokens[0]);

  const social = document.querySelector(".social");
  if (social) {
    const heading = social.querySelector("h2");
    const sub = social.querySelector(".panel-head .muted");
    if (heading) heading.textContent = "Social Signal";
    if (sub) sub.textContent = "Not connected · separate development block";
    const table = social.querySelector(".signal-table");
    if (table) {
      table.innerHTML = [
        ["Status", "NOT CONNECTED"],
        ["Data source", "Separate API"],
        ["Integration", "Later phase"],
        ["On-chain data", "Available"],
        ["Social intelligence", "Not evaluated"],
      ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("");
    }
  }

  const footer = document.querySelector(".prototype-note");
  if (footer) {
    footer.textContent =
      "MemeLab · live Solana intelligence · frontend connected to local JSON API · risk and social intelligence follow in later development blocks.";
  }
}

async function api(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    cache: "no-store",
    ...options,
    headers: { "Accept": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function startEngine() {
  try {
    await api("/start", { method: "POST" });
    await refresh();
  } catch (error) {
    console.error("MemeLab API start failed:", error);
    const live = $(".live-pill");
    if (live) live.innerHTML = "<i></i> API OFFLINE";
  }
}

async function refresh() {
  try {
    const data = await api("/snapshot");
    renderSnapshot(data);
  } catch (error) {
    console.error("MemeLab snapshot failed:", error);
    const live = $(".live-pill");
    if (live) live.innerHTML = "<i></i> API OFFLINE";
  }
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");
  });
});

startEngine();
pollTimer = setInterval(refresh, 1000);
