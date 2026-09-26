/* MemeLab Jupiter mainnet feed presentation.
   Jupiter API access stays server-side; the browser consumes MemeLab's proxy. */
(() => {
  const apiBase = window.MEMELAB_API_URL || "http://127.0.0.1:8765/api";
  let tokens = [];
  let ingestCount = 0;
  let discoveryRunning = false;
  let discoveryPollTimer = null;
  const DISCOVERY_INTERVAL_STORAGE_KEY = "memelab.discovery.intervalMs";
  const DISCOVERY_INTERVAL_DEFAULT_MS = 3600000;
  const DISCOVERY_INTERVAL_OPTIONS = [
    { value: 5000, label: "5 s · Turbo Discovery" },
    { value: 30000, label: "30 s" },
    { value: 300000, label: "5 min" },
    { value: 3600000, label: "1 h · Normal" }
  ];
  function loadDiscoveryIntervalMs(){
    try{
      const raw=Number(localStorage.getItem(DISCOVERY_INTERVAL_STORAGE_KEY));
      if(DISCOVERY_INTERVAL_OPTIONS.some(o=>o.value===raw)) return raw;
    }catch(e){}
    return DISCOVERY_INTERVAL_DEFAULT_MS;
  }
  let discoveryIntervalMs = loadDiscoveryIntervalMs();
  let selectedMint = null;
  let lifecycleFilter = "DISCOVERED";
  const LIFECYCLE_STAGES = ["DISCOVERED","EMERGING","ACTIVE","MATURE","DECLINING","INACTIVE","ARCHIVED"];
  const $ = (s) => document.querySelector(s);
  const shortMint = (m) => !m ? "\u2014" : m.length <= 14 ? m : m.slice(0,7)+"\u2026"+m.slice(-5);
  const score = (v) => Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  const esc = v => String(v ?? "").replace(/&/g,"&").replace(/</g,"<").replace(/>/g,">").replace(/"/g,""").replace(/'/g,"&#39;");
  let positionHistory = [];
  const usd = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "\u2014";
    if (Math.abs(n) >= 1e9) return "$"+(n/1e9).toFixed(2)+"B";
    if (Math.abs(n) >= 1e6) return "$"+(n/1e6).toFixed(2)+"M";
    if (Math.abs(n) >= 1e3) return "$"+(n/1e3).toFixed(1)+"K";
    if (Math.abs(n) >= 1) return "$"+n.toFixed(2);
    return "$"+n.toExponential(2);
  };
  const stats24h = (t) => t?.stats_24h || {};
  const lifecycle = (t) => String(t?.lifecycle || "DISCOVERED").toUpperCase();

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
  let engineIntervalMs=1000;
  let engineCandidates=[];
  let engineWatchlistSize=50;
  let engineCursor=-1;
  let engineSelectedMint=null;
  let engineScannedAt=0;
  let watchlistStateTimer=null;
  let engineInitialized=false;
  let engineEvaluationSequence=0;
  const engineEvaluations=new Map();

  function engineNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function engineUsd(v){const n=engineNum(v);if(n==null)return "\u2014";if(Math.abs(n)>=1e6)return "$"+(n/1e6).toFixed(2)+"M";if(Math.abs(n)>=1e3)return "$"+(n/1e3).toFixed(1)+"K";if(Math.abs(n)>=1)return "$"+n.toFixed(2);return "$"+n.toExponential(2);}
  function enginePct(v){const n=engineNum(v);return n==null?"\u2014":(n>0?"+":"")+n.toFixed(2)+"%";}

  function engineInit(){
    if(!engineInitialized){
      const select=$("#engine-interval");
      if(select){
        select.value=String(engineIntervalMs);
        select.addEventListener("change",()=>engineStart({restart:true}));
      }
      const universe=$("#engine-watchlist-size");
      if(universe){
        universe.value=String(engineWatchlistSize);
      }
      engineInitialized=true;
    }
  }
})();
