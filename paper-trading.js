(() => {
  const START_CAPITAL = 10000;
  let threshold = 3;
  let riskPct = 2;
  let capitalLimitPct = 20;
  let portfolioLimitPct = 50;
  let minPositionCapital = 250;
  let profitTimeoutMinutes = 120;
  let portfolioTakeAllPct = 5;
  let portfolioCycleBaselineEquity = START_CAPITAL;

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
      const response=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
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
      console.debug("Jupiter V2 quote:",err);
      return null;
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
  function currentEquity(){ return START_CAPITAL+realizedPnl()+openPnl(); }
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
    const base=Number(portfolioCycleBaselineEquity)||START_CAPITAL;
    return base>0?(portfolioCyclePnl()/base)*100:0;
  }
  function investedCapital(){ return positions.reduce((s,p)=>s+(Number(p.entry)||0)*(Number(p.qty)||0),0); }
  function availableCash(){
    const openEntryCosts=positions.reduce((s,p)=>s+estimatedEntryCost(p),0);
    return Math.max(0,START_CAPITAL+realizedPnl()-investedCapital()-openEntryCosts);
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
      const response=await fetch(apiBase+"/trading/prices?mints="+encodeURIComponent(unique.join(",")),{cache:"no-store",headers:{Accept:"application/json"}});
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
      if(count>0) tradingPriceLastUpdateAt=Date.now();
      return count>0;
    }catch(err){
      tradingPriceFeedStatus="ERROR";
      console.debug("Trading price refresh:",err);
      return false;
    }finally{
      tradingPriceRefreshInFlight=false;
    }
  }

  async function openPaperPosition(x, options={}){
    const manual=!!options.manual;
    if(!paperRunning && !manual) return false;
    const t=x.t, e=x.e||{};
    if((!manual && e.signal!=="BUY") || (!manual && Number(e.strength)<Number(threshold))) return false;
    if(e.entry==null || e.stop==null || e.take==null || Number(e.entry)<=0 || Number(e.stop)>=Number(e.entry)) return false;
    if(positions.some(p=>p.mint===t.mint)) return false;

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
    const finalCapital=qty*Number(e.entry);
    if(finalCapital < Number(minPositionCapital)) return false;

    let entry=Number(e.entry), finalQty=qty, v2=null;
    if(costModelVersion==="V2" && costModelEnabled){
      v2=await quoteEntryV2(finalCapital,t);
      if(!v2) return false;
      finalQty=v2.qty;
      entry=v2.effectiveEntry;
    }

    const stopRatio=Number(e.stop)/Number(e.entry);
    const takeRatio=Number(e.take)/Number(e.entry);
    const stop=entry*stopRatio;
    const take=entry*takeRatio;
    const actualRisk=finalQty*Math.max(0,entry-stop);

    const position={
      mint:t.mint,symbol:t.symbol||t.name||"—",name:t.name||"",
      entry,stop,take,qty:finalQty,riskAmount:actualRisk,size:finalCapital,
      entryCapital:finalCapital,openedAt:now(),
      positionId:"POS-"+t.mint+"-"+now(),t,
      costModel:v2?"V2":"V1",
      v2EntryQuote:v2?.quote||null,
      v2EntryCost:v2?.cost||null
    };
    positions.push(position);

    postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"POSITION_OPEN",
      mint:t.mint,
      position_id:position.positionId,
      payload:{
        symbol:t.symbol||t.name||null,name:t.name||"",
        entry:Number(entry),stop:Number(stop),take:Number(take),qty:Number(finalQty),
        capital:Number(finalCapital),risk:Number(actualRisk),opened_at_ms:position.openedAt,
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
      v2Exit=await quoteExitV2(p);
      if(!v2Exit) return;
      const entryCapital=Number(p.entryCapital||p.size||p.entry*p.qty);
      // Net P&L is explicitly gross P&L minus the V2 cost total shown in the UI.
      // The quote economics remain visible in the cost fields; the journal must not
      // show identical gross and net values when costs are known.
      grossPnl=Number(v2Exit.exitUsd)-entryCapital;
      entryCost=Number(p.v2EntryCost?.total||0);
      exitCost=Number(v2Exit.cost?.total||0);
      costTotal=entryCost+exitCost;
      netPnl=grossPnl-costTotal;
    }

    const size=Number(p.entryCapital||p.size||p.entry*p.qty);
    journal.push({
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
    });
    positions=positions.filter(x=>x!==p);
    saveLocalPaperSnapshot();
    postTradingEvents([{
      event_id:crypto.randomUUID(),
      observed_at:Date.now()/1000,
      event_type:"POSITION_CLOSE",
      mint:p.mint,
      position_id:p.positionId||p.mint,
      payload:{symbol:p.symbol,entry:Number(p.entry),exit:Number(exit),qty:Number(p.qty),capital:Number(size),opened_at_ms:Number(p.openedAt||0),pnl:Number(netPnl),cost_model:p.costModel||"V1",v2_execution:v2Exit ? {provider:"jupiter",mode:"quote_only",executed:false,request_id:v2Exit.quote.request_id,router:v2Exit.quote.router,input_mint:v2Exit.quote.input_mint,output_mint:v2Exit.quote.output_mint,input_amount:v2Exit.quote.input_amount,output_amount:v2Exit.quote.output_amount,quoted_fee_bps:v2Exit.quote.quoted_fee_bps,fee_mint:v2Exit.quote.fee_mint,platform_fee_amount:v2Exit.quote.platform_fee_amount,platform_fee_bps:v2Exit.quote.platform_fee_bps,network_fee_usd:null,priority_fee_usd:null} : null,pnl_pct:Number(size?((netPnl/size)*100):0),gross_pnl:Number(grossPnl),entry_cost:Number(entryCost),exit_cost:Number(exitCost),cost_total:Number(costTotal),net_pnl:Number(netPnl),net_pnl_pct:Number(size?((netPnl/size)*100):0),entry_price_text:price(p.entry),exit_price_text:price(exit),duration_ms:Math.max(0,now()-p.openedAt),reason}
    }]);
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
    const hadPositions=positions.length>0;
    await manageOpenPositions();
    if(hadPositions && positions.length===0) portfolioCycleBaselineEquity=currentEquity();
    if(!paperRunning) return;
    if(await takeAllPortfolio()) return;
    const rows=signalRows();
    for(const x of rows) await openPaperPosition(x);
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

  const PAPER_STORAGE_KEY = "memelab.paperTrading.v1";

  function localPaperSnapshot(){
    return {
      savedAt: now(),
      positions,
      journal,
      state: {
        threshold, riskPct, capitalLimitPct, portfolioLimitPct,
        minPositionCapital, profitTimeoutMinutes, portfolioTakeAllPct, portfolioCycleBaselineEquity,

      }
    };
  }

  function saveLocalPaperSnapshot(){
    try { localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(localPaperSnapshot())); } catch(_err) {}
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
      if(Number.isFinite(Number(state.threshold))) threshold=Number(state.threshold);
      if(Number.isFinite(Number(state.riskPct))) riskPct=Number(state.riskPct);
      if(Number.isFinite(Number(state.capitalLimitPct))) capitalLimitPct=Number(state.capitalLimitPct);
      if(Number.isFinite(Number(state.portfolioLimitPct))) portfolioLimitPct=Number(state.portfolioLimitPct);
      if(Number.isFinite(Number(state.minPositionCapital))) minPositionCapital=Number(state.minPositionCapital);
      if(Number.isFinite(Number(state.profitTimeoutMinutes))) profitTimeoutMinutes=Number(state.profitTimeoutMinutes);
      if(Number.isFinite(Number(state.portfolioTakeAllPct))) portfolioTakeAllPct=Number(state.portfolioTakeAllPct);
      if(Number.isFinite(Number(state.portfolioCycleBaselineEquity))) portfolioCycleBaselineEquity=Number(state.portfolioCycleBaselineEquity);
      if(typeof state.costModelVersion==="string") costModelVersion=state.costModelVersion;
      if(typeof state.costModelEnabled==="boolean") costModelEnabled=state.costModelEnabled;
      paperRunning=Boolean(state.paperRunning);
      sessionStartedAt=Number.isFinite(Number(state.sessionStartedAt)) ? Number(state.sessionStartedAt) : null;
      sessionElapsedMs=Number.isFinite(Number(state.sessionElapsedMs)) ? Number(state.sessionElapsedMs) : 0;
      return true;
    }catch(_err){ return false; }
  }

  function postTradingEvents(events){
    if(!events.length) return;
    saveLocalPaperSnapshot();
    const apiBase=window.MEMELAB_API_URL||"http://127.0.0.1:8765/api";
    fetch(apiBase+"/trading/events",{
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({events})
    }).catch(()=>{});
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
        capitalLimitPct:Number(capitalLimitPct),
        portfolioLimitPct:Number(portfolioLimitPct),
        profitTimeoutMinutes:Number(profitTimeoutMinutes),
        portfolioTakeAllPct:Number(portfolioTakeAllPct),
        portfolioCycleBaselineEquity:Number(portfolioCycleBaselineEquity),

        sessionStartedAt:Number(sessionStartedAt)||null,
        sessionElapsedMs:Number(sessionElapsedMs)||0
      }
    }];
    if(!paperRunning){
      postTradingEvents(events);
      return;
    }
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
      const localRaw=(()=>{try{return localStorage.getItem(PAPER_STORAGE_KEY);}catch(_err){return null;}})();
      if(!Object.keys(state).length && restoredPositions.length===0 && restoredJournal.length===0 && localRaw){
        if(restoreLocalPaperSnapshot()) return true;
      }
      if(Object.keys(state).length){
        if(Number.isFinite(Number(state.threshold))) threshold=Number(state.threshold);
        if(Number.isFinite(Number(state.riskPct))) riskPct=Number(state.riskPct);
        if(Number.isFinite(Number(state.capitalLimitPct))) capitalLimitPct=Number(state.capitalLimitPct);
        if(Number.isFinite(Number(state.portfolioLimitPct))) portfolioLimitPct=Number(state.portfolioLimitPct);
        if(Number.isFinite(Number(state.minPositionCapital))) minPositionCapital=Number(state.minPositionCapital);
        if(Number.isFinite(Number(state.profitTimeoutMinutes))) profitTimeoutMinutes=Number(state.profitTimeoutMinutes);
        if(Number.isFinite(Number(state.portfolioTakeAllPct))) portfolioTakeAllPct=Number(state.portfolioTakeAllPct);
        if(Number.isFinite(Number(state.portfolioCycleBaselineEquity))) portfolioCycleBaselineEquity=Number(state.portfolioCycleBaselineEquity);
        if(typeof state.costModelVersion==="string") costModelVersion=state.costModelVersion;
        if(typeof state.costModelEnabled==="boolean") costModelEnabled=state.costModelEnabled;
        paperRunning=Boolean(state.paperRunning);
        sessionStartedAt=Number.isFinite(Number(state.sessionStartedAt)) ? Number(state.sessionStartedAt) : null;
        sessionElapsedMs=Number.isFinite(Number(state.sessionElapsedMs)) ? Number(state.sessionElapsedMs) : 0;
        if(paperRunning && !sessionStartedAt) sessionStartedAt=now();
      }
      positions=restoredPositions.map(p=>({...p,costModel:p.costModel==="V2"&&p.v2EntryQuote?"V2":"V1",t:{mint:p.mint,symbol:p.symbol,name:p.name,decimals:p.tokenDecimals,price_usd:Number(p.lastCurrent)||Number(p.entry)||null}}));
      const thresholdEl=$("#paper-threshold"), riskEl=$("#paper-risk"), capitalEl=$("#paper-capital-limit"), portfolioEl=$("#paper-portfolio-limit"), timeoutEl=$("#paper-profit-timeout"), takeAllEl=$("#paper-take-all");
      if(thresholdEl) thresholdEl.value=String(threshold);
      if(riskEl) riskEl.value=String(riskPct);
      if(capitalEl) capitalEl.value=String(capitalLimitPct);
      if(portfolioEl) portfolioEl.value=String(portfolioLimitPct);
      if(minPositionEl) minPositionEl.value=String(minPositionCapital);
      if(timeoutEl) timeoutEl.value=String(profitTimeoutMinutes);
      if(takeAllEl) takeAllEl.value=String(portfolioTakeAllPct);
      journal=restoredJournal.map(p=>({
        ...p,
        netPnl:Number(p.netPnl??p.pnl??0),
        costTotal:Number(p.costTotal||0),
        entryPriceText:typeof p.entryPriceText==="string"?p.entryPriceText:price(p.entry),
        exitPriceText:typeof p.exitPriceText==="string"?p.exitPriceText:price(p.exit),
        durationMs:Number(p.durationMs)||0
      }));
      saveLocalPaperSnapshot();
      return true;
    }catch(_err){
      if(restoreLocalPaperSnapshot()) return true;
      return false;
    }
  }

  function sessionDurationMs(){
    return sessionElapsedMs + (paperRunning && sessionStartedAt ? Math.max(0,now()-sessionStartedAt) : 0);
  }
  function formatSessionDuration(ms){
    const total=Math.floor(Math.max(0,Number(ms)||0)/1000);
    const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), sec=total%60;
    return [h,m,sec].map((v,i)=>i===0?String(v).padStart(2,"0"):String(v).padStart(2,"0")).join(":");
  }
  function renderSession(){
    const el=$("#paper-session");
    if(el) el.textContent=formatSessionDuration(sessionDurationMs());
  }
  function updatePaperControl(){
    const status=$("#paper-status");
    const btn=$("#paper-start-stop");
    if(btn){btn.textContent=paperRunning?"STOP PAPER":"START PAPER";btn.classList.toggle("running",paperRunning);}
    if(status) status.textContent=paperRunning
      ? "PAPER ENGINE RUNNING · new trades may be opened when BUY signals meet the configured threshold."
      : "PAPER ENGINE STOPPED · signals are monitored, but no new paper trades will be opened.";
    renderSession();
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
    const unrealized=openPnl();
    const openPnlEl=$("#paper-open-pnl");
    if(openPnlEl){openPnlEl.textContent="Unrealized P&L · "+usd(unrealized);openPnlEl.classList.toggle("paper-positive",unrealized>=0);openPnlEl.classList.toggle("paper-negative",unrealized<0);}
    const paperCostsEl=$("#paper-costs");
    if(paperCostsEl) paperCostsEl.textContent=usd(totalEstimatedCosts());
    const portfolioPnlEl=$("#paper-portfolio-pnl");
    if(portfolioPnlEl){const pp=portfolioCyclePnlPct();portfolioPnlEl.textContent="Portfolio P&L · "+pct(pp);portfolioPnlEl.classList.toggle("paper-positive",pp>=0);portfolioPnlEl.classList.toggle("paper-negative",pp<0);}
    const cashEl=$("#paper-cash"), investedEl=$("#paper-invested"), cashDetail=$("#paper-cash-detail"), investedDetail=$("#paper-invested-detail");
    if(cashEl) cashEl.textContent=usd(cash);
    if(investedEl) investedEl.textContent=usd(invested);
    if(cashDetail) cashDetail.textContent="Unallocated · "+(((START_CAPITAL+realizedPnl())>0)?((cash/(START_CAPITAL+realizedPnl()))*100).toFixed(1):"0.0")+"%";
    if(investedDetail) investedDetail.textContent=positions.length+" open position"+(positions.length===1?"":"s");
    body.innerHTML=positions.length?positions.map(p=>{
      const current=currentPrice(p)||p.entry;
      const grossPnl=positionGrossPnl(p,current);
      const isV2=p.costModel==="V2";
      const estimatedCosts=isV2?null:(estimatedEntryCost(p)+estimatedExitCost(p,current));
      const pnl=isV2?(grossPnl-Number(p.v2EntryCost?.networkUsd||0)):(grossPnl-estimatedCosts);
      const displayEntryQuote=isV2&&p.v2EntryQuote ? {...p.v2EntryQuote,client_entry_capital_usd:Number(p.v2EntryQuote.client_entry_capital_usd||p.entryCapital||p.size||0)} : null;
      const displayEntryCost=isV2 ? jupiterQuoteCosts(displayEntryQuote||{}) : null;
      const displayPosition=isV2 ? {...p,v2EntryQuote:displayEntryQuote,v2EntryCost:displayEntryCost} : p;
      const direction=tradingPriceDirections.get(p.mint)||"flat";
      const arrow=direction==="up"?"↑":direction==="down"?"↓":"→";
      const arrowClass="price-direction "+direction;
      return '<tr><td><strong>'+p.symbol+'</strong></td><td>'+price(p.entry)+'</td><td class="paper-current-price">'+price(current)+' <span class="'+arrowClass+'" title="Last 5s price change">'+arrow+'</span></td><td>'+p.qty.toFixed(4)+'</td><td>'+usd(p.size)+'</td><td>'+price(p.stop)+'</td><td>'+price(p.take)+'</td><td class="'+(grossPnl>=0?"paper-positive":"paper-negative")+'">'+usd(grossPnl)+'</td><td class="paper-negative">'+(isV2?usd(Number(displayPosition.v2EntryCost?.total||0)):"V1 "+usd(estimatedCosts))+'</td><td class="'+(pnl>=0?"paper-positive":"paper-negative")+'">'+usd(pnl)+'</td><td>'+Math.max(0,Math.round((now()-p.openedAt)/60000))+'m</td><td><button type="button" class="paper-sell-now" data-position-id="'+(p.positionId||'')+'">SELL NOW</button></td></tr>';
    }).join(""):'<tr><td colspan="10" class="paper-empty">No open paper positions.</td></tr>';
    body.querySelectorAll(".paper-sell-now").forEach(btn=>btn.addEventListener("click",()=>{const p=positions.find(x=>(x.positionId||"")===btn.dataset.positionId);if(p){manualSell(p).then(()=>renderAll());}}));
  }

  function renderJournal(){
    const body=$("#paper-journal-body"), pnlBody=$("#pnl-history-body");
    const html=journal.length?journal.slice().reverse().map(p=>'<tr><td>'+p.id+'</td><td><strong>'+p.symbol+'</strong></td><td>'+p.entryPriceText+'</td><td>'+p.exitPriceText+'</td><td>'+p.reason+'</td><td>'+usd(p.size)+'</td><td class="'+(p.grossPnl>=0?"paper-positive":"paper-negative")+'">'+usd(p.grossPnl??p.pnl)+'</td><td class="paper-negative">'+(p.costModel==="V2"?(v2FeeLabel(p)||"JUP QUOTE"):"V1 -"+usd(p.costTotal||0))+'</td><td class="'+((p.netPnl??p.pnl)>=0?"paper-positive":"paper-negative")+'">'+usd(p.netPnl??p.pnl)+'</td><td class="'+((p.netPnl??p.pnl)>=0?"paper-positive":"paper-negative")+'">'+pct(p.netPnlPct??p.pnlPct)+'</td><td>'+Math.round(p.durationMs/60000)+'m</td></tr>').join(""):'<tr><td colspan="11" class="paper-empty">No closed paper trades yet.</td></tr>';
    if(body){body.innerHTML=html;$("#paper-journal-count").textContent=String(journal.length);} const totalNetPnl=journal.reduce((s,p)=>s+Number(p.netPnl??p.pnl??0),0); const totalNetPct=START_CAPITAL>0?(totalNetPnl/START_CAPITAL)*100:0; const totalPnlEl=$("#pnl-journal-total-pnl"); const totalPctEl=$("#pnl-journal-total-pct"); if(totalPnlEl){totalPnlEl.textContent=usd(totalNetPnl); totalPnlEl.classList.toggle("paper-positive",totalNetPnl>=0); totalPnlEl.classList.toggle("paper-negative",totalNetPnl<0);} if(totalPctEl){totalPctEl.textContent=pct(totalNetPct); totalPctEl.classList.toggle("paper-positive",totalNetPct>=0); totalPctEl.classList.toggle("paper-negative",totalNetPct<0);}
    if(pnlBody)pnlBody.innerHTML=journal.length?journal.slice().reverse().map(p=>'<tr><td>'+p.id+'</td><td><strong>'+p.symbol+'</strong></td><td>BUY</td><td>'+p.entryPriceText+'</td><td>'+p.exitPriceText+'</td><td>'+p.reason+'</td><td class="'+((p.grossPnl??p.pnl)>=0?"paper-positive":"paper-negative")+'">'+usd(p.grossPnl??p.pnl)+'</td><td class="paper-negative">-'+usd(p.costTotal||0)+'</td><td class="'+((p.netPnl??p.pnl)>=0?"paper-positive":"paper-negative")+'">'+usd(p.netPnl??p.pnl)+'</td><td>'+pct(p.netPnlPct??p.pnlPct)+'</td></tr>').join(""):'<tr><td colspan="10" class="paper-empty">No closed trades recorded.</td></tr>';
  }

  function renderEquityChart(){
    const svg=$("#pnl-equity-chart");
    if(!svg) return;
    const points=[{label:"START",equity:START_CAPITAL}];
    let equity=START_CAPITAL;
    for(const trade of journal){
      equity+=Number(trade.netPnl??trade.pnl??0);
      points.push({label:trade.id,equity});
    }
    if(positions.length){
      points.push({label:"CURRENT",equity:currentEquity()});
    }
    const W=1000,H=300,L=68,R=24,T=20,B=42;
    const plotW=W-L-R,plotH=H-T-B;
    const values=points.map(p=>Number(p.equity));
    let min=Math.min(...values),max=Math.max(...values);
    if(!Number.isFinite(min)||!Number.isFinite(max)){svg.innerHTML="";return;}
    const range=Math.max(max-min,1);
    const pad=Math.max(range*0.12,25);
    min-=pad;max+=pad;
    const x=i=>L+(points.length===1?plotW/2:(i/(points.length-1))*plotW);
    const y=v=>T+(1-(v-min)/(max-min))*plotH;
    const grid=[];
    for(let n=0;n<5;n++){
      const v=min+(max-min)*(n/4), yy=y(v);
      grid.push('<line x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'" class="equity-grid"/><text x="'+(L-10)+'" y="'+(yy+4).toFixed(1)+'" class="equity-axis" text-anchor="end">'+usd(v)+'</text>');
    }
    const paths=[];
    for(let k=1;k<points.length;k++){
      const segment=[points[k-1],points[k]];
      const d="M"+x(k-1).toFixed(1)+" "+y(segment[0].equity).toFixed(1)+" L"+x(k).toFixed(1)+" "+y(segment[1].equity).toFixed(1);
      const cls=segment[1].equity>=START_CAPITAL?"equity-line equity-profit":"equity-line equity-loss";
      paths.push('<path d="'+d+'" class="'+cls+'"/>');
    }
    const circles=points.map((p,k)=>'<circle cx="'+x(k).toFixed(1)+'" cy="'+y(p.equity).toFixed(1)+'" r="4" class="equity-point '+(p.equity>=START_CAPITAL?"equity-profit-point":"equity-loss-point")+'"><title>'+p.label+" · "+usd(p.equity)+'</title></circle>').join("");
    const labels=points.map((p,k)=>{if(points.length>8 && k>0 && k<points.length-1 && k%2!==0)return "";return '<text x="'+x(k).toFixed(1)+'" y="'+(H-12)+'" class="equity-label" text-anchor="middle">'+p.label+'</text>';}).join("");
    svg.innerHTML=grid.join("")+'<line x1="'+L+'" y1="'+y(START_CAPITAL).toFixed(1)+'" x2="'+(W-R)+'" y2="'+y(START_CAPITAL).toFixed(1)+'" class="equity-baseline"/>'+paths.join("")+circles+labels;
  }

  function renderPnl(){
    const realized=realizedPnl();
    const open=openPnl();
    const costs=totalEstimatedCosts();
    $("#pnl-start").textContent=usd(START_CAPITAL);
    $("#pnl-equity").textContent=usd(START_CAPITAL+realized+open);
    $("#pnl-cash").textContent=usd(availableCash());
    $("#pnl-invested").textContent=usd(investedCapital());
    $("#pnl-realized").textContent=usd(realized);
    $("#pnl-open").textContent=usd(open);
    const costEl=$("#pnl-costs"); if(costEl) costEl.textContent=usd(costs);
    $("#pnl-trades").textContent=String(journal.length);
    $("#pnl-winrate").textContent=journal.length?((journal.filter(x=>Number(x.netPnl??x.pnl)>0).length/journal.length)*100).toFixed(1)+"%":"—";
    const cycleEl=$("#pnl-cycle-pnl");
    if(cycleEl){const pp=portfolioCyclePnlPct();cycleEl.textContent=pct(pp);cycleEl.classList.toggle("paper-positive",pp>=0);cycleEl.classList.toggle("paper-negative",pp<0);}
    renderEquityChart();
    const targetEl=$("#pnl-cycle-target");
    if(targetEl)targetEl.textContent=pct(portfolioTakeAllPct);
  }

  async function renderAll(){
    await executePaperCycle();
    renderSignals();
    renderPositions();
    renderJournal();
    renderPnl();
    captureTradingState();
    saveLocalPaperSnapshot();
  }

  async function init(){
    const sel=$("#paper-threshold");
    if(sel)sel.addEventListener("change",()=>{threshold=Number(sel.value)||3;renderSignals();});
    const risk=$("#paper-risk");
    if(risk)risk.addEventListener("change",()=>{riskPct=Number(risk.value)||2;renderSignals();});
    const capitalLimit=$("#paper-capital-limit");
    if(capitalLimit)capitalLimit.addEventListener("change",()=>{capitalLimitPct=Number(capitalLimit.value)||20;renderAll();});
    const portfolioLimit=$("#paper-portfolio-limit");
    if(portfolioLimit)portfolioLimit.addEventListener("change",()=>{portfolioLimitPct=Number(portfolioLimit.value)||50;renderAll();});
    const minPosition=$("#paper-min-position");
    if(minPosition)minPosition.addEventListener("change",()=>{minPositionCapital=Number(minPosition.value)||250;renderAll();});
    const timeout=$("#paper-profit-timeout");
    if(timeout)timeout.addEventListener("change",()=>{profitTimeoutMinutes=Number(timeout.value)||0;renderAll();});
    const takeAll=$("#paper-take-all");
    if(takeAll)takeAll.addEventListener("change",()=>{portfolioTakeAllPct=Number(takeAll.value)||0;renderAll();});
    const startStop=$("#paper-start-stop");
    if(startStop) startStop.addEventListener("click",()=>{
      if(paperRunning){
        sessionElapsedMs=sessionDurationMs();
        sessionStartedAt=null;
        paperRunning=false;
      }else{
        sessionStartedAt=now();
        sessionElapsedMs=0;
        paperRunning=true;
      }
      updatePaperControl();
      renderAll();
    });
    document.querySelectorAll(".nav-btn[data-view]").forEach(btn=>btn.addEventListener("click",()=>{
      const view=btn.dataset.view;
      const paper=$("#paper-panel"), pnl=$("#pnl-panel");
      if(paper)paper.hidden=view!=="paper";
      if(pnl)pnl.hidden=view!=="pnl";
      if(view==="paper"||view==="pnl")renderAll();
    }));
    window.addEventListener("memelab:jupiter-data",renderAll);
    const restored=await restoreTradingState();
    if(!restored) restoreLocalPaperSnapshot();
    await refreshTradingPrices();
    await renderAll();
    updatePaperControl();
    renderSession();
    setInterval(renderSession,1000);
    setInterval(async ()=>{await refreshTradingPrices();if(!$("#paper-panel")?.hidden||!$("#pnl-panel")?.hidden){await renderAll();}},5000);
    window.addEventListener("pagehide",()=>saveLocalPaperSnapshot());
  }
  window.MEMELAB_PAPER={render:renderAll,state:()=>({positions,journal,costModelVersion,threshold,riskPct,capitalLimitPct,portfolioLimitPct,minPositionCapital,profitTimeoutMinutes,portfolioTakeAllPct,portfolioCycleBaselineEquity,paperRunning,sessionStartedAt,sessionElapsedMs}),isRunning:()=>paperRunning,manualBuy,manualSell};
  init();
})();