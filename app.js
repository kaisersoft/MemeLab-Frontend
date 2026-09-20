const data={
 ESOL:{score:87,liq:92,vol:88,holder:79,social:91,risk:34,liquidity:"$428K",age:"new pair"},
 NOVA:{score:74,liq:79,vol:74,holder:72,social:76,risk:41,liquidity:"$91K",age:"2m old"},
 MOONX:{score:58,liq:63,vol:61,holder:58,social:66,risk:67,liquidity:"$37K",age:"7m old"}
};
const $=s=>document.querySelector(s);
function selectToken(name){
 const d=data[name]; if(!d)return;
 document.querySelectorAll(".token-card").forEach(x=>x.classList.toggle("selected",x.dataset.token===name));
 $("#score-token").textContent=name; $("#score").textContent=d.score+" / 100";
 [["m-liq",d.liq],["m-vol",d.vol],["m-holder",d.holder],["m-social",d.social],["m-risk",d.risk]].forEach(([id,v])=>{const el=$("#"+id);el.textContent=v;el.parentElement.nextElementSibling.querySelector("em").style.width=v+"%"});
 $("#chart-label").textContent=name+" / SOL · 15m";
}
document.querySelectorAll(".token-card").forEach(btn=>btn.addEventListener("click",()=>selectToken(btn.dataset.token)));
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{
 document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
}));
let seconds=14;
setInterval(()=>{seconds++;$("#scan-time").textContent="Last scan · "+seconds+" sec ago"},1000);
