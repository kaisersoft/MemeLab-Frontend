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
  const clamp = (v,min=0,max=100) => {
    const n=Number(v);
    return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : null;
  };
  const num = (v) => {
    const n=Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const logScore = (v,min,max) => {
    const n=num(v);
    if(n==null || n<=0) return null;
    return clamp((Math.log10(Math.max(n,min))-Math.log10(min))/(Math.log10(max)-Math.log10(min))*100);
  };
  const metricFor = (t) => (window.MEMELAB_POSITION_METRICS||new Map()).get(t?.mint)||{};

  const marketScore = (t) => {
    const s=stats24h(t);
    const liq=num(t?.liquidity), vol=num(s.volume), traders=num(s.num_traders);
    if(liq==null || vol==null || traders==null) return null;
    const liqScore=logScore(liq,1e3,1e8);
    const volScore=logScore(vol,1e3,1e8);
    const traderScore=logScore(traders,1,1e5);
    if(liqScore==null || volScore==null || traderScore==null) return null;
    return 0.40*liqScore+0.35*volScore+0.25*traderScore;
  };

  const momentumScore = (t) => {
    const s=stats24h(t);
    const price=num(s.price_change), volChange=num(s.volume_change), holderChange=num(s.holder_change);
    const buy=num(s.buy_volume), sell=num(s.sell_volume);
    if(price==null || volChange==null || holderChange==null || buy==null || sell==null) return null;
    const totalFlow=buy+sell;
    if(totalFlow<=0) return null;
    const flow=(buy-sell)/totalFlow;
    return 0.40*clamp((price+50)/150*100)
      +0.25*clamp((volChange+100)/400*100)
      +0.15*clamp((holderChange+50)/150*100)
      +0.20*clamp((flow+1)*50);
  };

  const activityTrendScore = (t) => {
    const change=num(stats24h(t).volume_change);
    if(change==null) return null;
    // 0% change is neutral (50/100). +/-200% spans the displayed score range.
    return clamp(50+(change/4));
  };

  const volatilityFromHistory = (points) => {
    const prices=(Array.isArray(points)?points:[])
      .map(p=>num(p?.price_usd))
      .filter(v=>v!=null && v>0);
    if(prices.length<3) return null;
    const returns=[];
    for(let i=1;i<prices.length;i++){
      if(prices[i-1]>0 && prices[i]>0) returns.push(Math.log(prices[i]/prices[i-1]));
    }
    if(returns.length<2) return null;
    const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
    const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length;
    return Math.sqrt(variance)*100;
  };

  let positionHistory=[];
  const riskScore = (t) => {
    const historyVol=volatilityFromHistory(positionHistory);
    const fallback=num(metricFor(t).volatility_24h_pct);
    const vol=historyVol!=null?historyVol:fallback;
    if(vol==null) return null;
    const liq=num(t?.liquidity);
    const change=num(stats24h(t).price_change);
    if(liq==null || change==null) return null;
    const liqRisk=logScore(liq,1e3,1e8);
    if(liqRisk==null) return null;
    const volRisk=clamp(100-(vol/20*100));
    const moveRisk=clamp(100-Math.abs(change)*2);
    if(volRisk==null || moveRisk==null) return null;
    const declining=lifecycle(t)==="DECLINING"?15:0;
    return clamp(0.50*volRisk+0.30*liqRisk+0.20*moveRisk-declining);
  };

  const coreScores = (t) => {
    const market=marketScore(t);
    const momentum=momentumScore(t);
    const risk=riskScore(t);
    const activity=activityTrendScore(t);
    if(market==null || momentum==null || risk==null || activity==null)
      return {market,momentum,risk,activity,core:null};
    // Core Score is the current market-intelligence layer. Social is deliberately
    // excluded until the separate qualitative social signal is connected.
    return {
      market,
      momentum,
      risk,
      activity,
      core:Math.round(0.30*market+0.25*momentum+0.25*risk+0.20*activity)
    };
  };


  let engineTimer=null;
  let engineIntervalMs=5000;
  let engineCandidates=[];
  let engineCursor=0;
  let engineSelectedMint=null;
  let engineScannedAt=0;

  function engineNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function engineUsd(v){const n=engineNum(v);if(n==null)return "—";if(Math.abs(n)>=1e6)return "$"+(n/1e6).toFixed(2)+"M";if(Math.abs(n)>=1e3)return "$"+(n/1e3).toFixed(1)+"K";if(Math.abs(n)>=1)return "$"+n.toFixed(2);return "$"+n.toExponential(2);}
  function enginePct(v){const n=engineNum(v);return n==null?"—":(n>0?"+":"")+n.toFixed(2)+"%";}
  function engineStats(t){
    const s=t?.stats_24h||t?.stats||{};
    const price=engineNum(t?.price_usd), volume=engineNum(s.volume), buy=engineNum(s.buy_volume), sell=engineNum(s.sell_volume);
    const traders=engineNum(s.num_traders), buys=engineNum(s.num_buys), sells=engineNum(s.num_sells);
    const flow=buy!=null&&sell!=null?buy-sell:null;
    const hist=Array.isArray(t?._engineHistory)?t._engineHistory:[];
    const last=hist.at(-1)||null, prev=hist.at(-2)||null;
    const histPrice=engineNum(last?.price_usd), histVolume=engineNum(last?.volume);
    const momentum=engineNum(t?.momentum ?? t?.momentum_score) ?? (histPrice!=null&&engineNum(prev?.price_usd)?((histPrice/Number(prev.price_usd))-1)*100:null);
    const activity=engineNum(t?.volume_change ?? s.volume_change) ?? (histVolume!=null&&engineNum(prev?.volume)?((histVolume/Number(prev.volume))-1)*100:null);
    let volatility=engineNum(t?.volatility_24h ?? t?.volatility);
    if(volatility==null&&hist.length>=3){
      const ps=hist.slice(-13).map(x=>engineNum(x?.price_usd)).filter(x=>x!=null&&x>0), rs=[];
      for(let i=1;i<ps.length;i++)rs.push(Math.log(ps[i]/ps[i-1]));
      if(rs.length){const m=rs.reduce((a,x)=>a+x,0)/rs.length;volatility=Math.sqrt(rs.reduce((a,x)=>a+(x-m)**2,0)/rs.length)*100;}
    }
    const liquidity=engineNum(t?.liquidity) ?? engineNum(last?.liquidity);
    return {price:price ?? histPrice,volume:volume ?? histVolume,buy:buy ?? engineNum(last?.buy_volume),sell:sell ?? engineNum(last?.sell_volume),flow:flow ?? engineNum(last?.net_flow),traders:traders ?? engineNum(last?.traders),buys:buys ?? engineNum(last?.buys),sells:sells ?? engineNum(last?.sells),momentum,activity,volatility,liquidity};
  }
  function engineSignal(t){
    const s=engineStats(t);
    let score=0, reasons=[];
    if(s.flow!=null&&s.flow>0){score+=2;reasons.push("Buy flow positive");} else if(s.flow!=null&&s.flow<0){score-=2;reasons.push("Sell flow dominant");}
    if(s.momentum!=null&&s.momentum>0){score+=2;reasons.push("Momentum positive");} else if(s.momentum!=null&&s.momentum<0){score-=2;reasons.push("Momentum negative");}
    if(s.activity!=null&&s.activity>0){score+=1;reasons.push("Activity increasing");} else if(s.activity!=null&&s.activity<0){score-=1;reasons.push("Activity declining");}
    if(s.traders!=null&&s.traders>0){reasons.push("Trader participation present");}
    if(s.volatility!=null&&s.volatility>25){score-=1;reasons.push("Volatility elevated");}
    const strength=Math.round(Math.min(100,Math.max(0,50+score*10)));
    const signal=score>=3?"BUY":score<=-3?"SELL":score!==0?"WATCH":"HOLD";
    let entry=null,stop=null,take=null,rr=null;
    if((signal==="BUY"||signal==="SELL")&&s.price!=null){
      entry=s.price;
      const riskPct=Math.min(0.08,Math.max(0.015,(s.volatility!=null?s.volatility/1000:0.025)));
      if(signal==="BUY"){stop=entry*(1-riskPct);take=entry*(1+riskPct*2);rr=2;}
      else {stop=entry*(1+riskPct);take=entry*(1-riskPct*2);rr=2;}
    }
    return {signal,strength,entry,stop,take,rr,reasons,s};
  }
  function engineMatureCandidates(){
    const all=Array.isArray(window.MEMELAB_JUPITER_TOKENS)?window.MEMELAB_JUPITER_TOKENS:[];
    const mature=all.filter(t=>["MATURE","DECLINING"].includes(String(t?.lifecycle||"").toUpperCase()));
    return mature.map(t=>({t,core:engineNum(t?.core_score) ?? engineNum(coreScores(t)?.core)}))
      .sort((a,b)=>(b.core??-1)-(a.core??-1))
      .slice(0,10).map(x=>x.t);
  }
  function engineRender(){
    const body=$("#engine-table-body"), count=$("#engine-candidate-count");
    if(!body)return;
    engineCandidates=engineMatureCandidates();
    if(count)count.textContent=String(engineCandidates.length);
    if(!engineCandidates.length){body.innerHTML='<tr><td colspan="12" class="engine-empty">No MATURE / DECLINING candidates available.</td></tr>';return;}
    body.innerHTML=engineCandidates.map((t,i)=>{
      const e=engineSignal(t), s=e.s, selected=t.mint===engineSelectedMint;
      return '<tr data-engine-mint="'+t.mint+'" class="'+(selected?"selected":"")+'">'+
        '<td>'+(i+1)+'</td><td><span class="engine-token">'+(t.symbol||"—")+'</span><br><span class="engine-symbol">'+(t.name||"")+'</span></td>'+
        '<td>'+(engineNum(t.core_score)!=null?Math.round(t.core_score):"—")+'</td><td>'+engineUsd(s.price)+'</td><td>'+engineUsd(s.flow)+'</td><td>'+engineUsd(s.volume)+'</td>'+
        '<td>'+(s.traders==null?"—":s.traders.toLocaleString("de-DE"))+'</td><td>'+enginePct(s.momentum)+'</td><td>'+enginePct(s.volatility)+'</td><td>'+enginePct(s.activity)+'</td>'+
        '<td class="engine-signal-cell '+e.signal.toLowerCase()+'">'+e.signal+'</td><td>'+e.strength+'</td></tr>';
    }).join("");
    body.querySelectorAll("tr[data-engine-mint]").forEach(row=>row.addEventListener("click",()=>{engineSelectedMint=row.dataset.engineMint;engineRender();engineRenderSelected();}));
    if(!engineSelectedMint&&engineCandidates[0])engineSelectedMint=engineCandidates[0].mint;
    engineRenderSelected();
  }
  function engineRenderSelected(){
    const t=engineCandidates.find(x=>x.mint===engineSelectedMint)||engineCandidates[0];
    if(!t)return;
    const e=engineSignal(t), s=e.s;
    const set=(id,v)=>{const el=$("#"+id);if(el)el.textContent=v;};
    set("engine-selected-token",(t.symbol||"—")+" · "+(t.lifecycle||"—"));
    set("engine-entry",engineUsd(e.entry));set("engine-stop",engineUsd(e.stop));set("engine-take",engineUsd(e.take));set("engine-margin","PAPER · 0");set("engine-rr",e.rr?e.rr.toFixed(1)+"R":"—");set("engine-pnl","—");
    const badge=$("#engine-signal-badge");if(badge){badge.textContent=e.signal;badge.className="engine-signal-badge "+e.signal.toLowerCase();}
    const reasons=$("#engine-reasons");if(reasons)reasons.innerHTML=e.reasons.length?e.reasons.map(x=>"✓ "+x).join("<br>"):"No directional conditions met.";
  }
  async function engineScanStep(){
    if(!engineCandidates.length)engineCandidates=engineMatureCandidates();
    if(!engineCandidates.length)return;
    engineCursor=(engineCursor+1)%engineCandidates.length;
    const t=engineCandidates[engineCursor];
    engineSelectedMint=t.mint;
    engineScannedAt=Date.now();
    const cycle=$("#engine-cycle");if(cycle)cycle.textContent=(engineCursor+1)+" / "+engineCandidates.length;
    const last=$("#engine-last-scan");if(last)last.textContent=new Date(engineScannedAt).toLocaleTimeString();
    try{
      const response=await fetch(apiBase+"/jupiter/history?mint="+encodeURIComponent(t.mint)+"&window=5m",{cache:"no-store",headers:{Accept:"application/json"}});
      if(response.ok){
        const data=await response.json();
        t._engineHistory=Array.isArray(data?.points)?data.points:[];
      }
    }catch(e){console.debug("Trading engine history scan:",e);}
    engineRender();
  }
  function engineStart(){
    if(engineTimer)clearInterval(engineTimer);
    engineIntervalMs=Number($("#engine-interval")?.value)||5000;
    const status=$("#engine-status"), wrap=status?.parentElement;
    if(status)status.textContent="SCANNING";
    if(wrap)wrap.classList.add("running");
    engineRender();
    engineTimer=setInterval(engineScanStep,engineIntervalMs);
  }
  function engineStop(){
    if(engineTimer)clearInterval(engineTimer);
    engineTimer=null;
    const status=$("#engine-status"), wrap=status?.parentElement;
    if(status)status.textContent="READY";
    if(wrap)wrap.classList.remove("running");
  }
  function engineInit(){
    const select=$("#engine-interval");if(select)select.addEventListener("change",engineStart);
    engineRender();
    engineStart();
  }

  let universeOpen = false;
  let sortKey = "candidate";
  let sortDir = "desc";
  let watchlistSortKey = "organic";
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
    if(key==="liquidity") return Number(t.liquidity||0);
    if(key==="volume") return Number(s.volume||0);
    if(key==="organic") return Number(t.organic_score||0);
      if(key==="name") return String(t.name||"").toLowerCase();
      if(key==="lifecycle") return lifecycle(t);
    if(key==="liquidity") return Number(t.liquidity||0);
    if(key==="volume") return Number(s.volume||0);
    if(key==="organic") return Number(t.organic_score||0);
      if(key==="discovery_status") return String(t.discovery_status||"");
      if(key==="history") return Number(t.history?.observations||0);
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
    const db=d.db||{};
    const fmtInt=(v)=>Number.isFinite(Number(v))?Number(v).toLocaleString("de-DE"):"—";
    const fmtMb=(v)=>Number.isFinite(Number(v))?Number(v).toFixed(2)+" MB":"—";
    set("#dbg-db-size",fmtMb(db.db_size_mb));
    set("#dbg-db-raw",fmtInt(db.raw_snapshots));
    set("#dbg-db-5m",fmtInt(db.aggregates_5m));
    set("#dbg-db-1h",fmtInt(db.aggregates_1h));
    set("#dbg-db-1d",fmtInt(db.aggregates_1d));
    set("#dbg-db-highres",fmtInt(db.high_res_tokens));
    set("#dbg-db-share",Number.isFinite(Number(db.high_res_share_percent))?Number(db.high_res_share_percent).toFixed(2)+"%":"—");
    set("#dbg-db-housekeeping",db.last_housekeeping_at?new Date(Number(db.last_housekeeping_at)*1000).toLocaleTimeString():"waiting");
    set("#dbg-db-oldraw",fmtInt(db.raw_older_than_15m));
    set("#dbg-db-oldraw24",fmtInt(db.raw_older_than_24h));
    set("#dbg-db-oldraw-low",fmtInt(db.raw_older_than_15m_low_priority));
    const hk=db.housekeeping||{};
    set("#dbg-db-hk-deleted",fmtInt(hk.raw_deleted));
    set("#dbg-db-hk-backlog",fmtInt(hk.raw_backlog_before));
  }


  function render() {
    const grid=$(".token-grid");
    if (!grid) return;
    const filteredTokens = tokens.filter(t => lifecycle(t) === lifecycleFilter);
    if (!selectedMint || !tokens.some(t => t.mint === selectedMint)) {
      selectedMint = filteredTokens[0]?.mint || null;
    }

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
    window.MEMELAB_POSITION_METRICS=new Map((window.MEMELAB_JUPITER_DATA?.diagnostics?.watchlist||[]).map(t=>[t.mint,t.market_metrics||{}]));
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
    const intelligence=$("#score"), selectedScores=selected?coreScores(selected):null; if(intelligence) intelligence.textContent=selectedScores?.core==null?"— / 100":selectedScores.core+" / 100"; const setScoreMetric=(id,value)=>{const el=$("#"+id);if(!el)return;el.textContent=value==null?"—":Math.round(value);const bar=el.parentElement?.nextElementSibling?.querySelector("em");if(bar)bar.style.width=value==null?"0%":clamp(value)+"%";}; setScoreMetric("m-liq",selectedScores?.market);setScoreMetric("m-vol",selectedScores?.momentum);setScoreMetric("m-holder",selectedScores?.risk);setScoreMetric("m-activity",selectedScores?.activity);setScoreMetric("m-social",null);setScoreMetric("m-risk",selectedScores?.core);
    const scoreToken=$("#score-token"); if(scoreToken) scoreToken.textContent=selected?.symbol || "—";
    if(selected){
      const s=stats24h(selected);
      const observations=Number(selected?.history?.observations||0);
      const known=observations>0;
      const labels={"#m-liq":"Market","#m-vol":"Momentum","#m-holder":"Risk","#m-activity":"Activity Trend","#m-social":"Social","#m-risk":"Core Score"};Object.entries(labels).forEach(([sel,label])=>{const el=$(sel);if(el?.parentElement?.firstChild)el.parentElement.firstChild.textContent=label+" ";});
    }
    const stage=document.querySelectorAll(".life");
    const lifecycleCounts = Object.fromEntries(LIFECYCLE_STAGES.map(stage => [stage, tokens.filter(t => lifecycle(t) === stage).length]));
    if(window.renderLifecycleOverview) window.renderLifecycleOverview(tokens);
    stage.forEach((el,i)=>{
      const stageName=LIFECYCLE_STAGES[i];
      el.classList.toggle("active", lifecycleFilter===stageName);
      el.setAttribute("aria-selected", lifecycleFilter===stageName ? "true" : "false");
      const count=el.querySelector(".life-count");
      if(count) count.textContent=String(lifecycleCounts[stageName]||0);
      el.onclick=()=>{ lifecycleFilter=stageName; selectedMint=null; render(); };
    });

    renderDiagnostics(window.MEMELAB_JUPITER_DATA||{});
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
      window.dispatchEvent(new CustomEvent("memelab:jupiter-data",{detail:data}));
      render();
      if(!document.getElementById("engine-panel")?.hidden) engineRender();
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
    const view=btn.dataset.view;
    const discovery=document.querySelector(".discovery");
    const watch=$("#watchlist-panel");
    const position=$("#position-panel"), engine=$("#engine-panel");
    if(discovery) discovery.hidden=view!=="memelab";
    if(watch) watch.hidden=view!=="watchlist";
    if(position) position.hidden=view!=="position";
    if(engine) engine.hidden=view!=="engine";
    if(view==="engine"){ engineInit(); } else { engineStop(); }
    if(view==="position" && window.MEMELAB_MARKET?.selectToken){
      const mature=tokens.filter(t=>lifecycle(t)==="MATURE"||lifecycle(t)==="DECLINING");
      const target=mature.find(t=>t.mint===selectedMint)||mature[0];
      if(target){
        selectedMint=target.mint;
        window.MEMELAB_MARKET.selectToken(target.mint);
      }
    }
  }));
  window.addEventListener("memelab:market-token-selected",e=>{
    const mint=e.detail?.mint;
    if(!mint) return;
    selectedMint=mint;
    render();
  });
  window.addEventListener("memelab:market-history",e=>{
    if(e.detail?.mint!==selectedMint) return;
    positionHistory=Array.isArray(e.detail?.points)?e.detail.points:[];
    render();
  });
  window.MEMELAB_JUPITER={refresh:load,active:true};
  load();
  setInterval(load,5000);
})();