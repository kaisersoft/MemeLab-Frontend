/* MemeLab Jupiter mainnet feed presentation.
   Jupiter API access stays server-side; the browser consumes MemeLab's proxy. */
(() => {
  const apiBase = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
  let tokens = [];
  let selectedMint = null;
  const $ = (s) => document.querySelector(s);
  const shortMint = (m) => !m ? "—" : m.length <= 14 ? m : m.slice(0,7)+"…"+m.slice(-5);
  const score = (v) => Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
  const usd = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e9) return "$"+(n/1e9).toFixed(2)+"B";
    if (Math.abs(n) >= 1e6) return "$"+(n/1e6).toFixed(2)+"M";
    if (Math.abs(n) >= 1e3) return "$"+(n/1e3).toFixed(1)+"K";
    if (Math.abs(n) >= 1) return "$"+n.toFixed(2);
    return "$"+n.toExponential(2);
  };
  const stats24h = (t) => t?.stats24h || {};
  const organic = (t) => {
    const v=t?.organicScore;
    return v === null || v === undefined || v === "" ? "—" : (score(v) ?? "—")+"/100";
  };
  const lifecycle = () => "DISCOVERED";

  function render() {
    const grid=$(".token-grid");
    if (!grid) return;
    grid.innerHTML=tokens.slice(0,3).map((t,i) => {
      const selected=t.mint===selectedMint || (!selectedMint && i===0);
      const solscan="https://solscan.io/token/"+encodeURIComponent(t.mint);
      const s=stats24h(t);
      return '<article class="token-card '+(selected?"selected":"")+'" data-token="'+t.mint+'">'+
        '<strong>'+(t.symbol||shortMint(t.mint))+'</strong>'+
        '<span>'+(t.name||"Solana token")+'</span>'+
        '<small class="token-chain">Solana Mainnet · '+lifecycle(t)+'</small>'+
        '<div><label>Liquidity</label><b>'+usd(t.liquidity)+'</b></div>'+
        '<div><label>24h Volume</label><b>'+usd(s.volume)+'</b></div>'+
        '<div><label>Jupiter Organic</label><b>'+organic(t)+'</b></div>'+
        '<a class="token-mint" href="'+solscan+'" target="_blank" rel="noopener noreferrer" title="'+t.mint+'">Mint '+shortMint(t.mint)+' ↗</a>'+
        '</article>';
    }).join("");

    grid.querySelectorAll(".token-card").forEach(card => {
      card.addEventListener("click", () => { selectedMint=card.dataset.token; render(); });
    });

    const label=$("#market-universe-label");
    if(label){label.textContent="Jupiter · Recent";label.title="30 current records from Jupiter Tokens V2 recent feed on Solana Mainnet.";}
    const total=$("#market-total-tokens"); if(total) total.textContent=tokens.length.toLocaleString();
    const active=$("#market-active-tokens"); if(active) active.textContent=tokens.filter(t => {
      const s=stats24h(t);
      return Number(s.numBuys||0)+Number(s.numSells||0) > 0;
    }).length.toLocaleString();
    const candidates=$("#market-candidates"); if(candidates) candidates.textContent="—";
    const activity=$("#market-activity"); if(activity) activity.textContent="—";
    const sub=document.querySelector(".discovery .panel-head > div > span");
    if(sub) sub.textContent="Solana Mainnet · Jupiter Recent";
    const scan=$("#scan-time");
    if(scan) scan.textContent="Jupiter Recent · "+tokens.length+" records · "+new Date().toLocaleTimeString();
    const note=$(".risk-note");
    if(note) note.innerHTML="<b>Universe:</b> Jupiter Recent is a source feed, not yet the MemeLab candidate engine. Lifecycle is currently DISCOVERED until MemeLab has sufficient independent history.";
  }

  async function load() {
    try {
      const r=await fetch(apiBase+"/jupiter/recent",{cache:"no-store",headers:{Accept:"application/json"}});
      if(!r.ok) throw new Error(r.status+" "+r.statusText);
      const data=await r.json();
      tokens=Array.isArray(data.tokens)?data.tokens:[];
      render();
    } catch(e) {
      console.error("MemeLab Jupiter feed:",e);
      const scan=$("#scan-time"); if(scan) scan.textContent="Jupiter feed unavailable";
    }
  }

  window.MEMELAB_JUPITER={refresh:load};
  load();
  setInterval(load,5000);
})();