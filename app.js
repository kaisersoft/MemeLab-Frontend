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

function shortMint(m) { if (!m) return "—"; return m.length <= 14 ? m : m.slice(0,7)+"…"+m.slice(-5); }
function pct(v) { return Math.round(Math.max(0,Math.min(1,Number(v)||0))*100); }
function score(v) { return Math.round(Number(v)||0); }
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
  const v=pct(value); el.textContent=v;
  const bar=el.parentElement?.nextElementSibling?.querySelector("em"); if(bar)bar.style.width=v+"%";
}

function renderChart(token) {
  const line=$("#chart-line"), area=$("#chart-area"), zero=$("#chart-zero");
  if(!line||!area||!token)return;
  renderChartHistory(token,{points:marketHistory});
}

function renderChartHistory(token,data){
  const line=$("#chart-line"), area=$("#chart-area"), zero=$("#chart-zero"), bars=$("#chart-bars");
  if(!line||!area)return;
  const pointsData=Array.isArray(data?.points)?data.points:[];
  marketHistory=pointsData;
  renderMarketChart(pointsData, token, {live:false});
}

function updateMarketLiveToken(token){
  if(!token || token.mint!==externalSelectedMint)return;
  renderMarketChart(marketHistory, token, {live:true});
}

function renderMarketChart(history, token, options={}){
  const line=$("#chart-line"), area=$("#chart-area"), zero=$("#chart-zero"), bars=$("#chart-bars");
  if(!line||!area)return;
  const liveStats=token?.stats_24h||{};
  const liveBuy=Number(liveStats.buy_volume);
  const liveSell=Number(liveStats.sell_volume);
  const liveNet=(Number.isFinite(liveBuy)?liveBuy:0)-(Number.isFinite(liveSell)?liveSell:0);
  const livePoint=options.live && token ? {
    observed_at: Date.now()/1000,
    net_flow: liveNet,
    buy_volume: Number.isFinite(liveBuy)?liveBuy:0,
    sell_volume: Number.isFinite(liveSell)?liveSell:0,
    live:true
  } : null;
  const pointsData=[...(Array.isArray(history)?history:[])];
  if(livePoint) pointsData.push(livePoint);
  const values=pointsData.map(p=>Number(p?.net_flow)).filter(Number.isFinite);
  const netEl=$("#chart-net-flow"), windowEl=$("#chart-window"), dataEl=$("#chart-data");
  const last=values.length?values[values.length-1]:null;
  if(netEl) netEl.textContent=last==null?"—":(last>0?"+":"")+usd(last);
  if(windowEl) windowEl.textContent=values.length?data?.window||values.length+" observations":"—";
  if(dataEl) dataEl.textContent=values.length?(livePoint?"live + SQLite":"SQLite history"):"waiting";
  if(!values.length){
    line.setAttribute("d","M0 130 L800 130");
    area.setAttribute("d","M0 130 L800 130 L800 240 L0 240 Z");
    if(zero)zero.setAttribute("d","M0 130H800");
    return;
  }
  const abs=Math.max(...values.map(v=>Math.abs(v)),1);
  const points=values.map((v,i)=>{const x=values.length===1?400:(i/(values.length-1))*800;const y=130-(v/abs)*105;return[Math.round(x),Math.round(y)]});
  const path=points.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ");
  line.setAttribute("d",path);
  area.setAttribute("d",path+" L"+points[points.length-1][0]+" 130 L"+points[0][0]+" 130 Z");
  if(zero)zero.setAttribute("d","M0 130H800");
  if(bars){
    const barW=Math.max(2,Math.min(10,760/Math.max(points.length,1)));
    const rects=pointsData.map((p,i)=>{
      const v=Number(p?.net_flow)||0;
      const x=points.length===1?400:points[i][0];
      const h=Math.max(2,Math.abs(v)/abs*95);
      const y=v>=0?130-h:130;
      const cls=v>=0?"chart-bar-buy":"chart-bar-sell";
      return "<rect class=\""+cls+"\" x=\""+Math.max(0,x-barW/2).toFixed(1)+"\" y=\""+y.toFixed(1)+"\" width=\""+barW.toFixed(1)+"\" height=\""+h.toFixed(1)+"\" rx=\"1\"/>";
    }).join("");
    bars.innerHTML=rects;
  }
}

function renderLifecycle(token) {
  const stages=["DISCOVERY","LAUNCH","EARLY_TRADING","MOMENTUM","DISTRIBUTION","DECAY"], current=stages.indexOf(token?.lifecycle);
  document.querySelectorAll(".life").forEach((el,i)=>el.classList.toggle("active",current>=0&&i<=current));
}

function renderSelectedToken(token) {
  if(!token)return;
  $("#score-token").textContent=token.symbol || shortMint(token.mint);
  $("#score").textContent=score(token.intelligence)+" / 100";
  $("#chart-label").textContent=(token.symbol || shortMint(token.mint))+" / SOL · live";
  setMetric("m-liq",token.liquidity); setMetric("m-vol",token.activity); setMetric("m-holder",token.actor_growth); setMetric("m-social",token.confidence);
  const risk=$("#m-risk"); if(risk){risk.textContent="—";const bar=risk.parentElement?.nextElementSibling?.querySelector("em");if(bar)bar.style.width="0%";}
  const note=$("#market-context-note"); if(note) note.textContent="Net Flow · Buy/Sell pressure · live snapshot data";
  renderLifecycle(token); renderChart(token);
}
async function selectMarketToken(mint){
  externalSelectedMint=mint;
  const token=(Array.isArray(window.MEMELAB_JUPITER_TOKENS)?window.MEMELAB_JUPITER_TOKENS.find(t=>t.mint===mint):null)
    || (Array.isArray(snapshot?.tokens)?snapshot.tokens:[]).find(t=>t.mint===mint);
  if(token) renderSelectedToken(token);
  const request=++marketHistoryRequest;
  try{
    const response=await fetch(API_BASE+"/jupiter/history?mint="+encodeURIComponent(mint),{cache:"no-store",headers:{Accept:"application/json"}});
    if(!response.ok) throw new Error(response.status+" "+response.statusText);
    const data=await response.json();
    if(request!==marketHistoryRequest) return;
    renderChartHistory(token,data);
  }catch(error){
    if(request!==marketHistoryRequest) return;
    console.error("MemeLab market history failed:",error);
    renderChartHistory(token,{points:[]});
  }
}
window.MEMELAB_MARKET={selectToken:selectMarketToken,updateLive:updateMarketLiveToken,active:true};

function updateConnectionStatus(runtime) {
  const live=$(".live-pill"); if(!live)return;
  const health=runtime?.health||{}, apiOk=health.api!==false, engineOk=health.engine===true, websocketOk=health.websocket===true, eventsReceived=Number(health.events_received??runtime?.events_received??0);
  let state="red", label="API OFFLINE", title=runtime?.last_error||"MemeLab API is not reachable.";
  if(apiOk&&engineOk&&websocketOk&&eventsReceived>0&&!runtime?.last_error){state="green";label="ON-CHAIN LIVE";title="API connected · engine running · Solana websocket connected · chain events received";}
  else if(apiOk&&engineOk&&runtime?.census_running&&!runtime?.last_error){state="orange";label="ON-CHAIN SCANNING";title="API connected · token universe census in progress";}
  else if(apiOk&&engineOk&&websocketOk&&!runtime?.last_error){state="orange";label="ON-CHAIN WAITING";title="API connected · engine running · Solana websocket connected · waiting for first chain event";}
  live.classList.remove("status-green","status-orange","status-red"); live.classList.add("status-"+state); live.innerHTML="<i></i> "+label; live.title=title;
}

function renderMarketContext(market) {
  const rt=snapshot?.runtime||{};
  // Discovery / Universe DOM is owned exclusively by jupiter-live.js.
  // Do not write to its labels, counters, scan timestamp, subtitle or note here.
  updateConnectionStatus(rt);
  const selected=$("#score-token");
  if(selected && !selected.textContent) selected.textContent="—";
}

function renderSnapshot(data) {
  snapshot=data;
  renderBuildInfo(data?.runtime?.build);
  const tokens=Array.isArray(data?.tokens)?data.tokens:[];
  // Discovery is owned exclusively by jupiter-live.js. The snapshot must never render token cards.
  renderMarketContext(data?.market);
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
async function refresh(){try{renderSnapshot(await api("/snapshot"));}catch(error){console.error("MemeLab snapshot failed:",error);const live=$(".live-pill");if(live){live.classList.remove("status-green","status-orange");live.classList.add("status-red");live.innerHTML="<i></i> API OFFLINE";live.title=error.message||"MemeLab API is not reachable.";}}}
async function startEngine(){try{await api("/start",{method:"POST"});await refresh();}catch(error){console.error("MemeLab API start failed:",error);const live=$(".live-pill");if(live)live.innerHTML="<i></i> API OFFLINE";}}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));btn.classList.add("active");}));
renderBuildInfo();
startEngine();
setInterval(refresh,1000);
