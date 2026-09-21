/* MemeLab Jupiter mainnet feed presentation.
   Jupiter API access stays server-side; the browser consumes MemeLab's proxy. */
(() => {
  const apiBase = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
  let tokens = [];
  let ingestCount = 0;
  let selectedMint = null;
  let lifecycleFilter = "DISCOVERED";
  const LIFECYCLE_STAGES = ["DISCOVERED","EMERGING","ACTIVE","MATURE","DECLINING","INACTIVE","ARCHIVED"];
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
  const lifecycle = (t) => t?.lifecycle || "DISCOVERED";

  let universeOpen = false;
  let sortKey = "candidate";
  let sortDir = "desc";
  let watchlistSortKey = "top3_since";
  let watchlistSortDir = "asc";

  const nextStage = (stage) => ({
    DISCOVERED: "EMERGING",
    EMERGING: "ACTIVE",
    ACTIVE: "MATURE",
  }[stage] || null);

  const evidenceScore = (t) => {
    const e=t?.lifecycle_evidence||{};
    return ["identity","market_structure","trading_activity","multiple_participants","history_emerging","trading_persistence","history_active","history_mature","data_quality"]
      .reduce((n,k)=>n+(e[k]?1:0),0);
  };

  const candidateScore = (t) => {
    const stage=lifecycle(t);
    const next=nextStage(stage);
    if(!next) return -1;
    const readiness=t?.lifecycle_readiness||{};
    const ready=readiness[next] ? 1 : 0;
    const eScore=evidenceScore(t);
    const s=stats24h(t);
    const traders=Number(s.num_traders||0);
    const trades=Number(s.num_buys||0)+Number(s.num_sells||0);
    const history=Number(t?.history?.observations||0);
    const liquidity=Number(t?.liquidity||0);
    return ready*100000000 + eScore*1000000 + history*1000 + Math.min(traders,999) + Math.min(trades,999)/1000 + Math.log10(Math.max(liquidity,1))/10000;
  };

  const phaseLabel = (t) => {
    const next=nextStage(lifecycle(t));
    if(!next) return "—";
    return t?.lifecycle_readiness?.[next] ? next+" · READY" : next;
  };

  const compareValues = (a,b,key) => {
    const value = (t) => {
      const s=stats24h(t);
      if(key==="symbol") return String(t.symbol||"").toLowerCase();
      if(key==="name") return String(t.name||"").toLowerCase();
      if(key==="lifecycle") return lifecycle(t);
      if(key==="discovery_status") return String(t.discovery_status||"");
      if(key==="history") return Number(t.history?.observations||0);
      if(key==="liquidity") return Number(t.liquidity||0);
      if(key==="volume") return Number(s.volume||0);
      if(key==="trades") return Number(s.num_buys||0)+Number(s.num_sells||0);
      if(key==="traders") return Number(s.num_traders||0);
      if(key==="organic") return Number(t.organic_score||0);
      if(key==="next_phase") return String(phaseLabel(t));
      if(key==="candidate") return candidateScore(t);
      return 0;
    };
    const av=value(a), bv=value(b);
    if(typeof av==="string" || typeof bv==="string") return String(av).localeCompare(String(bv));
    return av-bv;
  };

  function renderUniverseTable(filteredTokens) {
    const wrap=$("#universe-table-wrap");
    const body=$("#universe-table-body");
    const toggle=$("#universe-toggle");
    const count=$("#universe-count");
    if(!wrap||!body||!toggle) return;

    count.textContent=filteredTokens.length;
    toggle.textContent=universeOpen ? "Hide all " : "View all ";
    const countSpan=document.createElement("span");
    countSpan.id="universe-count";
    countSpan.textContent=String(filteredTokens.length);
    toggle.appendChild(countSpan);
    wrap.hidden=!universeOpen;
    if(!universeOpen) return;

    const sorted=[...filteredTokens].sort((a,b)=>{
      const result=compareValues(a,b,sortKey);
      return result===0 ? compareValues(a,b,"candidate")*-1 : result;
    });
    if(sortDir==="desc") sorted.reverse();

    body.innerHTML=sorted.map(t=>{
      const s=stats24h(t);
      const next=nextStage(lifecycle(t));
      const ready=next && t?.lifecycle_readiness?.[next];
      const solscan="https://solscan.io/token/"+encodeURIComponent(t.mint);
      return '<tr data-token="'+t.mint+'">'+
        '<td><a class="token-mint" href="'+solscan+'" target="_blank" rel="noopener noreferrer">'+(t.symbol||shortMint(t.mint))+'</a></td>'+
        '<td>'+(t.name||"—")+'</td>'+
        '<td class="stage">'+lifecycle(t)+'</td>'+
        '<td>'+(t.discovery_status||"—")+'</td>'+
        '<td>'+((t.history?.observations||0)+" obs.")+'</td>'+
        '<td>'+usd(t.liquidity)+'</td>'+
        '<td>'+usd(s.volume)+'</td>'+
        '<td>'+((Number(s.num_buys||0)+Number(s.num_sells||0))||"—")+'</td>'+
        '<td>'+(s.num_traders ?? "—")+'</td>'+
        '<td class="next '+(ready?"ready":"")+(next?"":" none")+'">'+(phaseLabel(t))+'</td>'+
      '</tr>';
    }).join("");

    body.querySelectorAll("tr").forEach(row=>{
      row.addEventListener("click",(event)=>{
        if(event.target.closest("a")) return;
        selectedMint=row.dataset.token;
        render();
        if(window.MEMELAB_MARKET?.selectToken) window.MEMELAB_MARKET.selectToken(selectedMint);
      });
    });
  }

  function renderDiagnostics(data){
    const d=data?.diagnostics||{};
    const set=(id,value)=>{const el=$(id);if(el)el.textContent=value==null?"—":String(value);};
    set("#dbg-scope",d.discovery_scope); set("#dbg-recent",d.jupiter_recent_count); set("#dbg-scope-records",d.scope_count);
    set("#dbg-universe",d.meme_lab_universe); set("#dbg-emerging",d.emerging_count); set("#dbg-active",d.active_count); set("#dbg-watchlist",d.watchlist_count);
    set("#dbg-watch-scan",d.watchlist_last_scan_at?new Date(Number(d.watchlist_last_scan_at)*1000).toLocaleTimeString():"waiting");
    set("#dbg-top3",(d.top3_emerging||[]).map((t,i)=>(i+1)+". "+(t.symbol||shortMint(t.mint))).join(" · ")||"—");
  }

  const watchlistSortValue = (t,key) => {
    const w=t?.watchlist||{}, m=t?.monitoring||{}, s=stats24h(t);
    if(key==="symbol") return String(t.symbol||"").toLowerCase();
    if(key==="lifecycle") return lifecycle(t);
    if(key==="top3_since") return Number(w.first_top3_at||0);
    if(key==="top3_hits") return Number(w.top3_count||0);
    if(key==="observations") return Number(m.observations||0);
    if(key==="trades") return Number(m.trades_24h??(Number(s.num_buys||0)+Number(s.num_sells||0)));
    if(key==="active_12") return Number(m.active_observations_last_12||0);
    if(key==="next_status") return String(m.next_status||"ACTIVE");
    return 0;
  };

  const watchlistSortLabel = (label,key) => {
    if(watchlistSortKey!==key) return label;
    return label+" "+(watchlistSortDir==="asc"?"↑":"↓");
  };

  function renderWatchlist(rows){
    const body=$("#watchlist-body"), count=$("#watchlist-count");
    if(!body)return;
    const list=Array.isArray(rows)?[...rows]:[];
    if(count)count.textContent=String(list.length);
    list.sort((a,b)=>{
      const av=watchlistSortValue(a,watchlistSortKey), bv=watchlistSortValue(b,watchlistSortKey);
      const cmp=(typeof av==="string"||typeof bv==="string")
        ? String(av).localeCompare(String(bv))
        : av-bv;
      return watchlistSortDir==="asc"?cmp:-cmp;
    });
    body.innerHTML=list.length?list.map(t=>{
      const w=t.watchlist||{}, m=t.monitoring||{};
      return '<tr data-token="'+(t.mint||"")+'">'+
        '<td><strong>'+(t.symbol||shortMint(t.mint))+'</strong><small>'+(t.name||"—")+'</small></td>'+
        '<td>'+((t.lifecycle)||"—")+'</td>'+ '<td>'+((w.first_top3_at)?new Date(Number(w.first_top3_at)*1000).toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"}):"—")+'</td>'+
        '<td>'+((w.top3_count??"—"))+'</td>'+ '<td>'+((m.observations??"—"))+'</td>'+ '<td>'+((m.trades_24h??"—"))+'</td>'+
        '<td>'+((m.active_observations_last_12??0))+'/12</td>'+ '<td class="next ready">'+((m.next_status)||"ACTIVE")+'</td></tr>';
    }).join(""): '<tr><td colspan="8" class="watchlist-empty">Noch keine Top-3-EMERGING-Kandidaten.</td></tr>';
    body.querySelectorAll("tr[data-token]").forEach(row=>row.addEventListener("click",()=>{
      selectedMint=row.dataset.token; render(); if(window.MEMELAB_MARKET?.selectToken) window.MEMELAB_MARKET.selectToken(selectedMint);
    }));
  }

  function render() {
    const grid=$(".token-grid");
    if (!grid) return;
    const filteredTokens = tokens.filter(t => lifecycle(t) === lifecycleFilter);
    const selectedInFilter = filteredTokens.some(t => t.mint === selectedMint);
    if (!selectedInFilter) selectedMint = filteredTokens[0]?.mint || null;

    const ranked=[...filteredTokens].sort((a,b)=>candidateScore(b)-candidateScore(a));
    const visibleTokens = ranked.slice(0,3);
    const next=nextStage(lifecycleFilter);

    grid.innerHTML = visibleTokens.length ? visibleTokens.map((t,i) => {
      const selected=t.mint===selectedMint || (!selectedMint && i===0);
      const solscan="https://solscan.io/token/"+encodeURIComponent(t.mint);
      const s=stats24h(t);
      const phase=phaseLabel(t);
      return '<article class="token-card '+(selected?"selected":"")+'" data-token="'+t.mint+'">'+
        '<strong>'+(t.symbol||shortMint(t.mint))+'</strong>'+
        '<span>'+(t.name||"Solana token")+'</span>'+
        '<small class="token-chain">Solana Mainnet · '+lifecycle(t)+' · '+(t.discovery_status||"NOT_EVALUATED")+'</small>'+
        '<div><label>Liquidity</label><b>'+usd(t.liquidity)+'</b></div>'+
        '<div><label>24h Volume</label><b>'+usd(s.volume)+'</b></div>'+
        '<div><label>24h Trades</label><b>'+((Number(s.num_buys||0)+Number(s.num_sells||0))||"—")+'</b></div>'+
        '<div><label>24h Traders</label><b>'+(s.num_traders ?? "—")+'</b></div>'+
        '<div><label>History</label><b>'+(t.history?.observations||0)+' obs.</b></div>'+
        '<div><label>Next phase</label><b class="'+(t?.lifecycle_readiness?.[next]?"positive":"")+'">'+phase+'</b></div>'+
        '<a class="token-mint" href="'+solscan+'" target="_blank" rel="noopener noreferrer" title="'+t.mint+'">Mint '+shortMint(t.mint)+' ↗</a>'+
        '</article>';
    }).join("") : '<div class="token-empty"><strong>No tokens in this lifecycle stage</strong><span>The persistent MemeLab universe currently has no records matching <b>'+lifecycleFilter+'</b>.</span></div>';

    grid.querySelectorAll(".token-card").forEach(card => {
      card.addEventListener("click", () => {
        selectedMint=card.dataset.token;
        render();
        if(window.MEMELAB_MARKET?.selectToken) window.MEMELAB_MARKET.selectToken(selectedMint);
      });
    });
    const selected=tokens.find(t=>t.mint===selectedMint)||tokens[0];
    if(selected){
      if(selectedMint!==selected.mint){
        selectedMint=selected.mint;
        if(window.MEMELAB_MARKET?.selectToken) window.MEMELAB_MARKET.selectToken(selectedMint);
      } else if(window.MEMELAB_MARKET?.updateLive){
        window.MEMELAB_MARKET.updateLive(selected);
      }
    }

    const sub=document.querySelector(".discovery .panel-head > div > span");
    if(sub) sub.textContent="Lifecycle status model";
    const scan=$("#scan-time");
    if(scan) scan.textContent="Live status · "+tokens.length+" monitored records · "+new Date().toLocaleTimeString();
    const intelligence=$("#score"); if(intelligence) intelligence.textContent="— / 100";
    const scoreToken=$("#score-token"); if(scoreToken) scoreToken.textContent=selected?.symbol || "—";
    if(selected){
      const s=stats24h(selected);
      const observations=Number(selected?.history?.observations||0);
      const known=observations>0;
      const vals={"#m-liq":known?selected.liquidity:null,"#m-vol":known?s.volume:null,"#m-holder":known?s.num_traders:null,"#m-social":known&&selected.data_quality?.completeness!=null?Math.round(selected.data_quality.completeness*100):null,"#m-risk":"—"};
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

    renderDiagnostics(window.MEMELAB_JUPITER_DATA||{});
    renderWatchlist((window.MEMELAB_JUPITER_DATA||{}).diagnostics?.watchlist||[]);
    const source=$("#source-status");
    if(source) source.textContent="Jupiter Discovery scope · "+ingestCount+" current source records · "+tokens.length+" monitored in MemeLab";
    const toggle=$("#universe-toggle");
    if(toggle) toggle.onclick=()=>{ universeOpen=!universeOpen; render(); };
    const preview=$("#preview-label");
    if(preview) preview.textContent=next ? "Top candidates for next lifecycle phase · "+next : "Current lifecycle stage · no further primary phase";
    document.querySelectorAll(".universe-table th button").forEach(button=>{
      button.onclick=()=>{
        const key=button.dataset.sort;
        if(sortKey===key) sortDir=sortDir==="asc"?"desc":"asc";
        else { sortKey=key; sortDir=key==="symbol"||key==="name"||key==="lifecycle"||key==="discovery_status"||key==="next_phase"?"asc":"desc"; }
        render();
      };
    });
    document.querySelectorAll(".watchlist-table th button").forEach(button=>{
      button.onclick=()=>{
        const key=button.dataset.sort;
        if(watchlistSortKey===key) watchlistSortDir=watchlistSortDir==="asc"?"desc":"asc";
        else {
          watchlistSortKey=key;
          watchlistSortDir=key==="symbol"||key==="lifecycle"||key==="top3_since"||key==="next_status"?"asc":"desc";
        }
        renderWatchlist((window.MEMELAB_JUPITER_DATA||{}).diagnostics?.watchlist||[]);
      };
    });
    renderUniverseTable(filteredTokens);
  }
  async function load() {
    try {
      const r=await fetch(apiBase+"/jupiter/universe",{cache:"no-store",headers:{Accept:"application/json"}});
      if(!r.ok) throw new Error(r.status+" "+r.statusText);
      const data=await r.json();
      tokens=Array.isArray(data.tokens)?data.tokens:[];
      window.MEMELAB_JUPITER_TOKENS=tokens;
      ingestCount=Number(data.ingest_count)||0;
      window.MEMELAB_JUPITER_DATA=data;
      render();
      if(selectedMint && window.MEMELAB_MARKET?.updateLive){
        const liveToken=tokens.find(t=>t.mint===selectedMint);
        if(liveToken) window.MEMELAB_MARKET.updateLive(liveToken);
      }
    } catch(e) {
      console.error("MemeLab Jupiter feed:",e);
      const scan=$("#scan-time"); if(scan) scan.textContent="Jupiter feed unavailable";
    }
  }

  document.querySelectorAll(".nav-btn[data-view]").forEach(btn=>btn.addEventListener("click",()=>{
    const view=btn.dataset.view, watch=$("#watchlist-panel"), discovery=document.querySelector(".discovery");
    if(watch) watch.hidden=view!=="watchlist";
    if(discovery) discovery.hidden=view==="watchlist";
  }));
  window.MEMELAB_JUPITER={refresh:load,active:true};
  load();
  setInterval(load,5000);
})();