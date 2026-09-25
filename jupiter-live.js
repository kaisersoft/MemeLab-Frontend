/* MemeLab Jupiter mainnet feed presentation.
   Jupiter API access stays server-side; the browser consumes MemeLab's proxy. */
(() => {
  const apiBase = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
  let tokens = [];
  let ingestCount = 0;
  let discoveryRunning = false;
  let discoveryPollTimer = null;
  let selectedMint = null;
  let lifecycleFilter = "DISCOVERED";
  const LIFECYCLE_STAGES = ["DISCOVERED","EMERGING","ACTIVE","MATURE","DECLINING","INACTIVE","ARCHIVED"];
  const $ = (s) => document.querySelector(s);
  const shortMint = (m) => !m ? "—" : m.length <= 14 ? m : m.slice(0,7)+"…"+m.slice(-5);
  const score = (v) => Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
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

  const currentMarketState = (t) => t?.current_market_state || null;
  const coreScores = (t) => {
    const s=currentMarketState(t);
    if(!s) return {market:null,momentum:null,risk:null,activity:null,core:null};
    return {
      market:num(s.market_score),
      momentum:num(s.momentum_score),
      risk:num(s.risk_score),
      activity:num(s.activity_score),
      core:num(s.core_score)
    };
  };

  let engineTimer=null;
  let engineIntervalMs=5000;
  let engineCandidates=[];
  let engineWatchlistSize=25;
  let engineCursor=0;
  let engineSelectedMint=null;
  let engineScannedAt=0;
  let watchlistStateTimer=null;

  function engineNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function engineUsd(v){const n=engineNum(v);if(n==null)return "—";if(Math.abs(n)>=1e6)return "$"+(n/1e6).toFixed(2)+"M";if(Math.abs(n)>=1e3)return "$"+(n/1e3).toFixed(1)+"K";if(Math.abs(n)>=1)return "$"+n.toFixed(2);return "$"+n.toExponential(2);}
  function enginePct(v){const n=engineNum(v);return n==null?"—":(n>0?"+":"")+n.toFixed(2)+"%";}

  function engineStats(t){
    const m=currentMarketState(t);
    if(!m){
      return {
        price:null,volume:null,buy:null,sell:null,flow:null,traders:null,buys:null,sells:null,
        momentum:null,activity:null,volatility:null,liquidity:null,dataReady:false,marketAgeSeconds:null,priceAgeSeconds:null
      };
    }
    const snapshotPrice=engineNum(m.price_usd);
    const livePriceObservedAt=engineNum(t?._tradingPriceObservedAt);
    const livePriceFresh=livePriceObservedAt!=null && (Date.now()/1000-livePriceObservedAt)<=15;
    const livePrice=livePriceFresh ? engineNum(t?.price_usd) : null;
    const currentPrice=livePrice!=null&&livePrice>0?livePrice:snapshotPrice;
    const momentum=currentPrice!=null&&snapshotPrice!=null&&snapshotPrice>0&&livePrice!=null
      ? ((currentPrice/snapshotPrice)-1)*100
      : engineNum(m.momentum_pct);
    return {
      price:currentPrice,
      volume:engineNum(m.volume_24h_usd),
      buy:engineNum(m.buy_volume_24h_usd),
      sell:engineNum(m.sell_volume_24h_usd),
      flow:engineNum(m.flow_delta_24h_usd),
      traders:engineNum(m.traders_24h),
      buys:engineNum(m.buys_24h),
      sells:engineNum(m.sells_24h),
      momentum,
      activity:engineNum(m.activity_delta_pct),
      volatility:engineNum(m.volatility_pct),
      liquidity:engineNum(m.liquidity_usd),
      dataReady:Boolean(m.data_ready),
      marketAgeSeconds:engineNum(m.age_seconds),
      priceAgeSeconds:livePriceFresh ? Math.max(0,Date.now()/1000-livePriceObservedAt):null
    };
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
    const directional=score>=3?"BUY":score<=-3?"SELL":score!==0?"WATCH":"HOLD";
    // A BUY is only actionable when the current market state is complete and
    // short-term momentum confirms the direction. Neutral/missing momentum must
    // never be promoted to BUY by stale 24h activity/flow data.
    const signal=!s.dataReady?"HOLD":(directional==="BUY"&&s.momentum!=null&&s.momentum>0?"BUY":directional);
    let entry=null,stop=null,take=null,rr=null;
    if((signal==="BUY"||signal==="SELL")&&s.price!=null){
      entry=s.price;
      const riskPct=Math.min(0.08,Math.max(0.015,(s.volatility!=null?s.volatility/1000:0.025)));
      if(signal==="BUY"){stop=entry*(1-riskPct);take=entry*(1+riskPct*2);rr=2;}
      else {stop=entry*(1+riskPct);take=entry*(1-riskPct*2);rr=2;}
    }
    if(!s.dataReady) reasons.unshift("Fresh short-term market state unavailable");
    return {signal,strength,entry,stop,take,rr,reasons,s};
  }
  function engineMatureCandidates(){
    const all=Array.isArray(window.MEMELAB_JUPITER_TOKENS)?window.MEMELAB_JUPITER_TOKENS:[];
    // The Engine universe is the monitored MATURE/DECLINING pool that carries
    // the shared current_market_state. Tokens outside that pool cannot provide
    // the common market state required for reliable entry evaluation.
    const mature=all.filter(t=>
      ["MATURE","DECLINING"].includes(String(t?.lifecycle||"").toUpperCase()) &&
      t?.current_market_state!=null
    );
    const permanent=mature.filter(t=>t?.permanent===true);
    const ranked=mature.map(t=>({t,core:engineNum(t?.current_market_state?.core_score)}))
      .sort((a,b)=>(b.core??-1)-(a.core??-1));
    const regular=ranked.filter(x=>x.t?.permanent!==true)
      .slice(0,Math.max(0,engineWatchlistSize-permanent.length))
      .map(x=>x.t);
    return [...regular,...permanent].slice(0,engineWatchlistSize);
  }
  function engineRender(){
    const body=$("#engine-table-body"), count=$("#engine-candidate-count");
    if(!body)return;
    engineCandidates=engineMatureCandidates();
    if(count)count.textContent=String(engineCandidates.length);
    const cycle=$("#engine-cycle");if(cycle)cycle.textContent="0 / "+engineCandidates.length;
    if(!engineCandidates.length){body.innerHTML='<tr><td colspan="12" class="engine-empty">No monitored MATURE / DECLINING candidates available.</td></tr>';return;}
    body.innerHTML=engineCandidates.map((t,i)=>{
      const e=engineSignal(t), s=e.s, selected=t.mint===engineSelectedMint;
      const core=engineNum(t.current_market_state?.core_score);
      return '<tr data-engine-mint="'+t.mint+'" class="'+(selected?"selected":"")+'">'+
        '<td>'+(i+1)+'</td><td><span class="engine-token">'+(t.symbol||"—")+'</span><br><span class="engine-symbol">'+(t.name||"")+'</span></td>'+
        '<td>'+(core!=null?Math.round(core):"—")+'</td><td>'+engineUsd(s.price)+'</td><td>'+engineUsd(s.flow)+'</td><td>'+engineUsd(s.volume)+'</td>'+
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
    const universe=$("#engine-watchlist-size");
    if(universe){
      universe.value=String(engineWatchlistSize);
      universe.addEventListener("change",()=>{
        const next=Number(universe.value);
        if(Number.isFinite(next)&&[10,25,50].includes(next)){
          engineWatchlistSize=next;
          engineCursor=0;
          engineSelectedMint=null;
          engineRender();
          window.dispatchEvent(new CustomEvent("memelab:engine-universe-changed",{detail:{size:engineWatchlistSize}}));
        }
      });
    }
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
  function renderDiscoveryState(){const state=$("#discovery-state"),button=$("#discovery-toggle"),scan=$("#scan-time");if(state){state.textContent=discoveryRunning?"RUNNING":"OFF";state.classList.toggle("running",discoveryRunning);}if(button){button.textContent=discoveryRunning?"STOP DISCOVERY":"START DISCOVERY";button.setAttribute("aria-pressed",discoveryRunning?"true":"false");button.classList.toggle("running",discoveryRunning);}if(scan&&!discoveryRunning&&window.MEMELAB_JUPITER_DATA?.feed!=="discovery_scope")scan.textContent="Persistent dataset · discovery off";}
  function applyCurrentMarketStates(stateRows){
    const map=new Map((Array.isArray(stateRows)?stateRows:[]).map(row=>[row?.mint,row?.current_market_state||null]));
    window.MEMELAB_JUPITER_TOKENS=(Array.isArray(window.MEMELAB_JUPITER_TOKENS)?window.MEMELAB_JUPITER_TOKENS:[]).map(token=>({
      ...token,
      current_market_state:map.has(token?.mint)&&map.get(token?.mint)!=null?map.get(token.mint):token?.current_market_state||null
    }));
    tokens=window.MEMELAB_JUPITER_TOKENS;
    if(selectedMint){
      const selected=tokens.find(t=>t.mint===selectedMint);
      if(selected && window.MEMELAB_MARKET?.updateLive) window.MEMELAB_MARKET.updateLive(selected);
    }
    render();
    if(!document.getElementById("engine-panel")?.hidden) engineRender();
    window.dispatchEvent(new CustomEvent("memelab:jupiter-data",{detail:{tokens,diagnostics:{watchlist:stateRows||[]}}}));
  }

  async function refreshWatchlistState(){
    try{
      const r=await fetch(apiBase+"/jupiter/watchlist-state",{cache:"no-store",headers:{Accept:"application/json"}});
      if(!r.ok) throw new Error(r.status+" "+r.statusText);
      const data=await r.json();
      applyCurrentMarketStates(data?.watchlist||[]);
    }catch(e){
      console.debug("Watchlist market state refresh:",e);
    }
  }

  async function load() {
    try {
      const r=await fetch(apiBase+"/jupiter/universe",{cache:"no-store",headers:{Accept:"application/json"}});
      if(!r.ok) throw new Error(r.status+" "+r.statusText);
      const data=await r.json();
      const states=new Map((data?.diagnostics?.watchlist||[]).map(row=>[row?.mint,row?.current_market_state||null]));
      tokens=(Array.isArray(data.tokens)?data.tokens:[]).map(token=>({
        ...token,
        current_market_state:states.get(token?.mint)||token?.current_market_state||null
      }));
      window.MEMELAB_JUPITER_TOKENS=tokens;
      ingestCount=Number(data.ingest_count)||0;
      window.MEMELAB_JUPITER_DATA=data;
      if(typeof data.discovery_running === "boolean") discoveryRunning=data.discovery_running;
      renderDiscoveryState();
      window.dispatchEvent(new CustomEvent("memelab:jupiter-data",{detail:{...data,tokens}}));
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
  async function refreshDiscoveryState(){try{const r=await fetch(apiBase+"/discovery/status",{cache:"no-store",headers:{Accept:"application/json"}});if(!r.ok)throw new Error(r.status+" "+r.statusText);const data=await r.json();discoveryRunning=!!data.running;renderDiscoveryState();if(discoveryRunning){await load();if(!discoveryPollTimer)discoveryPollTimer=setInterval(load,5000);}else{if(discoveryPollTimer)clearInterval(discoveryPollTimer);discoveryPollTimer=null;await load();}}catch(e){console.debug("Discovery status:",e);}}
  async function toggleDiscovery(){const action=discoveryRunning?"stop":"start";try{const r=await fetch(apiBase+"/discovery/"+action,{method:"POST",cache:"no-store",headers:{Accept:"application/json"}});if(!r.ok)throw new Error(r.status+" "+r.statusText);discoveryRunning=action==="start";renderDiscoveryState();if(discoveryRunning){await load();if(!discoveryPollTimer)discoveryPollTimer=setInterval(load,5000);}else{if(discoveryPollTimer)clearInterval(discoveryPollTimer);discoveryPollTimer=null;await load();}}catch(e){console.error("Discovery toggle:",e);}}
  const discoveryToggle=$("#discovery-toggle");if(discoveryToggle)discoveryToggle.addEventListener("click",toggleDiscovery);renderDiscoveryState();refreshDiscoveryState();
  if(!watchlistStateTimer) watchlistStateTimer=setInterval(refreshWatchlistState,30000);
  refreshWatchlistState();

  window.MEMELAB_ENGINE={
    getCandidates:()=>engineMatureCandidates(),
    signal:(t)=>engineSignal(t),
    isRunning:()=>!!engineTimer
  };
  window.MEMELAB_JUPITER={refresh:load,active:true};

})();