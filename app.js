/* BUILD REMINDER: Every frontend change must produce a new build-info.js.
   Product version changes are intentional; build number and build timestamp are automatic.
   Do not ship UI changes without a fresh build marker. */
const API_BASE = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
const $ = (s) => document.querySelector(s);
let snapshot = null;
let selectedMint = null;

function shortMint(m) { if (!m) return "—"; return m.length <= 14 ? m : m.slice(0,7)+"…"+m.slice(-5); }
function pct(v) { return Math.round(Math.max(0,Math.min(1,Number(v)||0))*100); }
function score(v) { return Math.round(Number(v)||0); }
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
  const line=$("#chart-line"), area=$("#chart-area"); if(!line||!area||!token)return;
  const windows=token.windows||{}, keys=Object.keys(windows).sort((a,b)=>Number(a)-Number(b));
  const values=keys.map(k=>Number(windows[k]?.net_flow_ui??0));
  if(!values.length){line.setAttribute("d","M0 220 L800 220");area.setAttribute("d","M0 220 L800 220 L800 240 L0 240 Z");return;}
  const min=Math.min(...values), max=Math.max(...values), span=max-min||1;
  const points=values.map((v,i)=>{const x=values.length===1?400:(i/(values.length-1))*800;const y=205-((v-min)/span)*170;return[Math.round(x),Math.round(y)]});
  const path=points.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" "); line.setAttribute("d",path); area.setAttribute("d",path+" L"+points[points.length-1][0]+" 240 L"+points[0][0]+" 240 Z");
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
  renderLifecycle(token); renderChart(token);
}

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
  if(!(window.MEMELAB_JUPITER && window.MEMELAB_JUPITER.active)){
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
