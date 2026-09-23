(() => {
  const START_CAPITAL = 10000;
  let threshold = 3;
  let riskPct = 2;
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
  function currentPrice(p){ return Number(p.t?.price_usd)||Number(p.entry)||null; }

  function openPaperPosition(x){
    if(!paperRunning) return false;
    const t=x.t, e=x.e||{};
    if(e.signal!=="BUY" || Number(e.strength)<Number(threshold)) return false;
    if(e.entry==null || e.stop==null || e.take==null || Number(e.entry)<=0 || Number(e.stop)>=Number(e.entry)) return false;
    const existing=positions.some(p=>p.mint===t.mint);
    if(existing) return false;
    const equity=START_CAPITAL+realizedPnl()+positions.reduce((s,p)=>s+(currentPrice(p)-p.entry)*p.qty,0);
    const riskAmount=Math.max(0,equity*(Number(riskPct)/100));
    const unitRisk=Number(e.entry)-Number(e.stop);
    if(riskAmount<=0 || unitRisk<=0) return false;
    let qty=riskAmount/unitRisk;
    const maxAffordable=availableCash()/Number(e.entry);
    qty=Math.min(qty,maxAffordable);
    if(!Number.isFinite(qty)||qty<=0) return false;
    const actualRisk=qty*unitRisk;
    positions.push({
      mint:t.mint,symbol:t.symbol||t.name||"—",name:t.name||"",
      entry:Number(e.entry),stop:Number(e.stop),take:Number(e.take),qty,
      riskAmount:actualRisk,size:qty*Number(e.entry),openedAt:now(),
      t
    });
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

  function signalRows(){
    const engine=window.MEMELAB_ENGINE;
    const candidates=engine?.getCandidates?.()||[];
    return candidates.map((t,i)=>{
      const e=engine?.signal?.(t);
      return {t,e,index:i};
    });
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
    const cashEl=$("#paper-cash"), investedEl=$("#paper-invested"), cashDetail=$("#paper-cash-detail"), investedDetail=$("#paper-invested-detail");
    if(cashEl) cashEl.textContent=usd(cash);
    if(investedEl) investedEl.textContent=usd(invested);
    if(cashDetail) cashDetail.textContent="Unallocated · "+(((START_CAPITAL+realizedPnl())>0)?((cash/(START_CAPITAL+realizedPnl()))*100).toFixed(1):"0.0")+"%";
    if(investedDetail) investedDetail.textContent=positions.length+" open position"+(positions.length===1?"":"s");
    body.innerHTML=positions.length?positions.map(p=>{
      const current=Number(p.t?.price_usd)||p.entry;
      const pnl=(current-p.entry)*p.qty;
      return '<tr><td><strong>'+p.symbol+'</strong></td><td>'+price(p.entry)+'</td><td>'+price(current)+'</td><td>'+p.qty.toFixed(4)+'</td><td>'+usd(p.size)+'</td><td>'+price(p.stop)+'</td><td>'+price(p.take)+'</td><td class="'+(pnl>=0?"paper-positive":"paper-negative")+'">'+usd(pnl)+'</td><td>'+Math.max(0,Math.round((now()-p.openedAt)/60000))+'m</td><td>OPEN</td></tr>';
    }).join(""):'<tr><td colspan="10" class="paper-empty">No open paper positions.</td></tr>';
  }

  function renderJournal(){
    const body=$("#paper-journal-body"), pnlBody=$("#pnl-history-body");
    const html=journal.length?journal.slice().reverse().map(p=>'<tr><td>'+p.id+'</td><td><strong>'+p.symbol+'</strong></td><td>'+p.entryPriceText+'</td><td>'+p.exitPriceText+'</td><td>'+p.reason+'</td><td>'+usd(p.size)+'</td><td class="'+(p.pnl>=0?"paper-positive":"paper-negative")+'">'+usd(p.pnl)+'</td><td class="'+(p.pnl>=0?"paper-positive":"paper-negative")+'">'+pct(p.pnlPct)+'</td><td>'+Math.round(p.durationMs/60000)+'m</td></tr>').join(""):'<tr><td colspan="9" class="paper-empty">No closed paper trades yet.</td></tr>';
    if(body){body.innerHTML=html;$("#paper-journal-count").textContent=String(journal.length);}
    if(pnlBody)pnlBody.innerHTML=journal.length?journal.slice().reverse().map(p=>'<tr><td>'+p.id+'</td><td><strong>'+p.symbol+'</strong></td><td>BUY</td><td>'+p.entryPriceText+'</td><td>'+p.exitPriceText+'</td><td>'+p.reason+'</td><td class="'+(p.pnl>=0?"paper-positive":"paper-negative")+'">'+usd(p.pnl)+'</td><td>'+pct(p.pnlPct)+'</td></tr>').join(""):'<tr><td colspan="8" class="paper-empty">No closed trades recorded.</td></tr>';
  }

  function renderPnl(){
    const realized=journal.reduce((s,p)=>s+p.pnl,0);
    const open=positions.reduce((s,p)=>s+((Number(p.t?.price_usd)||p.entry)-p.entry)*p.qty,0);
    $("#pnl-start").textContent=usd(START_CAPITAL);
    $("#pnl-equity").textContent=usd(START_CAPITAL+realized+open);
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
  }

  function init(){
    const sel=$("#paper-threshold");
    if(sel)sel.addEventListener("change",()=>{threshold=Number(sel.value)||3;renderSignals();});
    const risk=$("#paper-risk");
    if(risk)risk.addEventListener("change",()=>{riskPct=Number(risk.value)||2;renderSignals();});
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
  window.MEMELAB_PAPER={render:renderAll,state:()=>({positions,journal,threshold,riskPct,paperRunning}),isRunning:()=>paperRunning};
  init();
})();