(() => {
  const DEFAULT_startingCapital = 10000;
  let startingCapital = DEFAULT_startingCapital;
  let threshold = 3;
  let riskPct = 2;
  let riskPerTokenPct = 4;
  let capitalLimitPct = 20;
  let portfolioLimitPct = 50;
  let minPositionCapital = 250;
  let profitTimeoutMinutes = 120;
  let portfolioTakeAllPct = 5;
  let portfolioCycleBaselineEquity = startingCapital;
  let stopLossCooldownMinutes = 15;
  const stopLossGuards = new Map();

  // Cost Model V2 — Jupiter quote-only execution simulation.
  // V1 is used only when V2 is explicitly disabled.
  let costModelVersion = "V2";
  let costModelEnabled = true;
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const SOL_DECIMALS = 9;

  let positions = [];
  let journal = [];
  let lastSignals = [];
  let paperRunning = false;
  let liveTradingPrices = new Map();
  let previousTradingPrices = new Map();
  let tradingPriceDirections = new Map();
  let tradingPriceRefreshInFlight = false;
  let tradingPriceFeedStatus = "INIT";
  let tradingPriceLastUpdateAt = 0;
  let sessionStartedAt = null;
  let sessionElapsedMs = 0;
  let paperCycleInFlight = false;
  let paperResetGeneration = 0;
  let tradingResetInFlight = false;
  let tradingCloudAlertVisible = false;
  let tradingAlertSource = null;
  const tradingEventsAbortControllers = new Set();
  const paperConsumedEngineEvaluations = new Map();
  const $ = s => document.querySelector(s);
  const usd = v => Number.isFinite(Number(v)) ? "$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—";
  const pct = v => Number.isFinite(Number(v)) ? (Number(v)>=0?"+":"")+Number(v).toFixed(2)+"%" : "—";
  const price = v => {
    const n=Number(v); if(!Number.isFinite(n)) return "—";
    if(Math.abs(n)>=1) return "$"+n.toFixed(4);
    return "$"+n.toExponential(3);
  };
  const now=()=>Date.now();

  function showTradingInfrastructureAlert(source, titleText, bodyText, err){
    tradingCloudAlertVisible=true;
    tradingAlertSource=source;
    let box=document.getElementById("paper-trading-cloud-alert");
    if(!box){
      box=document.createElement("div");
      box.id="paper-trading-cloud-alert";
    }
    box.id="paper-trading-cloud-alert";
    box.style.cssText=[
      "position:fixed",
      "top:24px",
      "right:24px",
      "z-index:99999",
      "width:min(430px,calc(100vw - 48px))",
      "padding:18px 20px",
      "border:2px solid #dc2626",
      "border-radius:14px",
      "background:#1f1010",
      "color:#fff",
      "box-shadow:0 14px 40px rgba(0,0,0,.38)",
      "font-family:inherit",
      "pointer-events:none"
    ].join(";");
    const title=document.createElement("div");
    title.textContent=titleText;
    title.style.cssText="font-size:16px;font-weight:800;letter-spacing:.05em;color:#f87171;margin-bottom:8px;";
    const body=document.createElement("div");
    body.textContent=bodyText;
    body.style.cssText="font-size:14px;line-height:1.45;";
    const detail=document.createElement("div");
    detail.textContent=String(err?.message||"Unbekannter Cloud-Persistenzfehler");
    detail.style.cssText="margin-top:9px;font-size:12px;line-height:1.35;color:#fca5a5;word-break:break-word;";
    box.append(title,body,detail);
    if(!box.parentElement) document.body.appendChild(box);
  }

  function showTradingCloudAlert(err){
    showTradingInfrastructureAlert(
      "cloud",
      "CLOUD DATABASE OFFLINE",
      "Supabase ist aktuell nicht erreichbar. Paper Trading bleibt aktiv; die nächsten Trading-Cycles versuchen die Persistenz automatisch erneut.",
      err
    );
  }

  function showTradingPriceAlert(err){
    showTradingInfrastructureAlert(
      "prices",
      "MARKET DATA FEED OFFLINE",
      "Der aktuelle Jupiter-Preisfeed antwortet nicht rechtzeitig. Die Preisaktualisierung wird automatisch erneut versucht.",
      err
    );
  }

  function clearTradingCloudAlert(source=null){
    const box=document.getElementById("paper-trading-cloud-alert");
    if(source && tradingAlertSource!==source) return;
    if(box) box.remove();
    tradingCloudAlertVisible=false;
    tradingAlertSource=null;
  }

  function stopLossGuardBlocksEntry(mint, signal){
    const guard=stopLossGuards.get(mint);
    if(!guard) return false;
    if(signal!=="BUY") guard.rearmed=true;
    const cooldownUntil=Number(guard.cooldownUntil)||0;
    const rearmed=Boolean(guard.rearmed);
    if(now()>=cooldownUntil && rearmed){
      stopLossGuards.delete(mint);
      return false;
    }
    return true;
  }
  const TP_R = 2;
  const SL_R = 1;

  function jupiterQuoteCosts(quote){
    const solPrice=solUsdPrice();
    const feeMint=quote?.fee_mint;
    const inputMint=quote?.input_mint;
    const outputMint=quote?.output_mint;
    const inputAmount=Number(quote?.input_amount);
    const outputAmount=Number(quote?.output_amount);
    const inputUsd=Number(quote?.input_usd);
    const outputUsd=Number(quote?.output_usd);
    const clientInputUsd=Number(quote?.client_input_usd);
    const clientOutputUsd=Number(quote?.client_output_usd);
    const quotedSwapUsd=Number(quote?.swap_usd_value);
    const clientSwapUsd=Number(quote?.client_swap_usd_value);
    const persistedEntryCapital=Number(quote?.client_entry_capital_usd);
    const platformRaw=Number(quote?.platform_fee_amount_raw);
    const platformBps=Number(quote?.platform_fee_bps);
    const feeBps=Number(quote?.quoted_fee_bps);
    let swapUsdValue=null, swapUsdSource=null;
    for(const [value,source] of [
      [quotedSwapUsd,"jupiter.swapUsdValue"],[clientSwapUsd,"client.quoteNotional"],[persistedEntryCapital,"position.entryCapital"],
      [clientInputUsd,"client.inputUsd"],[inputUsd,"jupiter.inUsdValue"],
      [clientOutputUsd,"client.outputUsd"],[outputUsd,"jupiter.outUsdValue"]
    ]){ if(Number.isFinite(value)&&value>0){swapUsdValue=value;swapUsdSource=source;break;} }
    let platformUsd=0, platformUsdSource="none";
    if(Number.isFinite(platformRaw)&&platformRaw>0){
      const decimals=feeMint===SOL_MINT?SOL_DECIMALS:(feeMint===inputMint?Number(quote?.input_decimals):Number(quote?.output_decimals));
      const units=platformRaw/(10**Number(decimals||0));
      if(feeMint===SOL_MINT&&Number.isFinite(solPrice)){platformUsd=units*solPrice;platformUsdSource="platformFee.amount·SOL";}
      else if(feeMint===inputMint&&inputAmount>0&&Number.isFinite(inputUsd)){platformUsd=(units/inputAmount)*inputUsd;platformUsdSource="platformFee.amount·input";}
      else if(feeMint===outputMint&&outputAmount>0&&Number.isFinite(outputUsd)){platformUsd=(units/outputAmount)*outputUsd;platformUsdSource="platformFee.amount·output";}
    }
    if(platformUsd<=0&&Number.isFinite(platformBps)&&platformBps>0&&Number.isFinite(swapUsdValue)){platformUsd=swapUsdValue*platformBps/10000;platformUsdSource="platformFee.bps·quoteNotional";}
    if(platformUsd<=0&&Number.isFinite(feeBps)&&feeBps>0&&Number.isFinite(swapUsdValue)){platformUsd=swapUsdValue*feeBps/10000;platformUsdSource="feeBps·quoteNotional";}
    const signatureLamports=Number(quote?.signature_fee_lamports);
    const priorityLamports=Number(quote?.prioritization_fee_lamports);
    const rentLamports=Number(quote?.rent_fee_lamports);
    const signatureUsd=Number.isFinite(signatureLamports)&&signatureLamports>0&&Number.isFinite(solPrice)?signatureLamports/1e9*solPrice:0;
    const priorityUsd=Number.isFinite(priorityLamports)&&priorityLamports>0&&Number.isFinite(solPrice)?priorityLamports/1e9*solPrice:0;
    const rentUsd=Number.isFinite(rentLamports)&&rentLamports>0&&Number.isFinite(solPrice)?rentLamports/1e9*solPrice:0;
    const networkUsd=signatureUsd+rentUsd;
    const total=platformUsd+networkUsd+priorityUsd;
    return {platformUsd,signatureUsd,priorityUsd,rentUsd,networkUsd,total,
      platformBps:Number.isFinite(platformBps)?platformBps:null,feeBps:Number.isFinite(feeBps)?feeBps:null,
      swapUsdValue:Number.isFinite(swapUsdValue)?swapUsdValue:null,swapUsdSource,platformUsdSource,
      rawPlatformFeeAmount:Number.isFinite(platformRaw)?platformRaw:null,feeMint:feeMint||null,
      inputUsd:Number.isFinite(inputUsd)?inputUsd:null,outputUsd:Number.isFinite(outputUsd)?outputUsd:null,
      clientInputUsd:Number.isFinite(clientInputUsd)?clientInputUsd:null,clientOutputUsd:Number.isFinite(clientOutputUsd)?clientOutputUsd:null,
      signatureLamports:Number.isFinite(signatureLamports)?signatureLamports:null,priorityLamports:Number.isFinite(priorityLamports)?priorityLamports:null,rentLamports:Number.isFinite(rentLamports)?rentLamports:null};
  }

  function estimatedEntryCost(p){
    if(p?.costModel==="V2") return Number(p?.v2EntryCost?.total||0);
    return 0;
  }
  function estimatedExitCost(p, exitPrice){
    if(p?.costModel==="V2") return Number(p?.v2ExitCost?.total||0);
    return 0;
  }
  function positionGrossPnl(p, exitPrice){
    return (Number(exitPrice)-Number(p.entry))*Number(p.qty||0);
  }
  function positionNetPnl(p, exitPrice){
    return positionGrossPnl(p,exitPrice)-estimatedEntryCost(p)-estimatedExitCost(p,exitPrice);
  }

  async function jupiterOrderQuote(inputMint, outputMint, amountRaw, inputDecimals, outputDecimals){
    if(costModelVersion!=="V2" || !costModelEnabled) return null;
    if(!inputMint||!outputMint||!Number.isFinite(Number(amountRaw))||Number(amountRaw)<=0) return null;
    try{
      const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
      const url=apiBase+"/jupiter/order?"+new URLSearchParams({
        inputMint,outputMint,
        amount:String(Math.floor(Number(amountRaw))),
        inputDecimals:String(inputDecimals),
        outputDecimals:String(outputDecimals)
      }).toString();
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),5000);
      const response=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"},signal:controller.signal});
      if(!response.ok){
        let detail="HTTP "+response.status;
        try{ const body=await response.text(); if(body) detail+=" · "+body.slice(0,240); }catch(_err){}
        console.warn("Jupiter V2 quote failed:",detail);
        return null;
      }
      const data=await response.json();
      const q=data?.quote;
      if(!q || q.executed===true || q.transaction_present===true) return null;
      return q;
    }catch(err){
      if(err?.name!=="AbortError") console.debug("Jupiter V2 quote:",err);
      return null;
    }finally{
      clearTimeout(timeout);
    }
  }

  function solUsdPrice(){
    const n=Number(liveTradingPrices.get(SOL_MINT));
    return Number.isFinite(n)&&n>0?n:null;
  }

  async function quoteEntryV2(capitalUsd, token){
    const solPrice=solUsdPrice();
    const decimals=Number(token?.decimals);
    if(!Number.isFinite(solPrice)||solPrice<=0||!Number.isInteger(decimals)||decimals<0) return null;
    const solAmount=Number(capitalUsd)/solPrice;
    const solRaw=Math.floor(solAmount*10**SOL_DECIMALS);
    const quote=await jupiterOrderQuote(SOL_MINT,token.mint,solRaw,SOL_DECIMALS,decimals);
    if(!quote || !Number.isFinite(Number(quote.output_amount)) || Number(quote.output_amount)<=0) return null;
    quote.client_input_usd=Number(capitalUsd);
    quote.client_swap_usd_value=Number(capitalUsd);
    quote.client_entry_capital_usd=Number(capitalUsd);
    const qty=Number(quote.output_amount);
    if(!Number.isFinite(qty)||qty<=0) return null;
    return {quote,qty,capitalUsd,effectiveEntry:capitalUsd/qty,solAmount,cost:jupiterQuoteCosts(quote)};
  }

  async function quoteExitV2(position){
    const solPrice=solUsdPrice();
    const decimals=Number(position?.t?.decimals ?? position?.decimals);
    if(!Number.isFinite(solPrice)||solPrice<=0||!Number.isInteger(decimals)||decimals<0) return null;
    const tokenRaw=Math.floor(Number(position.qty)*10**decimals);
    const quote=await jupiterOrderQuote(position.mint,SOL_MINT,tokenRaw,decimals,SOL_DECIMALS);
    if(!quote || !Number.isFinite(Number(quote.output_amount))) return null;
    const solOut=Number(quote.output_amount);
    if(solOut<=0) return null;
    const inputUsd=Math.max(0,Number(position.qty||0)*Number(currentPrice(position)||0));
    quote.client_input_usd=inputUsd;
    quote.client_swap_usd_value=inputUsd;
    return {quote,exitUsd:solOut*solPrice,solOut,cost:jupiterQuoteCosts(quote)};
  }
  function realizedPnl(){ return journal.reduce((s,p)=>s+Number(p.netPnl??p.pnl??0),0); }
  function openPnl(){ return positions.reduce((s,p)=>{const current=currentPrice(p)||p.entry;return s+positionNetPnl(p,current);},0); }
  function currentEquity(){ return startingCapital+realizedPnl()+openPnl(); }
  function totalEstimatedCosts(){
    const closed=journal.reduce((s,p)=>s+Number(p.costTotal||0),0);
    const open=positions.reduce((s,p)=>{const current=currentPrice(p)||p.entry;return s+estimatedEntryCost(p)+estimatedExitCost(p,current);},0);
    return closed+open;
  }
  function v2FeeLabel(p){
    if(p?.costModel!=="V2") return null;
    const renderQuote=(label,q,cost)=>{
      if(!q&&!cost)return "";
      q=q||{};cost=cost||{};
      const n=v=>Number.isFinite(Number(v))?String(v):"—";
      const m=v=>Number.isFinite(Number(v))?usd(v):"—";
      return '<div class="paper-v2-debug"><strong>'+label+'</strong>'
        +' · feeBps='+n(q.quoted_fee_bps)+' · platformBps='+n(q.platform_fee_bps)
        +' · feeMint='+(q.fee_mint||"—")+' · quoteBase='+m(cost.swapUsdValue)
        +' · router='+(q.router||"—")+' · requestId='+(q.request_id||"—")
        +' · inRaw='+n(q.input_amount_raw)+' · outRaw='+n(q.output_amount_raw)
        +' · priceImpact='+(q.price_impact??"—")+' · slippageBps='+(q.slippage_bps??"—")+' · gasless='+(q.gasless??"—")
        +' · baseSource='+(cost.swapUsdSource||"—")+' · platformRaw='+n(cost.rawPlatformFeeAmount)
        +' · platformUSD='+m(cost.platformUsd)+' · inUSD='+m(q.input_usd)+' · outUSD='+m(q.output_usd)
        +' · clientInUSD='+m(q.client_input_usd)+' · clientNotional='+m(q.client_swap_usd_value||q.client_entry_capital_usd)
        +' · sigLamports='+n(q.signature_fee_lamports)+' · priorityLamports='+n(q.prioritization_fee_lamports)
        +' · rentLamports='+n(q.rent_fee_lamports)+' · total='+m(cost.total)+'</div>';
    };
    return renderQuote("ENTRY",p.v2EntryQuote,p.v2EntryCost)+renderQuote("EXIT",p.v2ExitQuote,p.v2ExitCost);
  }

  function portfolioCyclePnl(){ return currentEquity()-portfolioCycleBaselineEquity; }
  function portfolioCyclePnlPct(){
    const base=Number(portfolioCycleBaselineEquity)||startingCapital;
    return base>0?(portfolioCyclePnl()/base)*100:0;
  }
  function investedCapital(){ return positions.reduce((s,p)=>s+(Number(p.entry)||0)*(Number(p.qty)||0),0); }
  function availableCash(){
    const openEntryCosts=positions.reduce((s,p)=>s+estimatedEntryCost(p),0);
    return Math.max(0,startingCapital+realizedPnl()-investedCapital()-openEntryCosts);
  }
  function liveToken(mint){
    const list=window.MEMELAB_JUPITER_TOKENS||[];
    return list.find(t=>t?.mint===mint)||null;
  }
  function currentPrice(p){
    const livePrice=Number(liveTradingPrices.get(p.mint));
    if(Number.isFinite(livePrice)&&livePrice>0){
      if(!p.t) p.t={mint:p.mint,symbol:p.symbol,name:p.name};
      p.t.price_usd=livePrice;
      return livePrice;
    }
    const live=liveToken(p.mint);
    const n=Number(live?.price_usd);
    if(Number.isFinite(n)&&n>0){p.t=live;return n;}
    const fallback=Number(p.t?.price_usd);
    return Number.isFinite(fallback)&&fallback>0?fallback:Number(p.entry)||null;
  }

  async function refreshTradingPrices(){
    if(tradingPriceRefreshInFlight) return false;
    const engine=window.MEMELAB_ENGINE;
    const candidateList=engine?.getCandidates?.()||[];
    const mints=[
      SOL_MINT,
      ...positions.map(p=>p.mint),
      ...candidateList.map(t=>t?.mint)
    ].filter(Boolean);
    const unique=[...new Set(mints)].slice(0,50);
    if(!unique.length) return false;
    tradingPriceRefreshInFlight=true;
    try{
      const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),3000);
      const response=await fetch(apiBase+"/trading/prices?mints="+encodeURIComponent(unique.join(",")),{cache:"no-store",headers:{Accept:"application/json"},signal:controller.signal});
      if(!response.ok){ tradingPriceFeedStatus="ERROR"; return false; }
      const data=await response.json();
      const prices=data?.prices||{};
      const observedAt=Date.now()/1000;
      for(const [mint,item] of Object.entries(prices)){
        const usdPrice=Number(item?.usdPrice);
        if(!Number.isFinite(usdPrice)||usdPrice<=0) continue;
        const previous=Number(liveTradingPrices.get(mint));
        if(Number.isFinite(previous)&&previous>0){
          const epsilon=Math.max(previous*0.000001,1e-12);
          tradingPriceDirections.set(mint,usdPrice>previous+epsilon?"up":usdPrice<previous-epsilon?"down":"flat");
          previousTradingPrices.set(mint,previous);
        }else{
          tradingPriceDirections.set(mint,"flat");
        }
        liveTradingPrices.set(mint,usdPrice);
        const token=liveToken(mint);
        if(token){
          token.price_usd=usdPrice;
          token._tradingPriceObservedAt=observedAt;
        }
        const candidate=candidateList.find(t=>t?.mint===mint);
        if(candidate){
          candidate.price_usd=usdPrice;
          candidate._tradingPriceObservedAt=observedAt;
          candidate._engineHistory=Array.isArray(candidate._engineHistory)?candidate._engineHistory:[];
          candidate._engineHistory.push({observed_at:observedAt,price_usd:usdPrice});
          if(candidate._engineHistory.length>120) candidate._engineHistory=candidate._engineHistory.slice(-120);
        }
      }
      const count=Object.keys(prices).length;
      tradingPriceFeedStatus=count>0?"LIVE":"NO_DATA";
      if(count>0){
        tradingPriceLastUpdateAt=Date.now();
        clearTradingCloudAlert("prices");
      }
      return count>0;
    }catch(err){
      tradingPriceFeedStatus=err?.name==="AbortError"?"TIMEOUT":"ERROR";
      showTradingPriceAlert(err);
      if(err?.name!=="AbortError") console.debug("Trading price refresh:",err);
      return false;
    }finally{
      clearTimeout(timeout);
      tradingPriceRefreshInFlight=false;
    }
  }

  async function openPaperPosition(x, options={}){
    const manual=!!options.manual;
    const generation=paperResetGeneration;
    if(!paperRunning && !manual) return false;
    const t=x.t, e=x.e||{};
    const signal=e.signal||null;
    if(stopLossGuardBlocksEntry(t.mint, signal)) return false;
    if((!manual && signal!=="BUY") || (!manual && Number(e.strength)<Number(threshold))) return false;
    if(e.entry==null || e.stop==null || e.take==null || Number(e.entry)<=0 || Number(e.stop)>=Number(e.entry)) return false;

    const equity=startingCapital+realizedPnl()+positions.reduce((s,p)=>s+(currentPrice(p)-p.entry)*p.qty,0);
    const activityRiskMultiplier=manual?1:Math.min(1,Math.max(0.5,Number(e.riskMultiplier)||1));
    const appliedRiskPct=Number(riskPct)*activityRiskMultiplier;
    const riskAmount=Math.max(0,equity*(appliedRiskPct/100));
    const maxTokenRisk=Math.max(0,equity*(Number(riskPerTokenPct)/100));
    const existingTokenRisk=positions.filter(p=>p.mint===t.mint).reduce((sum,p)=>{
      const storedRisk=Number(p.riskAmount);
      if(Number.isFinite(storedRisk)&&storedRisk>=0) return sum+storedRisk;
      const qty=Number(p.qty)||0, entry=Number(p.entry)||0, stop=Number(p.stop)||0;
      return sum+(qty*Math.max(0,entry-stop));
    },0);
    const remainingTokenRisk=Math.max(0,maxTokenRisk-existingTokenRisk);
    const entryRisk=Math.min(riskAmount,remainingTokenRisk);
    const unitRisk=Number(e.entry)-Number(e.stop);
    if(entryRisk<=0 || unitRisk<=0) return false;
    let qty=entryRisk/unitRisk;
    const maxAffordable=availableCash()/Number(e.entry);
    const maxCapital=equity*(Number(capitalLimitPct)/100);
    const maxByCapital=maxCapital/Number(e.entry);
    const portfolioCapitalLimit=equity*(Number(portfolioLimitPct)/100);
    const remainingPortfolioCapital=Math.max(0,portfolioCapitalLimit-investedCapital());
    const maxByPortfolio=remainingPortfolioCapital/Number(e.entry);
    qty=Math.min(qty,maxAffordable,maxByCapital,maxByPortfolio);
    if(!Number.isFinite(qty)||qty<=0) return false;
    const finalCapital=qty*Number(e.entry);
    if(finalCapital < Number(minPositionCapital)) return false;

    let entry=Number(e.entry), finalQty=qty, v2=null;
    if(costModelVersion==="V2" && costModelEnabled){
      v2=await quoteEntryV2(finalCapital,t);
      if(!v2) return false;
      if(generation!==paperResetGeneration || (!paperRunning && !manual)) return false;
      finalQty=v2.qty;
      entry=v2.effectiveEntry;
    }

    if(generation!==paperResetGeneration || (!paperRunning && !manual)) return false;

    const stopRatio=Number(e.stop)/Number(e.entry);
    const takeRatio=Number(e.take)/Number(e.entry);
    const stop=entry*stopRatio;
    const take=entry*takeRatio;
    const actualRisk=finalQty*Math.max(0,entry-stop);
    if(actualRisk>remainingTokenRisk+1e-9) return false;

    const position={
      mint:t.mint,symbol:t.symbol||t.name||"—",name:t.name||"",
      entry,stop,take,qty:finalQty,riskAmount:actualRisk,size:finalCapital,
      riskMultiplier:activityRiskMultiplier,appliedRiskPct,
      entryCapital:finalCapital,openedAt:now(),
      positionId:"POS-"+t.mint+"-"+now(),t,
      costModel:v2?"V2":"V1",
      v2EntryQuote:v2?.quote||null,
      v2EntryCost:v2?.cost||null
    };
    const persisted=await postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"POSITION_OPEN",
      mint:t.mint,
      position_id:position.positionId,
      payload:{
        symbol:t.symbol||t.name||null,name:t.name||"",
        entry:Number(entry),stop:Number(stop),take:Number(take),qty:Number(finalQty),
        capital:Number(finalCapital),risk:Number(actualRisk),opened_at_ms:position.openedAt,
        risk_multiplier:Number(activityRiskMultiplier),applied_risk_pct:Number(appliedRiskPct),
        reason:manual?"MANUAL_BUY":"SIGNAL",
        token_decimals:Number(t.decimals),
        cost_model:position.costModel,
        v2_execution:position.v2EntryQuote ? {
          provider:"jupiter",mode:"quote_only",executed:false,
          request_id:v2.quote.request_id,router:v2.quote.router,
          input_mint:v2.quote.input_mint,output_mint:v2.quote.output_mint,
          input_amount:v2.quote.input_amount,output_amount:v2.quote.output_amount,
          quoted_fee_bps:v2.quote.quoted_fee_bps,fee_mint:v2.quote.fee_mint,
          platform_fee_amount:v2.quote.platform_fee_amount,
          platform_fee_bps:v2.quote.platform_fee_bps,
          client_input_usd:v2.quote.client_input_usd,
          client_swap_usd_value:v2.quote.client_swap_usd_value,
          client_entry_capital_usd:v2.quote.client_entry_capital_usd,
          signature_fee_lamports:v2.quote.signature_fee_lamports,
          prioritization_fee_lamports:v2.quote.prioritization_fee_lamports,
          rent_fee_lamports:v2.quote.rent_fee_lamports,
          gasless:v2.quote.gasless,
          platform_fee_usd:Number(v2.cost?.platformUsd||0),
          network_fee_usd:Number(v2.cost?.networkUsd||0),
          priority_fee_usd:Number(v2.cost?.priorityUsd||0),
          total_cost_usd:Number(v2.cost?.total||0)
        } : null
      }
    }]);
    if(!persisted) return false;
    if(generation!==paperResetGeneration || (!paperRunning && !manual)) return false;
    positions.push(position);
    if(!manual && Number(x.evaluationId)>0){
      paperConsumedEngineEvaluations.set(t.mint,Number(x.evaluationId));
    }
    saveLocalPaperSnapshot();
    return true;
  }

  async function manualSell(p){
    const current=currentPrice(p);
    if(current==null) return false;
    await closePaperPosition(p,current,"MANUAL SELL");
    return true;
  }

  async function closePaperPosition(p, exitPrice, reason){
    const exit=Number(exitPrice);
    if(!Number.isFinite(exit)||exit<=0) return;
    let grossPnl=(exit-p.entry)*p.qty;
    let entryCost=estimatedEntryCost(p);
    let exitCost=estimatedExitCost(p,exit);
    let costTotal=entryCost+exitCost;
    let netPnl=grossPnl-costTotal;
    let v2Exit=null;

    if(p.costModel==="V2"){
      // V2 is quote-only execution/fee diagnostics. It must never replace the
      // canonical paper-market exit price with a router-dependent swap valuation.
      v2Exit=await quoteExitV2(p);
      if(v2Exit){
        entryCost=Number(p.v2EntryCost?.total||0);
        exitCost=Number(v2Exit.cost?.total||0);
        costTotal=entryCost+exitCost;
        netPnl=grossPnl-costTotal;
      }
      // A missing V2 quote must not block a paper position from closing.
      // grossPnl and the displayed exit remain based on the canonical market exit.
    }

    const size=Number(p.entryCapital||p.size||p.entry*p.qty);
    const journalEntry={
      id:"PT-"+String(journal.length+1).padStart(4,"0"),
      mint:p.mint,symbol:p.symbol,entryPriceText:price(p.entry),exitPriceText:price(exit),
      reason,size,pnl:grossPnl,grossPnl,entryCost,exitCost,costTotal,netPnl,
      pnlPct:size?((grossPnl/size)*100):0,
      netPnlPct:size?((netPnl/size)*100):0,
      durationMs:Math.max(0,now()-p.openedAt),entry:p.entry,exit,qty:p.qty,
      costModel:p.costModel||"V1",
      v2EntryQuote:p.v2EntryQuote||null,
      v2ExitQuote:v2Exit?.quote||null,
      v2EntryCost:p.v2EntryCost||null,
      v2ExitCost:v2Exit?.cost||null,
      v2NetworkFeeKnown:Boolean(p.v2EntryCost?.networkUsd!=null || v2Exit?.cost?.networkUsd!=null),
      v2PriorityFeeKnown:Boolean(p.v2EntryCost?.priorityUsd!=null || v2Exit?.cost?.priorityUsd!=null)
    };
    const persisted=await postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"POSITION_CLOSE",
      mint:p.mint,
      position_id:p.positionId||p.mint,
      payload:{symbol:p.symbol,entry:Number(p.entry),exit:Number(exit),qty:Number(p.qty),capital:Number(size),opened_at_ms:Number(p.openedAt||0),pnl:Number(netPnl),cost_model:p.costModel||"V1",v2_execution:v2Exit ? {provider:"jupiter",mode:"quote_only",executed:false,request_id:v2Exit.quote.request_id,router:v2Exit.quote.router,input_mint:v2Exit.quote.input_mint,output_mint:v2Exit.quote.output_mint,input_amount:v2Exit.quote.input_amount,output_amount:v2Exit.quote.output_amount,quoted_fee_bps:v2Exit.quote.quoted_fee_bps,fee_mint:v2Exit.quote.fee_mint,platform_fee_amount:v2Exit.quote.platform_fee_amount,platform_fee_bps:v2Exit.quote.platform_fee_bps,network_fee_usd:null,priority_fee_usd:null} : null,pnl_pct:Number(size?((netPnl/size)*100):0),gross_pnl:Number(grossPnl),entry_cost:Number(entryCost),exit_cost:Number(exitCost),cost_total:Number(costTotal),net_pnl:Number(netPnl),net_pnl_pct:Number(size?((netPnl/size)*100):0),entry_price_text:price(p.entry),exit_price_text:price(exit),duration_ms:Math.max(0,now()-p.openedAt),reason}
    }]);
    if(!persisted) return false;
    journal.push(journalEntry);
    positions=positions.filter(x=>x!==p);
    if(reason==="STOP LOSS"){
      const stoppedAt=now();
      const cooldownMs=Math.max(5,Math.min(1440,Number(stopLossCooldownMinutes)||15))*60*1000;
      stopLossGuards.set(p.mint,{
        stoppedAt,
        cooldownUntil:stoppedAt+cooldownMs,
        rearmed:false
      });
    }
    saveLocalPaperSnapshot();
    return true;
  }

  async function manageOpenPositions(){
    for(const p of [...positions]){
      const current=currentPrice(p);
      if(current==null) continue;
      if(current<=p.stop){ await closePaperPosition(p,p.stop,"STOP LOSS"); continue; }
      if(current>=p.take){ await closePaperPosition(p,p.take,"TAKE PROFIT"); continue; }
      const timeout=Number(profitTimeoutMinutes);
      const ageMinutes=(now()-p.openedAt)/60000;
      const pnl=positionNetPnl(p,current);
      if(timeout>0 && ageMinutes>=timeout && pnl>0){
        await closePaperPosition(p,current,"PROFIT TIMEOUT");
        continue;
      }
      p.t=p.t;
    }
  }

  async function takeAllPortfolio(){
    if(!positions.length) return false;
    const target=Number(portfolioTakeAllPct);
    if(!Number.isFinite(target)||target<=0) return false;
    if(portfolioCyclePnlPct()<target) return false;
    const open=[...positions];
    for(const p of open){
      const current=currentPrice(p);
      if(current!=null) await closePaperPosition(p,current,"PORTFOLIO TAKE ALL");
    }
    const cyclePnl=portfolioCyclePnl();
    const cyclePnlPct=portfolioCyclePnlPct();
    postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"PORTFOLIO_TAKE_ALL",
      position_id:null,
      payload:{cycle_pnl:Number(cyclePnl),cycle_pnl_pct:Number(cyclePnlPct),target_pct:Number(target),closed_positions:open.length,equity:Number(currentEquity())}
    }]);
    portfolioCycleBaselineEquity=currentEquity();
    return true;
  }

  async function executePaperCycle(){
    if(paperCycleInFlight) return;
    paperCycleInFlight=true;
    const generation=paperResetGeneration;
    try{
      const hadPositions=positions.length>0;
      await manageOpenPositions();
      if(generation!==paperResetGeneration) return;
      if(hadPositions && positions.length===0) portfolioCycleBaselineEquity=currentEquity();
      if(!paperRunning) return;
      if(await takeAllPortfolio()) return;
      const rows=signalRows({pendingOnly:true});
      for(const x of rows){
        if(!paperRunning || generation!==paperResetGeneration) break;
        await openPaperPosition(x);
      }
    }finally{
      paperCycleInFlight=false;
    }
  }

  function manualBuy(t){
    if(!t?.mint) return false;
    const entry=Number(t.price_usd);
    if(!Number.isFinite(entry)||entry<=0) return false;
    const engine=window.MEMELAB_ENGINE;
    const engineSignal=engine?.signal?.(t)||{};
    const volatility=Number(engineSignal?.s?.volatility);
    const riskDistance=Math.max(0.015,Math.min(0.08,(Number.isFinite(volatility)&&volatility>0?volatility/1000:0.025)));
    const e={signal:"BUY",strength:100,entry,stop:entry*(1-riskDistance),take:entry*(1+riskDistance*TP_R),rr:TP_R,reasons:["MANUAL BUY"]};
    return openPaperPosition({t,e},{manual:true});
  }

  function signalRows({pendingOnly=false}={}){
    const engine=window.MEMELAB_ENGINE;
    const candidates=engine?.getCandidates?.()||[];
    return candidates.map((t,i)=>{
      const e=engine?.getEvaluation?.(t?.mint)||null;
      const evaluationId=Number(e?.evaluationId)||0;
      const evaluatedAt=Number(e?.evaluatedAt)||0;
      const consumedId=Number(paperConsumedEngineEvaluations.get(t?.mint))||0;
      if(pendingOnly && (!evaluationId || evaluationId<=consumedId)) return null;
      return {t,e,index:i,evaluationId,evaluatedAt};
    }).filter(Boolean);
  }

  const PAPER_STORAGE_KEY = "memelab.paperTrading.v1";
  const PAPER_PENDING_EVENTS_KEY = "memelab.paperTrading.pendingEvents.v1";

  function localPaperSnapshot(){
    return {
      savedAt: now(),
      positions,
      journal,
      state: {
        startingCapital, threshold, riskPct, riskPerTokenPct, capitalLimitPct, portfolioLimitPct,
        minPositionCapital, profitTimeoutMinutes, portfolioTakeAllPct, portfolioCycleBaselineEquity,
        stopLossCooldownMinutes,
        stopLossGuards:[...stopLossGuards.entries()],
      }
    };
  }

  function saveLocalPaperSnapshot(){
    try { localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(localPaperSnapshot())); } catch(_err) {}
  }

  async function resetPaperTrading(){
    if(paperCycleInFlight && !confirm("Ein Trading-Zyklus ist noch aktiv. RESET stoppt ihn und verwirft den laufenden Zyklus. Fortfahren?")) return;
    const raw=prompt("TEST RESET: Neues Startkapital in USD eingeben.", String(startingCapital));
    if(raw===null) return;
    const capital=Number(raw);
    if(!Number.isFinite(capital)||capital<=0){ alert("Ungültiges Startkapital."); return; }
    if(!confirm("ACHTUNG: Journal, Positionen, Kapital und die Supabase-Testdaten werden vollständig gelöscht. Nur Token-/Markt-/Discovery-Daten bleiben erhalten. Fortfahren?")) return;
    const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
    try{
      tradingResetInFlight=true;
      paperRunning=false;
      paperResetGeneration++;
      for(const controller of tradingEventsAbortControllers) controller.abort();
      tradingEventsAbortControllers.clear();
      updatePaperControl();
      const response=await fetch(apiBase+"/trading/reset",{method:"POST",headers:{"Accept":"application/json"}});
      const result=await response.json().catch(()=>({}));
      if(!response.ok || result.status!=="ok") throw new Error(result.error||("HTTP "+response.status));
      localStorage.removeItem(PAPER_STORAGE_KEY);
      localStorage.removeItem(PAPER_PENDING_EVENTS_KEY);
      paperConsumedEngineEvaluations.clear();
      positions=[]; journal=[]; startingCapital=capital; portfolioCycleBaselineEquity=capital;
      stopLossGuards.clear();
      lastSignals=[]; sessionStartedAt=null; sessionElapsedMs=0; paperRunning=false;
      liveTradingPrices.clear(); previousTradingPrices.clear(); tradingPriceDirections.clear();
      renderSignals(); renderPositions(); renderJournal(); renderPnl(); updatePaperControl(); renderSession();
      alert("Paper Trading wurde zurückgesetzt. Neues Startkapital: "+usd(capital));
    }catch(err){
      alert("Reset fehlgeschlagen: "+(err?.message||err));
    }finally{
      tradingResetInFlight=false;
    }
  }

  function restoreLocalPaperSnapshot(){
    try{
      const raw=localStorage.getItem(PAPER_STORAGE_KEY);
      if(!raw) return false;
      const data=JSON.parse(raw);
      if(!data || !Array.isArray(data.positions) || !Array.isArray(data.journal)) return false;
      const state=data.state||{};
      positions=data.positions.map(p=>({...p,costModel:p.costModel==="V2"&&p.v2EntryQuote?"V2":"V1",t:p.t||{mint:p.mint,symbol:p.symbol,name:p.name,price_usd:Number(p.lastCurrent)||Number(p.entry)||null}}));
      journal=data.journal;
      if(Number.isFinite(Number(state.startingCapital)) && Number(state.startingCapital)>0) startingCapital=Number(state.startingCapital);
      if(Number.isFinite(Number(state.threshold))) threshold=Number(state.threshold);
      if(Number.isFinite(Number(state.riskPct))) riskPct=Number(state.riskPct);
      if(Number.isFinite(Number(state.riskPerTokenPct))) riskPerTokenPct=Number(state.riskPerTokenPct);
      if(Number.isFinite(Number(state.capitalLimitPct))) capitalLimitPct=Number(state.capitalLimitPct);
      if(Number.isFinite(Number(state.portfolioLimitPct))) portfolioLimitPct=Number(state.portfolioLimitPct);
      if(Number.isFinite(Number(state.minPositionCapital))) minPositionCapital=Number(state.minPositionCapital);
      if(Number.isFinite(Number(state.profitTimeoutMinutes))) profitTimeoutMinutes=Number(state.profitTimeoutMinutes);
      if(Number.isFinite(Number(state.portfolioTakeAllPct))) portfolioTakeAllPct=Number(state.portfolioTakeAllPct);
      if(Number.isFinite(Number(state.portfolioCycleBaselineEquity))) portfolioCycleBaselineEquity=Number(state.portfolioCycleBaselineEquity);
      if(Number.isFinite(Number(state.stopLossCooldownMinutes))) stopLossCooldownMinutes=Math.max(5,Math.min(1440,Number(state.stopLossCooldownMinutes)));
      stopLossGuards.clear();
      if(Array.isArray(state.stopLossGuards)){
        for(const item of state.stopLossGuards){
          if(!Array.isArray(item)||item.length!==2) continue;
          const mint=item[0], guard=item[1]||{};
          if(typeof mint!=="string"||!mint) continue;
          stopLossGuards.set(mint,{
            stoppedAt:Number(guard.stoppedAt)||0,
            cooldownUntil:Number(guard.cooldownUntil)||0,
            rearmed:Boolean(guard.rearmed)
          });
        }
      }
      if(typeof state.costModelVersion==="string") costModelVersion=state.costModelVersion;
      if(typeof state.costModelEnabled==="boolean") costModelEnabled=state.costModelEnabled;
      paperRunning=Boolean(state.paperRunning);
      sessionStartedAt=Number.isFinite(Number(state.sessionStartedAt)) ? Number(state.sessionStartedAt) : null;
      sessionElapsedMs=Number.isFinite(Number(state.sessionElapsedMs)) ? Number(state.sessionElapsedMs) : 0;
      return true;
    }catch(_err){ return false; }
  }

  function loadPendingTradingEvents(){
    try{
      const raw=localStorage.getItem(PAPER_PENDING_EVENTS_KEY);
      const data=raw?JSON.parse(raw):[];
      return Array.isArray(data)?data:[];
    }catch(_err){ return []; }
  }

  function savePendingTradingEvents(events){
    try{
      if(Array.isArray(events)&&events.length) localStorage.setItem(PAPER_PENDING_EVENTS_KEY,JSON.stringify(events));
      else localStorage.removeItem(PAPER_PENDING_EVENTS_KEY);
    }catch(_err){}
  }

  async function postTradingEvents(events){
    if(!events.length || tradingResetInFlight) return false;
    saveLocalPaperSnapshot();
    const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
    const pending=loadPendingTradingEvents();
    const queueable=events.filter(event=>["POSITION_OPEN","POSITION_CLOSE","PORTFOLIO_TAKE_ALL"].includes(String(event?.event_type||"")));
    const batch=[...pending,...queueable];
    const controller=new AbortController();
    tradingEventsAbortControllers.add(controller);
    try{
      const response=await fetch(apiBase+"/trading/events",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({events:batch}),
        signal:controller.signal
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok || result.status!=="ok") throw new Error(result.error||("HTTP "+response.status));
      savePendingTradingEvents([]);
      clearTradingCloudAlert("cloud");
      return true;
    }catch(err){
      if(err?.name==="AbortError") return false;
      if(batch.length) savePendingTradingEvents(batch);
      console.error("Paper Trading persistence failed; trading event batch queued locally:",err);
      showTradingCloudAlert(err);
      // Cloud persistence is retried separately. The local paper-trading state
      // must not be blocked by a transient Supabase outage.
      return true;
    }finally{
      tradingEventsAbortControllers.delete(controller);
    }
  }

  function captureTradingState(){
    const ts=Date.now()/1000;
    const events=[{
      event_id:crypto.randomUUID(),
      observed_at:ts,
      event_type:"TRADING_STATE",
      position_id:null,
      payload:{
        threshold:Number(threshold),
        riskPct:Number(riskPct),
        riskPerTokenPct:Number(riskPerTokenPct),
        capitalLimitPct:Number(capitalLimitPct),
        portfolioLimitPct:Number(portfolioLimitPct),
        profitTimeoutMinutes:Number(profitTimeoutMinutes),
        portfolioTakeAllPct:Number(portfolioTakeAllPct),
        portfolioCycleBaselineEquity:Number(portfolioCycleBaselineEquity),
        startingCapital:Number(startingCapital),
        stopLossCooldownMinutes:Number(stopLossCooldownMinutes),
        stopLossGuards:[...stopLossGuards.entries()],

        sessionStartedAt:Number(sessionStartedAt)||null,
        sessionElapsedMs:Number(sessionElapsedMs)||0
      }
    }];
    // A stopped engine must not recreate paper-trading rows immediately after
    // a RESET. Local storage remains the stopped-state persistence mechanism;
    // Supabase is kept clean until paper trading is started again.
    if(!paperRunning || tradingResetInFlight) return;
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
          core_score:Number(t.core_score)||null
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
          unrealized_pnl:Number(current&&p.qty?positionNetPnl(p,current):0),
          unrealized_gross_pnl:Number(current&&p.qty?positionGrossPnl(p,current):0),
          estimated_costs:Number(current&&p.qty?(estimatedEntryCost(p)+estimatedExitCost(p,current)):0),
          age_seconds:Math.max(0,(Date.now()-p.openedAt)/1000)
        }
      });
    }
    postTradingEvents(events);
  }


  async function restoreTradingState(){
    try{
      const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
      const response=await fetch(apiBase+"/trading/state",{headers:{"Accept":"application/json"},cache:"no-store"});
      if(!response.ok) return false;
      const data=await response.json();
      const state=data?.state||{};
      const restoredPositions=Array.isArray(data?.positions)?data.positions:[];
      const restoredJournal=Array.isArray(data?.journal)?data.journal:[];
      if(Object.keys(state).length){
        if(Number.isFinite(Number(state.startingCapital)) && Number(state.startingCapital)>0) startingCapital=Number(state.startingCapital);
        if(Number.isFinite(Number(state.threshold))) threshold=Number(state.threshold);
        if(Number.isFinite(Number(state.riskPct))) riskPct=Number(state.riskPct);
        if(Number.isFinite(Number(state.riskPerTokenPct))) riskPerTokenPct=Number(state.riskPerTokenPct);
        if(Number.isFinite(Number(state.capitalLimitPct))) capitalLimitPct=Number(state.capitalLimitPct);
        if(Number.isFinite(Number(state.portfolioLimitPct))) portfolioLimitPct=Number(state.portfolioLimitPct);
        if(Number.isFinite(Number(state.minPositionCapital))) minPositionCapital=Number(state.minPositionCapital);
        if(Number.isFinite(Number(state.profitTimeoutMinutes))) profitTimeoutMinutes=Number(state.profitTimeoutMinutes);
        if(Number.isFinite(Number(state.portfolioTakeAllPct))) portfolioTakeAllPct=Number(state.portfolioTakeAllPct);
        if(Number.isFinite(Number(state.portfolioCycleBaselineEquity))) portfolioCycleBaselineEquity=Number(state.portfolioCycleBaselineEquity);
        if(Number.isFinite(Number(state.stopLossCooldownMinutes))) stopLossCooldownMinutes=Math.max(5,Math.min(1440,Number(state.stopLossCooldownMinutes)));
        stopLossGuards.clear();
        if(Array.isArray(state.stopLossGuards)){
          for(const item of state.stopLossGuards){
            if(!Array.isArray(item)||item.length!==2) continue;
            const mint=item[0], guard=item[1]||{};
            if(typeof mint!=="string"||!mint) continue;
            stopLossGuards.set(mint,{
              stoppedAt:Number(guard.stoppedAt)||0,
              cooldownUntil:Number(guard.cooldownUntil)||0,
              rearmed:Boolean(guard.rearmed)