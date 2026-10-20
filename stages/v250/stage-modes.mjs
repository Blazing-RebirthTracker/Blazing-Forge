/* v2.5.0 website contract. Game IDs are allocated by the app, never the browser. */
export const modes={emergency:'emergency-layout/1',road:'ninja-road-layout/1',castle:'phantom-castle/1'};
export const capacity={['emergency-layout/1']:50,['ninja-road-layout/1']:10,['phantom-castle/1']:10};
const copy=x=>JSON.parse(JSON.stringify(x));
const check=(yes,why)=>{if(!yes)throw Error(why)};
const integer=(n,lo,hi)=>Number.isInteger(n)&&n>=lo&&n<=hi;
const bytes=s=>new TextEncoder().encode(s).length;
export function templates(catalog,profile){return catalog[profile===modes.castle?'castleDonors':profile===modes.road?'roadDonors':'donors'];}
export function validate(c,s){
 check(s&&typeof s==='object'&&!Array.isArray(s),'Choose a stage definition.');
 const castle=s.profile===modes.castle;check(Object.values(modes).includes(s.profile),'Unknown mode.');
 check(s.format===(castle?'ForgeCastle':'ForgeStage')&&s.schema===(castle?1:2),'Unsupported format/schema.');
 const keys=['format','schema','profile','localId','name','enabled',...(castle?['donorPvpId','rewardPvpId','pointScale']:['donorMissionId','maps'])];
 check(Object.keys(s).every(k=>keys.includes(k)),'This export contains unsupported edits. Save it as a website draft instead.');
 check(typeof s.localId==='string'&&s.localId.length<=96&&s.localId.includes(':')&&/^[A-Za-z0-9_.:-]+$/.test(s.localId),'Use a stable namespaced localId.');
 check(typeof s.name==='string'&&bytes(s.name)>0&&bytes(s.name)<=96&&!/[\x00-\x1f\x7f]/.test(s.name),'Name must be 1–96 UTF-8 bytes, without control characters.');
 check(s.enabled===undefined||typeof s.enabled==='boolean','Enabled must be a boolean.');
 const id=castle?s.donorPvpId:s.donorMissionId,donors=templates(c,s.profile);check(typeof id==='string'&&Object.hasOwn(donors,id),'Choose a template from this mode.');
 const d=donors[id];
 if(castle){
  check(s.pointScale===undefined||(typeof s.pointScale==='number'&&Number.isFinite(s.pointScale)&&s.pointScale>=.1&&s.pointScale<=10),'Point scale must be 0.1–10.');
  if(s.rewardPvpId!==undefined){check(typeof s.rewardPvpId==='string'&&Object.hasOwn(donors,s.rewardPvpId),'Choose a reward preset.');check(JSON.stringify(d.points)===JSON.stringify(donors[s.rewardPvpId].points),'Reward preset needs the same floor progression.');}
  return s;
 }
 check(Array.isArray(s.maps)&&s.maps.length===d.maps.length,'Keep every template map in order.');
 for(let i=0;i<s.maps.length;i++){
  const m=s.maps[i],base=d.maps[i];check(m&&Object.keys(m).every(k=>['donorMapId','markers'].includes(k))&&m.donorMapId===base.id,'Map identity/order differs.');
  check(Array.isArray(m.markers)&&m.markers.length<=16,'Use at most 16 unique marker moves.');
  const grid=base.raw.map.lines.map(l=>l.chips.slice()),seen=new Set(),dest=new Set();
  for(const move of m.markers){check(move&&Object.keys(move).every(k=>['chip','grid'].includes(k)),'Invalid marker fields.');const {chip,grid:xy}=move;
   check(integer(chip,8,25)&&!(chip>13&&chip<16)&&!seen.has(chip)&&grid.flat().filter(x=>x===chip).length===1,'Move each unique player/enemy marker once.');
   check(Array.isArray(xy)&&xy.length===2&&xy.every(n=>integer(n,0,10)),'Grid coordinates must be integers from 0 to 10.');seen.add(chip);
  }
  for(const row of grid)for(let x=0;x<11;x++)if(seen.has(row[x]))row[x]=1;
  for(const {grid:[x,y]} of m.markers){check(grid[y][x]===1&&!dest.has(x+','+y),'Choose a distinct floor cell or a moved marker’s former cell.');dest.add(x+','+y);}
 }
 return s;
}
export function create(c,profile,donor,localId,name){
 check(Object.values(modes).includes(profile),'Unknown mode.');const d=templates(c,profile)[donor];check(d,'Missing template.');
 const s={format:profile===modes.castle?'ForgeCastle':'ForgeStage',schema:profile===modes.castle?1:2,profile,localId,name,enabled:true};
 if(profile===modes.castle)Object.assign(s,{donorPvpId:String(donor),pointScale:1});else Object.assign(s,{donorMissionId:String(donor),maps:d.maps.map(m=>({donorMapId:m.id,markers:[]}))});return validate(c,s);
}
export function setEnabled(specs,localId,on){
 const next=copy(specs),s=next.find(x=>x.localId===localId);check(s,'Unknown stage.');s.enabled=on;
 if(on&&s.profile!==modes.emergency)for(const other of next)if(other!==s&&other.profile===s.profile)other.enabled=false;
 return next;
}
export function exportFiles(c,specs,{includeDisabled=false}={}){
 const ids=new Set(),counts={};for(const s of specs){validate(c,s);check(!ids.has(s.localId),'Duplicate localId.');ids.add(s.localId);counts[s.profile]=(counts[s.profile]||0)+1;check(counts[s.profile]<=capacity[s.profile],'Too many saved definitions for this mode.');}
 for(const profile of [modes.road,modes.castle])check(specs.filter(s=>s.profile===profile&&s.enabled!==false).length<=1,'Choose one active Road and Castle.');
 const active=specs.filter(s=>includeDisabled||s.enabled!==false);check(active.length,'Choose at least one definition to export.');
 const files={},paths=[];active.forEach((s,i)=>{const p='stages/'+String(i+1).padStart(2,'0')+'.json';paths.push(p);files[p]=JSON.stringify(s,null,2)+'\n';});
 files['forge-mod.json']=JSON.stringify({format:'ForgeStagePack',schema:1,stages:paths},null,2)+'\n';check(Object.values(files).reduce((n,v)=>n+bytes(v),0)<=2*1024*1024,'Expanded stage pack exceeds 2 MB.');return files;
}
export function markerScene(c,s,mapIndex){
 validate(c,s);check(s.profile!==modes.castle,'Castles use a floor/reward editor, not a mission grid.');const m=templates(c,s.profile)[s.donorMissionId].maps[mapIndex];check(m,'Choose a map.');
 const lines=m.raw.map.lines.map(l=>l.chips.slice()),moves=s.maps[mapIndex].markers;
 for(const row of lines)for(let x=0;x<11;x++)if(moves.some(v=>v.chip===row[x]))row[x]=1;
 for(const v of moves)lines[v.grid[1]][v.grid[0]]=v.chip;
 return {projection:'logical 11x11 grid; not a calibrated game camera',backgroundId:m.raw.mapBgId===undefined?null:String(m.raw.mapBgId),cells:lines.flatMap((row,y)=>row.map((chip,x)=>({chip,grid:[x,y],field:[x*75,y*105]}))),enemySets:copy(m.sets||[])};
}
