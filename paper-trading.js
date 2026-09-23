(() => {
  const START_CAPITAL = 10000;
  let threshold = 3;
  let riskPct = 2;
  let capitalLimitPct = 20;
  let portfolioLimitPct = 50;
  let positions = [];
  let journal = [];
  let lastSignals = [];
  let paperRunning = false;
  const $ = s => document.querySelector(s);
  const usd = v => Number.isFinite(Number(v)) ? "$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—";
  const pct = v => Number.isFinite(Number(v)) ? (Number(v)>=0?"+":"")+Number(v).toFixed(2)+"%" : "—";
  const price = v => {
    const n=Number(v); if(!Number.isFinite(n)) return "—";
    if(Math.abs(n)>=1) return "$"+n.toFixed(4);
    return "$"+n.toExponential(3);
  };
  const now=()=>Date.now();
  const MAX_POSITIONS_PER_TOKEN = 1;
  const TP_R = 2;
  const SL_R = 1;

  function realizedPnl(){ return journal.reduce((s,p)=>s+Number(p.pnl||0),0); }
  function investedCapital(){ return positions.reduce((s,p)=>s+(Number(p.entry)||0)*(Number(p.qty)||0),0); }
  function availableCash(){ return Math.max(0,START_CAPITAL+realizedPnl()-investedCapital()); }
  function liveToken(mint){
    const list=window.MEMELAB_JUPITER_TOKENS||[];
    return list.find(t=>t?.mint===mint)||null;
  }
  function currentPrice(p){
    const live=liveToken(p.mint);
    const n=Number(live?.price_usd);
    if(Number.isFinite(n)&&n>0){p.t=live;return n;}
    const fallback=Number(p.t?.price_usd);
    return Number.isFinite(fallback)&&fallback>0?fallback:Number(p.entry)||null;
  }

  function openPaperPosition(x, options={}){
    const manual=!!options.manual;
    if(!paperRunning && !manual) return false;
    const t=x.t, e=x.e||{};
    if((!manual && e.signal!=="BUY") || (!manual && Number(e.strength)<Number(threshold))) return false;
    if(e.entry==null || e.stop==null || e.take==null || Number(e.entry)<=0 || Number(e.stop)>=Number(e.entry)) return false;
    const existing=positions.some(p=>p.mint===t.mint);
    if(existing) return false;
    const equity=START_CAPITAL+realizedPnl()+positions.reduce((s,p)=>s+(currentPrice(p)-p.entry)*p.qty,0);
    const riskAmount=Math.max(0,equity*(Number(riskPct)/100));
    const unitRisk=Number(e.entry)-Number(e.stop);
    if(riskAmount<=0 || unitRisk<=0) return false;
    let qty=riskAmount/unitRisk;
    const maxAffordable=availableCash()/Number(e.entry);
    const maxCapital=equity*(Number(capitalLimitPct)/100);
    const maxByCapital=maxCapital/Number(e.entry);
    const portfolioCapitalLimit=equity*(Number(portfolioLimitPct)/100);
    const remainingPortfolioCapital=Math.max(0,portfolioCapitalLimit-investedCapital());
    const maxByPortfolio=remainingPortfolioCapital/Number(e.entry);
    qty=Math.min(qty,maxAffordable,maxByCapital,maxByPortfolio);
    if(!Number.isFinite(qty)||qty<=0) return false;
    const actualRisk=qty*unitRisk;
    positions.push({
      mint:t.mint,symbol:t.symbol||t.name||"—",name:t.name||"",
      entry:Number(e.entry),stop:Number(e.stop),take:Number(e.take),qty,
      riskAmount:actualRisk,size:qty*Number(e.entry),openedAt:now(),
      positionId:"POS-"+t.mint+"-"+now(),t
    });
    postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"POSITION_OPEN",
      mint:t.mint,
      position_id:positions[positions.length-1].positionId,
      payload:{symbol:t.symbol||t.name||null,entry:Number(e.entry),stop:Number(e.stop),take:Number(e.take),qty:Number(qty),capital:Number(qty*Number(e.entry)),risk:Number(actualRisk),reason:manual?"MANUAL_BUY":"SIGNAL"}
    }]);
    return true;
  }

  function manualSell(p){
    const current=currentPrice(p);
    if(current==null) return false;
    closePaperPosition(p,current,"MANUAL SELL");
    return true;
  }

  function closePaperPosition(p, exitPrice, reason){
    const exit=Number(exitPrice);
    if(!Number.isFinite(exit)||exit<=0) return;
    const pnl=(exit-p.entry)*p.qty;
    const size=p.entry*p.qty;
    journal.push({
      id:"PT-"+String(journal.length+1).padStart(4,"0"),
      mint:p.mint,symbol:p.symbol,entryPriceText:price(p.entry),exitPriceText:price(exit),
      reason,size,pnl,pnlPct:size?((pnl/size)*100):0,
      durationMs:Math.max(0,now()-p.openedAt),entry:p.entry,exit,qty:p.qty
    });
    postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"POSITION_CLOSE",
      mint:p.mint,
      position_id:p.positionId||p.mint,
      payload:{symbol:p.symbol,entry:Number(p.entry),exit:Number(exit),qty:Number(p.qty),capital:Number(size),pnl:Number(pnl),pnl_pct:Number(size?((pnl/size)*100):0),reason}
    }]);
    positions=positions.filter(x=>x!==p);
  }

  function manageOpenPositions(){
    for(const p of [...positions]){
      const current=currentPrice(p);
      if(current==null) continue;
      if(current<=p.stop){ closePaperPosition(p,p.stop,"STOP LOSS"); continue; }
      if(current>=p.take){ closePaperPosition(p,p.take,"TAKE PROFIT"); continue; }
      p.t=p.t;
    }
  }

  function executePaperCycle(){
    manageOpenPositions();
    if(!paperRunning) return;
    const rows=signalRows();
    for(const x of rows) openPaperPosition(x);
  }

  function manualBuy(t){
    if(!t?.mint) return false;
    if(positions.some(p=>p.mint===t.mint)) return false;
    const entry=Number(t.price_usd);
    if(!Number.isFinite(entry)||entry<=0) return false;
    const engine=window.MEMELAB_ENGINE;
    const engineSignal=engine?.signal?.(t)||{};
    const volatility=Number(engineSignal?.s?.volatility);
    const riskDistance=Math.max(0.015,Math.min(0.08,(Number.isFinite(volatility)&&volatility>0?volatility/1000:0.025)));
    const e={signal:"BUY",strength:100,entry,stop:entry*(1-riskDistance),take:entry*(1+riskDistance*TP_R),rr:TP_R,reasons:["MANUAL BUY"]};
    return openPaperPosition({t,e},{manual:true});
  }

  function signalRows(){
    const engine=window.MEMELAB_ENGINE;
    const candidates=engine?.getCandidates?.()||[];
    return candidates.map((t,i)=>{
      const e=engine?.signal?.(t);
      return {t,e,index:i};
    });
  }

  function postTradingEvents(events){
    if(!events.length) return;
    const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
    fetch(apiBase+"/trading/events",{
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({events})
    }).catch(()=>{});
  }

  function captureTradingState(){
    if(!paperRunning) return;
    const ts=Date.now()/1000;
    const events=[];
    for(const x of lastSignals){
      const t=x.t||{}, e=x.e||{}, s=e.s||{};
      events.push({
        event_id:crypto.randomUUID(),
        observed_at:ts,
        event_type:"MARKET_STATE",
        mint:t.mint,
        payload:{
          symbol:t.symbol||t.name||null,
          price_usd:Number(t.price_usd)||null,
          liquidity:Number(t.liquidity)||null,
          stats_24h:t.stats_24h||null,
          lifecycle:t.lifecycle||null,
          core_score:Number(t.core_score)||null,
          signal:e.signal||null,
          strength:Number(e.strength)||null
        }
      });
      events.push({
        event_id:crypto.randomUUID(),
        observed_at:ts,
        event_type:"SIGNAL",
        mint:t.mint,
        payload:{
          signal:e.signal||null,
          strength:Number(e.strength)||null,
          entry:Number(e.entry)||null,
          stop:Number(e.stop)||null,
          take:Number(e.take)||null,
          reasons:e.reasons||[],
          core_score:Number(t.core_score)||null,
          market:s
        }
      });
    }
    for(const p of positions){
      const current=currentPrice(p);
      events.push({
        event_id:crypto.randomUUID(),
        observed_at:ts,
        event_type:"POSITION_STATE",
        mint:p.mint,
        position_id:p.positionId||p.mint,
        payload:{
          symbol:p.symbol,
          entry:Number(p.entry),
          current:Number(current)||null,
          qty:Number(p.qty),
          capital:Number(p.size),
          stop:Number(p.stop),
          take:Number(p.take),
          unrealized_pnl:Number(current&&p.qty?(current-p.entry)*p.qty:0),
          age_seconds:Math.max(0,(Date.now()-p.openedAt)/1000)
        }
      });
    }
    postTradingEvents(events);
  }

  function updatePaperControl(){
    const status=$("#paper-status");
    const btn=$("#paper-start-stop");
    if(btn){btn.textContent=paperRunning?"STOP PAPER":"START PAPER";btn.classList.toggle("running",paperRunning);}
    if(status) status.textContent=paperRunning
      ? "PAPER ENGINE RUNNING · new trades may be opened when BUY signals meet the configured threshold."
      : "PAPER ENGINE STOPPED · signals are monitored, but no new paper trades will be opened.";
  }

  function renderSignals(){
    const body=$("#paper-signal-body"); if(!body)return;
    lastSignals=signalRows();
    $("#paper-signal-count")?.replaceChildren(document.createTextNode(String(lastSignals.length)));
    body.innerHTML=lastSignals.length ? lastSignals.map(x=>{
      const e=x.e||{},t=x.t;
      const eligible=e.signal==="BUY" && e.strength>=threshold;
      return '<tr class="'+(eligible?"paper-eligible":"")+'"><td>'+(x.index+1)+'</td><td><strong>'+(t.symbol||"—")+'</strong><small>'+(t.name||"")+'</small></td><td class="paper-signal '+String(e.signal||"").toLowerCase()+'">'+(e.signal||"—")+'</td><td>'+ (e.strength??"—") +'</td><td>'+price(e.entry)+'</td><td>'+price(e.stop)+'</td><td>'+price(e.take)+'</td><td>'+((Number(t.core_score)||0)||"—")+'</td><td>'+new Date().toLocaleTimeString()+'</td></tr>';
    }).join("") : '<tr><td colspan="9" class="paper-empty">No Top 10 Mature candidates available.</td></tr>';
  }

  function renderPositions(){
    const body=$("#paper-position-body"); if(!body)return;
    $("#paper-position-count").textContent=String(positions.length);
    const invested=investedCapital();
    const cash=availableCash();
    const unrealized=positions.reduce((s,p)=>s+((currentPrice(p)||p.entry)-p.entry)*p.qty,0);
    const openPnlEl=$("#paper-open-pnl");
    if(openPnlEl){openPnlEl.textContent="Unrealized P&L · "+usd(unrealized);openPnlEl.classList.toggle("paper-positive",unrealized>=0);openPnlEl.classList.toggle("paper-negative",unrealized<0);}
    const cashEl=$("#paper-cash"), investedEl=$("#paper-invested"), cashDetail=$("#paper-cash-detail"), investedDetail=$("#paper-invested-detail");
    if(cashEl) cashEl.textContent=usd(cash);
    if(investedEl) investedEl.textContent=usd(invested);
    if(cashDetail) cashDetail.textContent="Unallocated · "+(((START_CAPITAL+realizedPnl())>0)?((cash/(START_CAPITAL+realizedPnl()))*100).toFixed(1):"0.0")+"%";
    if(investedDetail) investedDetail.textContent=positions.length+" open position"+(positions.length===1?"":"s");
    body.innerHTML=positions.length?positions.map(p=>{
      const current=currentPrice(p)||p.entry;
      const pnl=(current-p.entry)*p.qty;
      return '<tr><td><strong>'+p.symbol+'</strong></td><td>'+price(p.entry)+'</td><td>'+price(current)+'</td><td>'+p.qty.toFixed(4)+'</td><td>'+usd(p.size)+'</td><td>'+price(p.stop)+'</td><td>'+price(p.take)+'</td><td class="'+(pnl>=0?"paper-positive":"paper-negative")+'">'+usd(pnl)+'</td><td>'+Math.max(0,Math.round((now()-p.openedAt)/60000))+'m</td><td><button type="button" class="paper-sell-now" data-position-id="'+(p.positionId||'')+'">SELL NOW</button></td></tr>';
    }).join(""):'<tr><td colspan="10" class="paper-empty">No open paper positions.</td></tr>';
    body.querySelectorAll(".paper-sell-now").forEach(btn=>btn.addEventListener("click",()=>{const p=positions.find(x=>(x.positionId||"")===btn.dataset.positionId);if(p&&manualSell(p))renderAll();}));
  }

  function renderJournal(){
    const body=$("#paper-journal-body"), pnlBody=$("#pnl-history-body");
    const html=journal.length?journal.slice().reverse().map(p=>'<tr><td>'+p.id+'</td><td><strong>'+p.symbol+'</strong></td><td>'+p.entryPriceText+'</td><td>'+p.exitPriceText+'</td><td>'+p.reason+'</td><td>'+usd(p.size)+'</td><td class="'+(p.pnl>=0?"paper-positive":"paper-negative")+'">'+usd(p.pnl)+'</td><td class="'+(p.pnl>=0?"paper-positive":"paper-negative")+'">'+pct(p.pnlPct)+'</td><td>'+Math.round(p.durationMs/60000)+'m</td></tr>').join(""):'<tr><td colspan="9" class="paper-empty">No closed paper trades yet.</td></tr>';
    if(body){body.innerHTML=html;$("#paper-journal-count").textContent=String(journal.length);}
    if(pnlBody)pnlBody.innerHTML=journal.length?journal.slice().reverse().map(p=>'<tr><td>'+p.id+'</td><td><strong>'+p.symbol+'</strong></td><td>BUY</td><td>'+p.entryPriceText+'</td><td>'+p.exitPriceText+'</td><td>'+p.reason+'</td><td class="'+(p.pnl>=0?"paper-positive":"paper-negative")+'">'+usd(p.pnl)+'</td><td>'+pct(p.pnlPct)+'</td></tr>').join(""):'<tr><td colspan="8" class="paper-empty">No closed trades recorded.</td></tr>';
  }

  function renderPnl(){
    const realized=journal.reduce((s,p)=>s+p.pnl,0);
    const open=positions.reduce((s,p)=>s+((currentPrice(p)||p.entry)-p.entry)*p.qty,0);
    $("#pnl-start").textContent=usd(START_CAPITAL);
    $("#pnl-equity").textContent=usd(START_CAPITAL+realized+open);
    $("#pnl-cash").textContent=usd(availableCash());
    $("#pnl-invested").textContent=usd(investedCapital());
    $("#pnl-realized").textContent=usd(realized);
    $("#pnl-open").textContent=usd(open);
    $("#pnl-trades").textContent=String(journal.length);
    $("#pnl-winrate").textContent=journal.length?((journal.filter(x=>x.pnl>0).length/journal.length)*100).toFixed(1)+"%":"—";
  }

  function renderAll(){
    executePaperCycle();
    renderSignals();
    renderPositions();
    renderJournal();
    renderPnl();
    captureTradingState();
  }

  function init(){
    const sel=$("#paper-threshold");
    if(sel)sel.addEventListener("change",()=>{threshold=Number(sel.value)||3;renderSignals();});
    const risk=$("#paper-risk");
    if(risk)risk.addEventListener("change",()=>{riskPct=Number(risk.value)||2;renderSignals();});
    const capitalLimit=$("#paper-capital-limit");
    if(capitalLimit)capitalLimit.addEventListener("change",()=>{capitalLimitPct=Number(capitalLimit.value)||20;renderAll();});
    const portfolioLimit=$("#paper-portfolio-limit");
    if(portfolioLimit)portfolioLimit.addEventListener("change",()=>{portfolioLimitPct=Number(portfolioLimit.value)||50;renderAll();});
    const startStop=$("#paper-start-stop");
    if(startStop) startStop.addEventListener("click",()=>{paperRunning=!paperRunning;updatePaperControl();});
    document.querySelectorAll(".nav-btn[data-view]").forEach(btn=>btn.addEventListener("click",()=>{
      const view=btn.dataset.view;
      const paper=$("#paper-panel"), pnl=$("#pnl-panel");
      if(paper)paper.hidden=view!=="paper";
      if(pnl)pnl.hidden=view!=="pnl";
      if(view==="paper"||view==="pnl")renderAll();
    }));
    window.addEventListener("memelab:jupiter-data",renderAll);
    renderAll();
    updatePaperControl();
    setInterval(()=>{if(!$("#paper-panel")?.hidden||!$("#pnl-panel")?.hidden){renderAll();}},5000);
  }
  window.MEMELAB_PAPER={render:renderAll,state:()=>({positions,journal,threshold,riskPct,capitalLimitPct,portfolioLimitPct,paperRunning}),isRunning:()=>paperRunning,manualBuy,manualSell};
  init();
})();