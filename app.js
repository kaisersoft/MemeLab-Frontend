/* BUILD REMINDER: Every frontend change must produce a new build-info.js.
   Product version changes are intentional; build number and build timestamp are automatic.
   Do not ship UI changes without a fresh build marker. */
const API_BASE = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
const $ = (s) => document.querySelector(s);
let snapshot = null;
let selectedMint = null;
let externalSelectedMint = null;
let marketHistoryRequest = 0;
let marketHistory = [];
let marketWindow = "24h";
let chartMetric = "price";
let apiReachable = false;
let databaseStatusInFlight = false;

function shortMint(m) { if (!m) return "—"; return m.length <= 14 ? m : m.slice(0,7)+"…"+m.slice(-5); }
function pct(v) { return Math.round(Math.max(0,Math.min(1,Number(v)||0))*100); }
function score(v) { return v==null || v==="" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)); }
function usd(v) {
  const n=Number(v);
  if(!Number.isFinite(n)) return "—";
  if(Math.abs(n)>=1e9) return "$"+(n/1e9).toFixed(2)+"B";
  if(Math.abs(n)>=1e6) return "$"+(n/1e6).toFixed(2)+"M";
  if(Math.abs(n)>=1e3) return "$"+(n/1e3).toFixed(1)+"K";
  if(Math.abs(n)>=1) return "$"+n.toFixed(2);
  return "$"+n.toExponential(2);
}
function lifecycleLabel(v) {
  const map={DISCOVERY:"Discover",LAUNCH:"Launch",EARLY_TRADING:"Early Trading",MOMENTUM:"Momentum",DISTRIBUTION:"Distribution",DECAY:"Decay"};
  return map[v]||v||"—";
}
function formatTime(ts) { if(!ts)return "—"; const d=new Date(Number(ts)*1000); return Number.isNaN(d.getTime())?"—":d.toLocaleTimeString(); }


function renderBuildInfo(backendBuild) {
  const info=window.MEMELAB_BUILD||{};
  const version=info.version||"V0.01";
  const raw=info.builtAt;
  const date=raw?new Date(raw):null;
  const stamp=date&&!Number.isNaN(date.getTime())
    ? date.toLocaleString("de-DE",{dateStyle:"short",timeStyle:"medium"})
    : "—";
  const badge=$("#build-badge");
  const meta=$("#build-meta");
  if(badge)badge.textContent="Frontend · "+version+" · "+stamp;
  if(meta){ const backend=backendBuild||{}; const bDate=backend.built_at?new Date(backend.built_at):null; const bStamp=bDate&&!Number.isNaN(bDate.getTime())?bDate.toLocaleString("de-DE",{dateStyle:"short",timeStyle:"medium"}):"—"; meta.textContent="Frontend · "+version+" · "+stamp+"   |   Backend · "+(backend.version||"—")+" · "+bStamp; }
}

function setMetric(id,value) {
  const el=$("#"+id); if(!el)return;
  const known=value!=null && value!=="" && Number.isFinite(Number(value));
  if(!known){
    el.textContent="—";
    const bar=el.parentElement?.nextElementSibling?.querySelector("em"); if(bar)bar.style.width="0%";
    return;
  }
  const v=pct(value); el.textContent=v;
  const bar=el.parentElement?.nextElementSibling?.querySelector("em"); if(bar)bar.style.width=v+"%";
}

function renderChart(token) {
  const line=$("#chart-line"), area=$("#chart-area");
  if(!line||!area||!token)return;
  renderMarketChart(marketHistory, token, {live:true, windowLabel:marketWindow});
}

function renderChartHistory(token,data){
  const line=$("#chart-line"), area=$("#chart-area"), zero=$("#chart-zero"), bars=$("#chart-bars");
  if(!line||!area)return;
  const pointsData=Array.isArray(data?.points)?data.points:[];
  marketHistory=pointsData;
  renderMarketChart(pointsData, token, {live:false, windowLabel:data?.window||marketWindow});
}

function updateMarketLiveToken(token){
  if(!token || token.mint!==externalSelectedMint)return;
  renderMarketChart(marketHistory, token, {live:true, windowLabel:marketWindow});
}

function metricValue(point,metric,index,points){
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
  const p=points[index-1]||null;
  if(metric==="price") return n(point?.price_usd);
  if(metric==="volume") return n(point?.volume);
  if(metric==="buy_volume") return n(point?.buy_volume);
  if(metric==="sell_volume") return n(point?.sell_volume);
  if(metric==="liquidity") return n(point?.liquidity);
  if(metric==="trades"){
    const buys=n(point?.buys), sells=n(point?.sells);
    return buys!=null&&sells!=null?buys+sells:null;
  }
  if(metric==="buy_trades") return n(point?.buys);
  if(metric==="sell_trades") return n(point?.sells);
  if(metric==="traders") return n(point?.traders);
  if(metric==="net_flow") return n(point?.net_flow);
  if(metric==="activity"){
    const v=n(point?.volume), prev=n(p?.volume);
    return v!=null&&prev!=null&&prev!==0?(v-prev)/Math.abs(prev)*100:null;
  }
  if(metric==="momentum"){
    const v=n(point?.price_usd), prev=n(p?.price_usd);
    return v!=null&&prev!=null&&prev!==0?(v-prev)/Math.abs(prev)*100:null;
  }
  if(metric==="volatility"){
    const prices=points.slice(Math.max(0,index-12),index+1).map(x=>n(x?.price_usd)).filter(x=>x!=null&&x>0);
    if(prices.length<3)return null;
    const returns=[];
    for(let i=1;i<prices.length;i++)returns.push(Math.log(prices[i]/prices[i-1]));
    const mean=returns.reduce((s,x)=>s+x,0)/returns.length;
    const variance=returns.reduce((s,x)=>s+(x-mean)**2,0)/returns.length;
    return Math.sqrt(variance)*100;
  }
  return null;
}
function formatChartMetric(v,metric){
  if(v==null||!Number.isFinite(Number(v)))return "—";
  const n=Number(v);
  if(metric==="price")return usd(n);
  if(["volume","buy_volume","sell_volume","liquidity"].includes(metric))return usd(n);
  if(["activity","momentum","volatility"].includes(metric))return (n>0?"+":"")+n.toFixed(2)+"%";
  if(metric==="net_flow")return (n>0?"+":"")+usd(n);
  return n.toLocaleString("de-DE",{maximumFractionDigits:0});
}
function renderMarketChart(history, token, options={}){
  const line=$("#chart-line"), area=$("#chart-area"), zero=$("#chart-zero"), bars=$("#chart-bars");
  if(!line||!area)return;
  const pointsData=[...(Array.isArray(history)?history:[])];
  const metric=$("#chart-metric")?.value||chartMetric;
  const values=pointsData.map((p,i)=>metricValue(p,metric,i,pointsData)).filter(v=>v!=null&&Number.isFinite(v));
  const metricLabels={
    price:"Price",
    volume:"Volume",
    buy_volume:"Buy Volume",
    sell_volume:"Sell Volume",
    liquidity:"Liquidity",
    trades:"Trades",
    buy_trades:"Buy Trades",
    sell_trades:"Sell Trades",
    traders:"Traders",
    volatility:"Volatility",
    activity:"Activity",
    momentum:"Momentum",
    net_flow:"Buy / Sell Flow"
  };
  const currentEl=$("#chart-current"), maxEl=$("#chart-max"), minEl=$("#chart-min"), windowEl=$("#chart-window"), dataEl=$("#chart-data"), metricNameEl=$("#chart-metric-name");
  const topEl=$("#chart-axis-top"),zeroEl=$("#chart-axis-zero"),bottomEl=$("#chart-axis-bottom");
  const latest=values.length?values[values.length-1]:null;
  const windowMax=values.length?Math.max(...values):null;
  const windowMin=values.length?Math.min(...values):null;
  const metricLabel=metricLabels[metric]||metric;
  if(currentEl)currentEl.textContent=formatChartMetric(latest,metric);
  if(maxEl)maxEl.textContent=formatChartMetric(windowMax,metric);
  if(minEl)minEl.textContent=formatChartMetric(windowMin,metric);
  if(windowEl)windowEl.textContent=values.length?(options.windowLabel||values.length+" observations"):"—";
  if(dataEl)dataEl.textContent=values.length?"SQLite history":"waiting";
  if(metricNameEl)metricNameEl.textContent=metricLabel;
  const isSigned=metric==="activity" || metric==="momentum";
  const isFlow=metric==="net_flow";
  if(topEl)topEl.textContent=values.length?(isFlow?"BUY":(isSigned?"POSITIVE":"MAX")):"—";
  if(bottomEl)bottomEl.textContent=values.length?(isFlow?"SELL":(isSigned?"NEGATIVE":"MIN")):"—";
  if(zeroEl)zeroEl.textContent=(isSigned||isFlow)?"0":"";
  if(currentEl)currentEl.setAttribute("aria-label",metricLabel+" current");
  if(maxEl)maxEl.setAttribute("aria-label",metricLabel+" window maximum");
  if(minEl)minEl.setAttribute("aria-label",metricLabel+" window minimum");
  if(!values.length){
    line.setAttribute("d","M0 130 L800 130"); area.setAttribute("d","M0 130 L800 130 L800 240 L0 240 Z");
    if(zero)zero.setAttribute("d","M0 130H800");
    if(bars)bars.innerHTML="";
    return;
  }
  const source=pointsData.map((p,i)=>metricValue(p,metric,i,pointsData));
  const finite=source.filter(v=>v!=null&&Number.isFinite(v));
  let min=Math.min(...finite),max=Math.max(...finite);
  if(min===max){const pad=Math.abs(min)*0.05||1;min-=pad;max+=pad;}
  const pad=(max-min)*0.05;min-=pad;max+=pad;
  const points=source.map((v,i)=>{
    if(v==null||!Number.isFinite(v))return null;
    const x=pointsData.length===1?400:(i/(pointsData.length-1))*800;
    const y=230-((v-min)/(max-min))*200;
    return[Math.round(x),Math.round(y)];
  });
  let path="";
  points.forEach(p=>{if(!p)return;path+=(path?"L":"M")+p[0]+" "+p[1]+" ";});
  line.setAttribute("d",path.trim()||"M0 130 L800 130");
  area.setAttribute("d",path.trim()?path.trim()+" L"+points.filter(Boolean).at(-1)[0]+" 240 L"+points.find(Boolean)[0]+" 240 Z":"M0 130 L800 130 L800 240 L0 240 Z");
  if(zero){
    if(isSigned&&min<=0&&max>=0){
      const y=230-((0-min)/(max-min))*200;
      zero.setAttribute("d","M0 "+Math.round(y)+"H800");
    }else zero.setAttribute("d","M0 130H800");
  }
  if(bars)bars.innerHTML="";
}

function renderLifecycle(token) {
  const stages=["DISCOVERY","LAUNCH","EARLY_TRADING","MOMENTUM","DISTRIBUTION","DECAY"], current=stages.indexOf(token?.lifecycle);
  document.querySelectorAll(".life").forEach((el,i)=>el.classList.toggle("active",current>=0&&i<=current));
}

function renderSelectedToken(token) {
  if(!token)return;
  $("#score-token").textContent=token.symbol || shortMint(token.mint);
  const intelligenceScore=score(token.intelligence);
  $("#score").textContent=intelligenceScore==null?"— / 100":intelligenceScore+" / 100";
  $("#chart-label").textContent=(token.symbol || shortMint(token.mint))+" / SOL · "+marketWindow+" history";
  setMetric("m-liq",token.liquidity); setMetric("m-vol",token.activity); setMetric("m-holder",token.actor_growth); setMetric("m-social",token.confidence);
  const risk=$("#m-risk"); if(risk){risk.textContent="—";const bar=risk.parentElement?.nextElementSibling?.querySelector("em");if(bar)bar.style.width="0%";}
  const note=$("#market-context-note"); if(note) note.textContent="Selected metric · selected history window";
  renderLifecycle(token); renderChart(token);
}
async function selectMarketToken(mint){
  externalSelectedMint=mint;
  window.dispatchEvent(new CustomEvent("memelab:market-token-selected",{detail:{mint}}));
  marketHistory=[];
  const token=(Array.isArray(window.MEMELAB_JUPITER_TOKENS)?window.MEMELAB_JUPITER_TOKENS.find(t=>t.mint===mint):null)
    || (Array.isArray(snapshot?.tokens)?snapshot.tokens:[]).find(t=>t.mint===mint);
  if(token) renderSelectedToken(token);
  const request=++marketHistoryRequest;
  try{
    const response=await fetch(API_BASE+"/jupiter/history?mint="+encodeURIComponent(mint)+"&window="+encodeURIComponent(marketWindow),{cache:"no-store",headers:{Accept:"application/json"}});
    if(!response.ok) throw new Error(response.status+" "+response.statusText);
    const data=await response.json();
    if(request!==marketHistoryRequest) return;
    renderChartHistory(token,data);
    window.MEMELAB_POSITION_HISTORY=Array.isArray(data?.points)?data.points:[];
    window.dispatchEvent(new CustomEvent("memelab:market-history",{detail:{mint,window:data?.window||marketWindow,points:window.MEMELAB_POSITION_HISTORY}}));
  }catch(error){
    if(request!==marketHistoryRequest) return;
    console.error("MemeLab market history failed:",error);
    renderChartHistory(token,{points:[]});
  }
}
window.MEMELAB_MARKET={selectToken:selectMarketToken,updateLive:updateMarketLiveToken,setMetric:setChartMetric,active:true};

function setChartMetric(metric){
  chartMetric=metric||"price";
  const select=$("#chart-metric"); if(select)select.value=chartMetric;
  const token=(Array.isArray(window.MEMELAB_JUPITER_TOKENS)?window.MEMELAB_JUPITER_TOKENS.find(t=>t.mint===externalSelectedMint):null)
    || (Array.isArray(snapshot?.tokens)?snapshot.tokens:[]).find(t=>t.mint===externalSelectedMint);
  if(token)renderMarketChart(marketHistory,token,{live:true,windowLabel:marketWindow});
}
function setMarketWindow(nextWindow){
  if(marketWindow===nextWindow)return;
  marketWindow=nextWindow;
  document.querySelectorAll(".chart-window-btn").forEach(btn=>{
    const active=btn.dataset.window===marketWindow;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",active?"true":"false");
  });
  if(externalSelectedMint) selectMarketToken(externalSelectedMint);
}

function updateConnectionStatus(runtime) {
  const live=$(".live-pill"); if(!live)return;
  const health=runtime?.health||{}, apiOk=apiReachable, engineOk=health.engine===true, websocketOk=health.websocket===true, eventsReceived=Number(health.events_received??runtime?.events_received??0);
  let state="red", label="API OFFLINE", title="MemeLab API is not reachable.";
  if(apiOk&&engineOk&&websocketOk&&eventsReceived>0&&!runtime?.last_error){state="green";label="ON-CHAIN LIVE";title="API connected · engine running · Solana websocket connected · chain events received";}
  else if(apiOk&&engineOk&&runtime?.census_running&&!runtime?.last_error){state="orange";label="ON-CHAIN SCANNING";title="API connected · engine running · token universe census in progress";}
  else if(apiOk&&engineOk&&websocketOk&&!runtime?.last_error){state="orange";label="ON-CHAIN WAITING";title="API connected · engine running · Solana websocket connected · waiting for first chain event";}
  else if(apiOk&&engineOk){state="orange";label="ENGINE CONNECTED";title=runtime?.last_error?"API connected · MemeLab engine is not currently healthy: "+runtime.last_error:"API connected · MemeLab engine running · live Solana event stream is not currently active";}
  else if(apiOk){state="orange";label="API CONNECTED";title=runtime?.last_error?"MemeLab API connected · live engine reports: "+runtime.last_error:"MemeLab API connected · Jupiter discovery can continue independently of the live Solana engine";}
  live.classList.remove("status-green","status-orange","status-red"); live.classList.add("status-"+state); live.innerHTML="<i></i> "+label; live.title=title;
}

function renderMarketContext(market) {
  const rt=snapshot?.runtime||{};
  updateConnectionStatus(rt);
  const selected=$("#score-token");
  if(selected && !selected.textContent) selected.textContent="—";
  const universe=market?.meme_universe||{};
  const count=Number(universe.count);
  const effectiveCount=Number.isFinite(count)?count:20752933;
  const countEl=$("#meme-universe-count");
  const updatedEl=$("#meme-universe-updated");
  if(countEl) countEl.textContent=formatCompactCount(effectiveCount);
  const monitoredEl=$("#meme-lab-monitored");
  const monitored=Number(window.MEMELAB_JUPITER_DATA?.diagnostics?.watchlist_count);
  if(monitoredEl) monitoredEl.textContent=Number.isFinite(monitored)?monitored.toLocaleString("de-DE"):"—";
  const ratioFill=$("#market-ratio-fill");
  const ratioPercent=$("#market-ratio-percent");
  const share=effectiveCount>0 && monitored>0 ? monitored/effectiveCount*100 : 0;
  if(ratioFill){
    const visibleDegrees=Math.max(2,Math.min(360,share*3.6));
    ratioFill.style.background="conic-gradient(from -90deg,#63c69f 0deg "+visibleDegrees.toFixed(2)+"deg,#15232c "+visibleDegrees.toFixed(2)+"deg 360deg)";
    ratioFill.title=share.toFixed(3)+"% of total meme universe";
  }
  if(ratioPercent) ratioPercent.textContent=share<0.01 ? "<0.01%" : share.toFixed(2)+"%";
  if(updatedEl){
    updatedEl.textContent=universe.updated_at
      ? "Solscan · "+formatTime(universe.updated_at)
      : "Solscan · initial benchmark";
    updatedEl.title=universe.stale && universe.error ? universe.error : "Monthly Solscan market-size snapshot";
  }
}
function formatCompactCount(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return "—";
  if(n>=1e9) return (n/1e9).toFixed(2)+"B";
  if(n>=1e6) return (n/1e6).toFixed(2)+"M";
  if(n>=1e3) return (n/1e3).toFixed(1)+"K";
  return Math.round(n).toLocaleString("de-DE");
}
function renderLifecycleOverview(tokens){
  const stages=[
    {key:"DISCOVERED",label:"Discovered",cls:"discovered"},
    {key:"EMERGING",label:"Emerging",cls:"emerging"},
    {key:"ACTIVE",label:"Active",cls:"active"},
    {key:"MATURE",label:"Mature",cls:"mature"}
  ];
  const counts=Object.fromEntries(stages.map(s=>[s.key,0]));
  (Array.isArray(tokens)?tokens:[]).forEach(token=>{
    const key=String(token?.lifecycle||"").toUpperCase();
    if(Object.prototype.hasOwnProperty.call(counts,key)) counts[key]+=1;
  });
  const total=stages.reduce((sum,s)=>sum+counts[s.key],0);
  const totalEl=$("#lifecycle-total");
  const stack=$("#lifecycle-stack");
  const legend=$("#lifecycle-legend");
  if(totalEl) totalEl.textContent=total.toLocaleString("de-DE")+" monitored";
  if(stack){
    stack.innerHTML=stages.map(s=>{
      const count=counts[s.key], pct=total?count/total*100:0;
      return '<span class="lifecycle-segment '+s.cls+'" style="width:'+pct.toFixed(3)+'%" title="'+s.label+': '+count.toLocaleString("de-DE")+'"></span>';
    }).join("");
    stack.setAttribute("aria-label",stages.map(s=>s.label+" "+counts[s.key]).join(", "));
  }
  if(legend){
    legend.innerHTML=stages.map(s=>{
      const count=counts[s.key], pct=total?count/total*100:0;
      return '<span><i class="lifecycle-dot '+s.cls+'"></i><b>'+s.label+'</b><em>'+count.toLocaleString("de-DE")+' · '+pct.toFixed(1)+"%</em></span>";
    }).join("");
  }
}

function renderSnapshot(data) {
  snapshot=data;
  renderBuildInfo(data?.runtime?.build);
  const tokens=Array.isArray(data?.tokens)?data.tokens:[];
  renderLifecycleOverview(window.MEMELAB_JUPITER_TOKENS || tokens);
  renderMarketContext(data?.market_size);
  if(!tokens.length)return;
  if(window.MEMELAB_JUPITER && window.MEMELAB_JUPITER.active){
    const marketToken=tokens.find(t=>t.mint===externalSelectedMint);
    if(marketToken) renderSelectedToken(marketToken);
  } else {
    if(!selectedMint||!tokens.some(t=>t.mint===selectedMint))selectedMint=tokens[0].mint;
    renderSelectedToken(tokens.find(t=>t.mint===selectedMint)||tokens[0]);
  }
  const social=document.querySelector(".social");
  if(social){
    const sub=social.querySelector(".panel-head .muted");if(sub)sub.textContent="Not connected · separate development block";
    const table=social.querySelector(".signal-table");
    if(table)table.innerHTML=[["Status","NOT CONNECTED"],["Data source","Separate API"],["Integration","Later phase"],["On-chain data","Available"],["Social intelligence","Not evaluated"]].map(x=>"<div><span>"+x[0]+"</span><b>"+x[1]+"</b></div>").join("");
  }
  const footer=document.querySelector(".prototype-note");if(footer)footer.textContent="MemeLab · live Solana intelligence · risk and social intelligence follow in later development blocks.";
}

async function api(path,options={}){const response=await fetch(API_BASE+path,{cache:"no-store",...options,headers:{"Accept":"application/json",...(options.headers||{})}});if(!response.ok)throw new Error(response.status+" "+response.statusText);return response.json();}
async function refreshDatabaseStatus(){
  if(databaseStatusInFlight)return;
  databaseStatusInFlight=true;
  const el=$("#db-status"), textEl=$("#db-status-text");
  const cloud=$("#cloud-db-status"), cloudHealth=$("#cloud-db-health"), cloudDetail=$("#cloud-db-detail");
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(API_BASE+"/supabase/status",{
      cache:"no-store",
      signal:controller.signal,
      headers:{Accept:"application/json"}
    });
    if(!response.ok)throw new Error(response.status+" "+response.statusText);
    const data=await response.json();
    const sqlite=data.sqlite||{};
    const cloudData=data.cloud||{};
    const size=Number(sqlite.db_size_mb);
    const sizeLabel=Number.isFinite(size)?size.toFixed(1)+" MB":"—";

    if(el && textEl){
      if(data.active_store==="sqlite"){
        el.className="db-status db-sqlite";
        textEl.textContent="DB · SQLite ACTIVE · "+sizeLabel;
        el.title="Local SQLite is authoritative. Supabase is the cloud secondary store.";
      }else{
        el.className="db-status db-supabase";
        textEl.textContent="DB · SUPABASE ACTIVE · "+sizeLabel;
        el.title="Supabase is the active database.";
      }
    }

    const cloudBytes=Number(cloudData.database_bytes);
    const cloudMb=Number(cloudData.database_mb);
    const cloudShare=Number(cloudData.database_percent_of_500mb);
    const connected=cloudData.available===true && cloudData.configured===true;
    const effectiveCloudMb=Number.isFinite(cloudMb)
      ? cloudMb
      : (Number.isFinite(cloudBytes)?cloudBytes/1048576:NaN);
    const headroomMb=Number.isFinite(effectiveCloudMb)?Math.max(0,500-effectiveCloudMb):NaN;
    const derivedGuard=Number.isFinite(cloudBytes)
      ? (cloudBytes>=450*1048576?"HARD STOP · >=450 MB":cloudBytes>=400*1048576?"WARNING · >=400 MB":"OK · <400 MB")
      : "BLOCKED · storage check unavailable";

    if(cloud){
      cloud.className="cloud-db-status "+(connected?"healthy":"offline");
      if(cloudHealth)cloudHealth.textContent=connected?"HEALTHY":"OFFLINE";
      if(cloudDetail)cloudDetail.textContent=connected
        ?"Supabase connected · secondary store · SQLite remains authoritative"
        :(cloudData.error||cloudData.reason||"Supabase cloud database unavailable");
    }
    const set=(id,v)=>{const x=$(id);if(x)x.textContent=v;};
    set("#dbg-cloud-size",Number.isFinite(effectiveCloudMb)?effectiveCloudMb.toFixed(1)+" MB":"—");
    set("#dbg-cloud-share",Number.isFinite(cloudShare)?cloudShare.toFixed(1)+"%":(Number.isFinite(effectiveCloudMb)?((effectiveCloudMb/500)*100).toFixed(1)+"%":"—"));
    set("#dbg-cloud-headroom",connected&&Number.isFinite(headroomMb)?headroomMb.toFixed(1)+" MB":"—");
    set("#dbg-cloud-snapshots",connected?((Number(cloudData.market_snapshots_bytes)||0)/1048576).toFixed(2)+" MB":"—");
    set("#dbg-cloud-aggregates",connected?((Number(cloudData.market_aggregates_bytes)||0)/1048576).toFixed(2)+" MB":"—");
    set("#dbg-cloud-guard",cloudData.storage_guard||derivedGuard);
  }catch(error){
    if(el && textEl){
      el.className="db-status db-fallback";
      textEl.textContent="DB · SQLite FALLBACK";
      el.title="Database status unavailable. SQLite remains the authoritative store.";
    }
    if(cloud){
      cloud.className="cloud-db-status offline";
      if(cloudHealth)cloudHealth.textContent=error.name==="AbortError"?"TIMEOUT":"UNAVAILABLE";
      if(cloudDetail)cloudDetail.textContent=error.name==="AbortError"
        ?"Cloud database health check timed out"
        :"Database health endpoint unavailable";
    }
  }finally{
    clearTimeout(timeout);
    databaseStatusInFlight=false;
  }
}
async function refresh(){
  try{
    apiReachable=true;
    renderSnapshot(await api("/snapshot"));
    refreshDatabaseStatus();
  }catch(error){
    apiReachable=false;
    console.error("MemeLab snapshot failed:",error);
    const live=$(".live-pill");
    if(live){live.classList.remove("status-green","status-orange");live.classList.add("status-red");live.innerHTML="<i></i> API OFFLINE";live.title=error.message||"MemeLab API is not reachable.";}
    const db=$("#db-status"), dbText=$("#db-status-text");
    if(db&&dbText){db.className="db-status db-fallback";dbText.textContent="DB · SQLite FALLBACK";db.title="API offline. Local SQLite is the fallback store.";}
  }
}
async function startEngine(){try{apiReachable=true;await api("/start",{method:"POST"});await refresh();}catch(error){apiReachable=false;console.error("MemeLab API start failed:",error);const live=$(".live-pill");if(live)live.innerHTML="<i></i> API OFFLINE";}}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));btn.classList.add("active");}));
document.querySelectorAll(".chart-window-btn").forEach(btn=>btn.addEventListener("click",()=>setMarketWindow(btn.dataset.window)));
const chartMetricSelect=$("#chart-metric");
if(chartMetricSelect) chartMetricSelect.addEventListener("change",()=>setChartMetric(chartMetricSelect.value));
renderBuildInfo();
startEngine();
setInterval(refresh,1000);
