/* ForgeStageSandbox authoring only: retain mission identities and reward links. */
import {validateProject} from './stage-sandbox.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const require=(ok,message)=>{if(!ok)throw Error(message)};
function quest(p,localId){const s=p.catalog.stages.find(s=>s.spec.localId===localId);require(s,'Unknown quest');return s;}
function current(s,mapId){const m=s.donor.maps.find(m=>m.id===String(mapId));require(m,'Unknown map');return m;}
function gridOK(lines){require(Array.isArray(lines)&&lines.length===11&&lines.every(l=>Array.isArray(l.chips)&&l.chips.length===11&&l.chips.every(Number.isSafeInteger)),'Expected an 11 by 11 integer grid');}
const marker=c=>(c>=8&&c<=13)||(c>=16&&c<=25);
const floor=c=>c>7||((0x6e>>c)&1)!==0;
function definition(library,id){const d=library.definitions[String(id)];require(d,'Choose a supplied background');return d;}
function sync(s,library){
 const d=s.donor,byId=new Map(d.serverMission.maps.map(m=>[String(m.mapId),m]));
 d.mission.missionInfo.mapList=d.maps.map(m=>Number(m.id));
 d.serverMission.mapIds=d.maps.map(m=>Number(m.id));
 d.serverMission.maps=d.maps.map(m=>{const row=byId.get(m.id);require(row,'Missing server map');row.mapBackgroundId=m.raw.mapBgId;return row;});
 d.serverMission.defaultEnemySetIds=d.serverMission.maps.map(m=>m.defaultEnemySetId);
 const specs=new Map(s.spec.maps.map(m=>[m.donorMapId,m]));
 s.spec.maps=d.maps.map(m=>{const spec=specs.get(m.id);require(spec,'Missing map specification');return spec;});
 // Existing dependencies can also belong to mission-level rules/scripts.
 // Add newly selected assets; do not discard unclassified original references.
 const objects=new Set(d.dependencies.mapObjIds),sprites=new Set(d.dependencies.bgSpriteIds),gimmicks=new Set(d.dependencies.gimmickIds);
 for(const m of d.maps)for(const layer of definition(library,m.raw.mapBgId).layers){
  const r=layer.raw;require(r&&Number.isSafeInteger(r.mapObjId),'Incomplete background metadata');
  (r.isSpriteStudio?sprites:objects).add(r.mapObjId);
  if(r.mapGimmickId)gimmicks.add(r.mapGimmickId);
 }
 d.dependencies.mapObjIds=[...objects];
 d.dependencies.bgSpriteIds=[...sprites];
 d.dependencies.gimmickIds=[...gimmicks];
}
export function validateMaps(p,library){
 validateProject(p);
 for(const s of p.catalog.stages){
  const d=s.donor;
  require(JSON.stringify(s.spec.maps.map(m=>m.donorMapId))===JSON.stringify(d.maps.map(m=>m.id)),'Spec map order mismatch');
  require(JSON.stringify(d.serverMission.maps.map(m=>String(m.mapId)))===JSON.stringify(d.maps.map(m=>m.id)),'Server map rows out of order');
  require(JSON.stringify(d.serverMission.defaultEnemySetIds)===JSON.stringify(d.serverMission.maps.map(m=>m.defaultEnemySetId)),'Default enemy set order mismatch');
  for(const m of d.maps){
   definition(library,m.raw.mapBgId);gridOK(m.raw.map.lines);
   const row=d.serverMission.maps.find(x=>String(x.mapId)===m.id);
   require(row?.mapBackgroundId===m.raw.mapBgId,'Client/server background mismatch');
   for(const set of m.sets)require(m.raw.enemySetList.some(x=>String(x.enemySetId)===set.id),'Unreferenced enemy set');
  }
 }
 return p;
}
function edit(p,localId,library,fn){const n=clone(p),s=quest(n,localId);fn(s);sync(s,library);validateMaps(n,library);return n;}
export function setMapBackground(p,localId,mapId,backgroundId,library){
 definition(library,backgroundId);
 return edit(p,localId,library,s=>{current(s,mapId).raw.mapBgId=Number(backgroundId);});
}
export function reorderMaps(p,localId,orderedIds,library){
 const ids=orderedIds.map(String),s=quest(p,localId);
 require(ids.length===s.donor.maps.length&&new Set(ids).size===ids.length&&ids.every(id=>s.donor.maps.some(m=>m.id===id)),'Reorder must contain every map exactly once');
 return edit(p,localId,library,s=>{const maps=new Map(s.donor.maps.map(m=>[m.id,m]));s.donor.maps=ids.map(id=>maps.get(id));});
}
export function replaceMapLayout(p,localId,mapId,templateId,library,placements={}){
 const template=library.templates[String(templateId)];require(template,'Choose a supplied layout');
 gridOK(template.lines);
 return edit(p,localId,library,s=>{
  const m=current(s,mapId),original=m.raw.map.lines,positions=[];
  original.forEach((l,y)=>l.chips.forEach((chip,x)=>{if(marker(chip))positions.push({chip,x,y});}));
  const lines=clone(template.lines);
  // This operation changes the floor shape only. Gimmicks, drops and enemies
  // belong to other editors; unsupported tile types cannot be guessed away.
  require(lines.every(l=>l.chips.every(c=>[0,1,2].includes(c)||marker(c))),'This template has special tiles; use a plain layout or retain its verified gimmick data in developer review');
  for(const l of lines)l.chips=l.chips.map(c=>marker(c)||c===2?1:c);
  const occupied=new Set();
  for(const pos of positions){
   const at=placements[pos.chip]||[pos.x,pos.y], [x,y]=at;
   require(at.length===2&&Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<11&&y>=0&&y<11,'Marker position must be inside the grid');
   require(floor(lines[y].chips[x])&&!occupied.has(`${x},${y}`),`Place marker ${pos.chip} on a free floor tile before applying this layout`);
   occupied.add(`${x},${y}`);lines[y].chips[x]=pos.chip;
  }
  for(const set of m.sets)for(const e of set.raw.enemySet)require(lines.some(l=>l.chips.includes(15+e.enterId)),'Layout is missing an enemy entry marker');
  m.raw.map.lines=lines;
  // Marker overrides are derived from the prior grid and would otherwise undo
  // the new authored layout when native compilation applies the specification.
  s.spec.maps.find(x=>x.donorMapId===m.id).markers=[];
 });
}
