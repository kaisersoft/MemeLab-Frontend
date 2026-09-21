/* MemeLab Jupiter mainnet feed presentation.
   Jupiter API access stays server-side; the browser consumes MemeLab's proxy. */
(() => {
  const apiBase = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
  let tokens = [];
  let selectedMint = null;
  let lifecycleFilter = "DISCOVERED";
  const LIFECYCLE_STAGES = ["DISCOVERED","EMERGING","ACTIVE","MATURE"];
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
  const stats24h = (t) => t?.stats_24h || {};
  const organic = (t) => {
    const v=t?.organic_score;
    return v === null || v === undefined || v === "" ? "—" : (score(v) ?? "—")+"/100";
  };
  const lifecycle = (t) => t?.lifecycle || "DISCOVERED";

  function render() {
    const grid=$(".token-grid");
    if (!grid) return;
    const filteredTokens = tokens.filter(t => lifecycle(t) === lifecycleFilter);
    const selectedInFilter = filteredTokens.some(t => t.mint === selectedMint);
    if (!selectedInFilter) selectedMint = filteredTokens[0]?.mint || null;
    const visibleTokens = filteredTokens.slice(0,3);
    grid.innerHTML = visibleTokens.length ? visibleTokens.map((t,i) => {
      const selected=t.mint===selectedMint || (!selectedMint && i===0);
      const solscan="https://solscan.io/token/"+encodeURIComponent(t.mint);
      const s=stats24h(t);
      return '<article class="token-card '+(selected?"selected":"")+'" data-token="'+t.mint+'">'+
        '<strong>'+(t.symbol||shortMint(t.mint))+'</strong>'+
        '<span>'+(t.name||"Solana token")+'</span>'+
        '<small class="token-chain">Solana Mainnet · '+lifecycle(t)+' · '+(t.discovery_status||"NOT_EVALUATED")+'</small>'+
        '<div><label>Liquidity</label><b>'+usd(t.liquidity)+'</b></div>'+
        '<div><label>24h Volume</label><b>'+usd(s.volume)+'</b></div>'+
        '<div><label>24h Trades</label><b>'+((Number(s.num_buys||0)+Number(s.num_sells||0))||"—")+'</b></div>'+
        '<div><label>24h Traders</label><b>'+(s.num_traders ?? "—")+'</b></div>'+
        '<div><label>History</label><b>'+(t.history?.observations||0)+' obs.</b></div>'+
        '<div><label>Jupiter Organic</label><b>'+organic(t)+'</b></div>'+
        '<a class="token-mint" href="'+solscan+'" target="_blank" rel="noopener noreferrer" title="'+t.mint+'">Mint '+shortMint(t.mint)+' ↗</a>'+
        '</article>';
    }).join("") : '<div class="token-empty"><strong>No tokens in this lifecycle stage</strong><span>The live Jupiter universe currently has no records matching <b>'+lifecycleFilter+'</b>.</span></div>';

    grid.querySelectorAll(".token-card").forEach(card => {
      card.addEventListener("click", () => { selectedMint=card.dataset.token; render(); });
    });

    const label=$("#market-universe-label");
    if(label){label.textContent="Current universe";label.title="Current MemeLab universe returned by the connected source.";}
    const total=$("#market-total-tokens"); if(total) total.textContent=tokens.length.toLocaleString();
    const active=$("#market-active-tokens"); if(active) active.textContent=tokens.filter(t => {
      const s=stats24h(t);
      return Number(s.num_buys||0)+Number(s.num_sells||0) > 0;
    }).length.toLocaleString();
    const candidates=$("#market-candidates"); if(candidates) candidates.textContent="—";
    const activity=$("#market-activity"); if(activity) activity.textContent="—";
    const sub=document.querySelector(".discovery .panel-head > div > span");
    if(sub) sub.textContent="Lifecycle status model";
    const scan=$("#scan-time");
    if(scan) scan.textContent="Live status · "+tokens.length+" records · "+new Date().toLocaleTimeString();
    const intelligence=$("#score"); if(intelligence) intelligence.textContent="— / 100";
    const selected=tokens.find(t=>t.mint===selectedMint)||tokens[0];
    const scoreToken=$("#score-token"); if(scoreToken) scoreToken.textContent=selected?.symbol || "—";
    if(selected){
      const s=stats24h(selected);
      const vals={"#m-liq":selected.liquidity,"#m-vol":s.volume,"#m-holder":s.num_traders,"#m-social":(selected.data_quality?.completeness!=null?Math.round(selected.data_quality.completeness*100):null),"#m-risk":"—"};
      Object.entries(vals).forEach(([sel,val])=>{const el=$(sel);if(el)el.textContent=val==null?"—":(sel==="#m-social"?val+"%":(sel==="#m-liq"||sel==="#m-vol"?usd(val):String(val)));});
    }
    const stage=document.querySelectorAll(".life");
    const lifecycleCounts = Object.fromEntries(LIFECYCLE_STAGES.map(stage => [stage, tokens.filter(t => lifecycle(t) === stage).length]));
    stage.forEach((el,i)=>{
      const stageName=LIFECYCLE_STAGES[i];
      el.classList.toggle("active", lifecycleFilter===stageName);
      el.setAttribute("aria-selected", lifecycleFilter===stageName ? "true" : "false");
      const count=el.querySelector(".life-count");
      if(count) count.textContent=String(lifecycleCounts[stageName]||0);
      el.onclick=()=>{ lifecycleFilter=stageName; selectedMint=null; render(); };
    });

    const source=$("#source-status");
    if(source) source.textContent="Source · Jupiter Tokens V2 · Recent · Solana Mainnet · "+tokens.length+" records · updated "+new Date().toLocaleTimeString();
    const note=$(".risk-note");
    if(note) note.innerHTML="<b>Status:</b> "+lifecycleFilter+" selected · counts reflect the current live universe. Lifecycle evidence is calculated from MemeLab history.";
  }

  async function load() {
    try {
      const r=await fetch(apiBase+"/jupiter/universe",{cache:"no-store",headers:{Accept:"application/json"}});
      if(!r.ok) throw new Error(r.status+" "+r.statusText);
      const data=await r.json();
      tokens=Array.isArray(data.tokens)?data.tokens:[];
      render();
    } catch(e) {
      console.error("MemeLab Jupiter feed:",e);
      const scan=$("#scan-time"); if(scan) scan.textContent="Jupiter feed unavailable";
    }
  }

  window.MEMELAB_JUPITER={refresh:load,active:true};
  load();
  setInterval(load,5000);
})();