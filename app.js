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
  const path=points.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ");
  line.setAttribute("d",path); area.setAttribute("d",path+" L"+points[points.length-1][0]+" 240 L"+points[0][0]+" 240 Z");
}

function renderDiscovery(tokens) {
  const grid=$(".token-grid"); if(!grid)return;
  if(!tokens.length){grid.innerHTML='<div class="muted">Waiting for live Solana events…</div>';return;}
  grid.innerHTML=tokens.slice(0,3).map((t,i)=>{
    const selected=t.mint===selectedMint||(!selectedMint&&i===0);
    return '<button class="token-card '+(selected?"selected":"")+'" data-token="'+t.mint+'">'+
      '<strong>'+shortMint(t.mint)+'</strong><span>Solana · '+lifecycleLabel(t.lifecycle)+'</span>'+
      '<div><label>Liquidity signal</label><b class="'+(pct(t.liquidity)>=50?"positive":"warning")+'">'+pct(t.liquidity)+'</b></div>'+
      '<div><label>Intelligence</label><b>'+score(t.intelligence)+'</b></div></button>';
  }).join("");
  grid.querySelectorAll(".token-card").forEach(btn=>btn.addEventListener("click",()=>{selectedMint=btn.dataset.token;renderSnapshot(snapshot);}));
}

function renderLifecycle(token) {
  const stages=["DISCOVERY","LAUNCH","EARLY_TRADING","MOMENTUM","DISTRIBUTION","DECAY"], current=stages.indexOf(token?.lifecycle);
  document.querySelectorAll(".life").forEach((el,i)=>el.classList.toggle("active",current>=0&&i<=current));
}

function renderSelectedToken(token) {
  if(!token)return;
  $("#score-token").textContent=shortMint(token.mint);
  $("#score").textContent=score(token.intelligence)+" / 100";
  $("#chart-label").textContent=shortMint(token.mint)+" / SOL · live";
  setMetric("m-liq",token.liquidity);
  setMetric("m-vol",token.activity);
  setMetric("m-holder",token.actor_growth);
  setMetric("m-social",token.confidence);
  const risk=$("#m-risk"); if(risk){risk.textContent="—";const bar=risk.parentElement?.nextElementSibling?.querySelector("em");if(bar)bar.style.width="0%";}
  renderLifecycle(token); renderChart(token);
}

function updateConnectionStatus(runtime) {
  const live = $(".live-pill");
  if (!live) return;

  const health = runtime?.health || {};
  const apiOk = health.api !== false;
  const engineOk = health.engine === true;
  const chainDataOk = health.chain_data === true;
  const lastEvent = Number(runtime?.last_event_at || 0);
  const age = lastEvent ? (Date.now() / 1000) - lastEvent : Infinity;

  let state = "red";
  let label = "API OFFLINE";
  let title = runtime?.last_error || "MemeLab API is not reachable.";

  if (apiOk && engineOk && chainDataOk && age <= 15) {
    state = "green";
    label = "ON-CHAIN LIVE";
    title = "API connected · engine running · Solana chain data flowing";
  } else if (apiOk && (engineOk || runtime?.running) && !runtime?.last_error) {
    state = "orange";
    label = chainDataOk ? "CHAIN DATA DELAY" : "ON-CHAIN WAITING";
    title = chainDataOk
      ? "API connected · engine running · last Solana event is older than 15 seconds"
      : "API connected · engine running · waiting for Solana chain data";
  }

  live.classList.remove("status-green", "status-orange", "status-red");
  live.classList.add("status-" + state);
  live.innerHTML = "<i></i> " + label;
  live.title = title;
}\n\nfunction renderMarketContext(market) {
  const regime=market?.regime||"—";
  const subtitle=document.querySelector(".discovery .panel-head > div > span"); if(subtitle)subtitle.textContent="Solana · "+regime;
  const scan=$("#scan-time"); if(scan)scan.textContent=snapshot?.runtime?.last_event_at?"Last event · "+formatTime(snapshot.runtime.last_event_at):"Waiting for live events";
  updateConnectionStatus(snapshot?.runtime);
  const total=document.querySelector("#market-total-tokens");
  const active=document.querySelector("#market-active-tokens");
  const candidates=document.querySelector("#market-candidates");
  const activityEl=document.querySelector("#market-activity");
  if(total)total.textContent=Number.isFinite(Number(market?.total_tokens))?Number(market.total_tokens).toLocaleString():"—";
  if(active)active.textContent=Number.isFinite(Number(market?.active_tokens))?Number(market.active_tokens).toLocaleString():"—";
  if(candidates)candidates.textContent=Array.isArray(snapshot?.tokens)?Math.min(snapshot.tokens.length,3):"—";
  if(activityEl)activityEl.textContent=pct(market?.activity);
  const note=$(".risk-note"); if(note)note.innerHTML="<b>Market context:</b> "+regime+" · buy pressure "+pct(market?.buy_pressure)+" · activity "+pct(market?.activity)+" · actor growth "+pct(market?.actor_growth)+" · liquidity "+pct(market?.liquidity)+" · active tokens "+(market?.active_tokens??0)+"/"+(market?.total_tokens??0)+". Risk engine not connected in this phase.";
}

function renderSnapshot(data) {
  snapshot=data;
  const tokens=Array.isArray(data?.tokens)?data.tokens:[];
  renderDiscovery(tokens); renderMarketContext(data?.market);
  if(!tokens.length)return;
  if(!selectedMint||!tokens.some(t=>t.mint===selectedMint))selectedMint=tokens[0].mint;
  renderSelectedToken(tokens.find(t=>t.mint===selectedMint)||tokens[0]);
  const social=document.querySelector(".social");
  if(social){const sub=social.querySelector(".panel-head .muted");if(sub)sub.textContent="Not connected · separate development block";const table=social.querySelector(".signal-table");if(table)table.innerHTML=[["Status","NOT CONNECTED"],["Data source","Separate API"],["Integration","Later phase"],["On-chain data","Available"],["Social intelligence","Not evaluated"]].map(x=>"<div><span>"+x[0]+"</span><b>"+x[1]+"</b></div>").join("");}
  const footer=document.querySelector(".prototype-note");if(footer)footer.textContent="MemeLab · live Solana intelligence · risk and social intelligence follow in later development blocks.";
}

async function api(path,options={}){const response=await fetch(API_BASE+path,{cache:"no-store",...options,headers:{"Accept":"application/json",...(options.headers||{})}});if(!response.ok)throw new Error(response.status+" "+response.statusText);return response.json();}
async function refresh(){try{renderSnapshot(await api("/snapshot"));}catch(error){console.error("MemeLab snapshot failed:",error);const live=$(".live-pill");if(live)live.innerHTML="<i></i> API OFFLINE";}}
async function startEngine(){try{await api("/start",{method:"POST"});await refresh();}catch(error){console.error("MemeLab API start failed:",error);const live=$(".live-pill");if(live)live.innerHTML="<i></i> API OFFLINE";}}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));btn.classList.add("active");}));
startEngine();
setInterval(refresh,1000);
