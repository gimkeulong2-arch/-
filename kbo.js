
const BASE="https://www.koreabaseball.com";
const ENG="https://eng.koreabaseball.com";

function dec(s=""){
 return s.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
 .replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
}
function text(s=""){return dec(s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();}
function tables(html){
 const out=[];
 for(const tm of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const tr=[...tm[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(x=>x[1]);
  if(!tr.length)continue;
  const rows=tr.map(r=>[...r.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(c=>text(c[1]))).filter(r=>r.length);
  if(!rows.length)continue;
  out.push({headers:rows[0],rows:rows.slice(1)});
 }
 return out;
}
async function get(url){
 const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (YungangDotcom)","accept-language":"ko-KR,ko;q=0.9,en;q=0.7"}});
 if(!r.ok)throw new Error("KBO 응답 오류 "+r.status);
 return await r.text();
}
function todayKST(){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const o=Object.fromEntries(parts.map(x=>[x.type,x.value])); return `${o.year}-${o.month}-${o.day}`;
}
function currentMonthKST(){return todayKST().slice(0,7);}
function roster(html){
 const groups={"투수":[],"포수":[],"내야수":[],"외야수":[]};
 const idx=html.indexOf("롯데");
 if(idx<0)return groups;
 const slice=html.slice(idx,idx+50000);
 for(const [pos,next] of [["투수","포수"],["포수","내야수"],["내야수","외야수"],["외야수",""]]){
   let a=slice.indexOf(pos); if(a<0)continue;
   let b=next?slice.indexOf(next,a+pos.length):Math.min(slice.length,a+16000); if(b<0)b=Math.min(slice.length,a+16000);
   const seg=slice.slice(a,b);
   for(const m of seg.matchAll(/<a\b[^>]*href=["']([^"']*(?:PlayerInfo|Basic|player)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)){
      const nm=text(m[2]); const mm=nm.match(/^(.+?)\s*\((\d+)\)$/);
      if(mm && !groups[pos].some(x=>x.name===mm[1]))groups[pos].push({name:mm[1].trim(),number:mm[2],path:m[1].replace(/&amp;/g,"&")});
   }
   if(!groups[pos].length){
     for(const m of text(seg).matchAll(/([가-힣A-Za-z·.\-]{2,14})\((\d+)\)/g)){
       if(!groups[pos].some(x=>x.name===m[1]))groups[pos].push({name:m[1],number:m[2],path:""});
     }
   }
 }
 return groups;
}
function scheduleRows(html){
 const ts=tables(html);
 let best=ts.find(t=>t.headers.some(h=>/DATE|일자/i.test(h)) && t.rows.some(r=>r.join(" ").match(/LOTTE|롯데/i))) ||
          ts.find(t=>t.rows.some(r=>r.join(" ").match(/LOTTE|롯데/i)));
 if(!best)return {headers:[],rows:[]};
 return {headers:best.headers,rows:best.rows.filter(r=>r.join(" ").match(/LOTTE|롯데/i)).slice(-20)};
}
function scoreboard(html){
 const ts=tables(html);
 const scoreTables=ts.filter(t=>t.headers.some(h=>/^TEAM$|팀/i.test(h)) && t.rows.length>=2);
 const games=[];
 for(const t of scoreTables){
   const joined=t.rows.map(r=>r.join(" ")).join(" ");
   if(!/LOTTE|롯데/i.test(joined))continue;
   const a=t.rows[0],h=t.rows[1];
   const ridx=t.headers.findIndex(x=>/^R$|득점/.test(x));
   games.push({away:a[0],home:h[0],awayScore:ridx>=0?a[ridx]:"",homeScore:ridx>=0?h[ridx]:"",status:"",table:t});
 }
 return games;
}
exports.handler=async(event)=>{
 try{
  const q=event.queryStringParameters||{}, type=q.type||"standings";
  let payload={updatedAt:new Date().toISOString()};
  if(type==="score"){
    const d=todayKST(), html=await get(`${ENG}/Schedule/Scoreboard.aspx?searchDate=${d}`);
    payload={...payload,date:d,games:scoreboard(html)};
  }else if(type==="schedule"){
    const ym=currentMonthKST(), html=await get(`${ENG}/Schedule/DailySchedule.aspx?searchDate=${ym}`);
    payload={...payload,month:ym,...scheduleRows(html)};
  }else if(type==="standings"){
    const html=await get(`${BASE}/Record/TeamRank/TeamRankDaily.aspx`);
    const ts=tables(html); const table=ts.find(t=>t.headers.some(h=>h==="순위")&&t.headers.some(h=>h==="팀명"))||null;
    payload={...payload,table};
  }else if(type==="roster"){
    const html=await get(`${BASE}/Player/RegisterAll.aspx`);
    payload={...payload,groups:roster(html)};
  }else if(type==="player"){
    let path=q.path||""; 
    if(!path.startsWith("/")) path="/"+path;
    if(!/^\/Player\//i.test(path))throw new Error("잘못된 선수 주소");
    const html=await get(BASE+path);
    payload={...payload,tables:tables(html).filter(t=>t.rows.length).slice(0,8)};
  }else throw new Error("지원하지 않는 요청");
  return {statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"},body:JSON.stringify(payload)};
 }catch(e){
  return {statusCode:500,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},body:JSON.stringify({error:e.message})};
 }
};
