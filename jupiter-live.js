/* MemeLab Jupiter mainnet bridge — frontend-only integration layer.
   The Jupiter API key remains server-side. Browser calls MemeLab's backend proxy. */
(() => {
  const apiBase = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
  let tokens = [];
  let selectedMint = null;

  const $ = (s) => document.querySelector(s);
  const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
  const score = (v) => Math.round(Number(v) || 0);
  const shortMint = (m) => !m ? "—" : m.length <= 14 ? m : m.slice(0,7)+"…"+m.slice(-5);
  const usd = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e9) return "$"+(n/1e9).toFixed(2)+"B";
    if (Math.abs(n) >= 1e6) return "$"+(n/1e6).toFixed(2)+"M";
    if (Math.abs(n) >= 1e3) return "$"+(n/1e3).toFixed(1)+"K";
    if (Math.abs(n) >= 1) return "$"+n.toFixed(2);
    return "$"+n.toExponential(2);
  };
  const lifecycle = (t) => {
    const s=t?.stats24h||{};
    return t?.firstPool && Number(s.volume||0)>0 && Number(t.liquidity||0)>0 && Number(s.numTraders||0)>=10 ? "EMERGING" : "DISCOVERED";
  };
  const activity = (t) => {
    const s=t?.stats24h||{}, v=Number(s.volume||0), l=Number(t?.liquidity||0);
    const trades=Number(s.numBuys||0)+Number(s.numSells||0);
    return Math.min(1,(l>0?Math.min(1,v/l):0)*.65+Math.min(1,trades/500)*.35);
  };

  function render() {
    const grid=$(".token-grid");
    if (!grid) return;
    grid.innerHTML=tokens.slice(0,3).map((t,i) => {
      const selected=t.mint===selectedMint || (!selectedMint && i===0);
      const solscan="https://solscan.io/token/"+encodeURIComponent(t.mint);
      return '<article class="token-card '+(selected?"selected":"")+'" data-token="'+t.mint+'">'+
        '<strong>'+(t.symbol||shortMint(t.mint))+'</strong>'+
        '<span>'+(t.name||"Solana token")+'</span>'+
        '<small class="token-chain">Solana Mainnet · '+lifecycle(t)+'</small>'+
        '<div><label>Liquidity</label><b class="'+(Number(t.liquidity||0)>=10000?"positive":"warning")+'">'+usd(t.liquidity)+'</b></div>'+
        '<div><label>24h Volume</label><b>'+usd(t.stats24h?.volume)+'</b></div>'+
        '<div><label>Jupiter Organic</label><b>'+score(t.organicScore)+'/100</b></div>'+
        '<a class="token-mint" href="'+solscan+'" target="_blank" rel="noopener noreferrer" title="'+t.mint+'">Mint '+shortMint(t.mint)+' ↗</a>'+
        '</article>';
    }).join("");
    grid.querySelectorAll(".token-card").forEach(card=>card.addEventListener("click",()=>{selectedMint=card.dataset.token;render();}));
    const label=$("#market-universe-label"); if(label){label.textContent="Jupiter · Recent";label.title="Solana Mainnet discovery feed via MemeLab backend";}
    const total=$("#market-total-tokens"); if(total) total.textContent=tokens.length.toLocaleString();
    const active=$("#market-active-tokens"); if(active) active.textContent=tokens.filter(t=>activity(t)>0).length.toLocaleString();
    const candidates=$("#market-candidates"); if(candidates) candidates.textContent=tokens.filter(t=>lifecycle(t)==="EMERGING").length.toLocaleString();
    const act=$("#market-activity"); if(act) act.textContent=pct(tokens.length?tokens.reduce((a,t)=>a+activity(t),0)/tokens.length:0);
    const sub=document.querySelector(".discovery .panel-head > div > span"); if(sub) sub.textContent="Solana Mainnet · Jupiter Recent";
    const scan=$("#scan-time"); if(scan) scan.textContent="Jupiter Recent · "+tokens.length+" tokens · "+new Date().toLocaleTimeString();
    const note=$(".risk-note"); if(note) note.innerHTML="<b>Universe:</b> live Jupiter Recent feed on Solana Mainnet · "+tokens.length+" records. Jupiter Organic Score is an external signal, not MemeLab intelligence.";
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

  window.MEMELAB_JUPITER = { refresh: load };
  load();
  setInterval(load,5000);
})();