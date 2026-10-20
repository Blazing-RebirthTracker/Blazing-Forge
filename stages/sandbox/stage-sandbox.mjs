/* Website authoring adapter. Never produces a native-installable mod pack. */
const clone = x => JSON.parse(JSON.stringify(x));
const require = (ok, message) => { if (!ok) throw new Error(message); };
const integer = (x, min, max, label) => require(Number.isSafeInteger(x) && x >= min && x <= max, `${label}: enter an integer from ${min} to ${max}`);
const id = x => String(x);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function stage(p, localId) {
  const s=p.catalog.stages.find(s=>s.spec.localId===localId);
  require(s,'Unknown quest'); return s;
}
function map(s, mapId) {const m=s.donor.maps.find(m=>m.id===id(mapId));require(m,'Unknown map');return m;}
function enemy(p, enemyId) {const e=p.catalog.enemies.find(e=>id(e.id)===id(enemyId));require(e,'Unknown enemy');return e;}
function item(library, itemId) {
  const i=library.items[id(itemId)];require(i,'Select an item from the reward catalog');
  require(i.availability!=='reserved','Reserved material slots cannot be awarded');return i;
}
export function validateProject(p) {
  require(p?.format==='ForgeStageSandbox' && p.schema===1,'Unsupported website project format');
  require(p.compatibility?.directGameImport===false,'This project must remain labeled as website authoring data');
  require(p.catalog?.profile==='kirito-events/1','Unsupported source catalog profile');
  const stages=new Set(),missions=new Set(),maps=new Set(),sets=new Set(),enemies=new Set();
  for(const e of p.catalog.enemies) {require(!enemies.has(id(e.id)),'Duplicate enemy ID');enemies.add(id(e.id));}
  for(const s of p.catalog.stages) {
    require(!stages.has(s.slot.stageId)&&!missions.has(s.slot.missionId),'Duplicate stage or mission ID');
    stages.add(s.slot.stageId);missions.add(s.slot.missionId);
    const d=s.donor, mi=d.mission.missionInfo;
    require(id(d.mission.missionId)===s.slot.missionId,'Mission identity mismatch');
    require(same(mi.mapList.map(id),d.maps.map(m=>m.id)),'Client map order mismatch');
    require(same(d.serverMission.mapIds.map(id),d.maps.map(m=>m.id)),'Server map order mismatch');
    require(same(mi.subMission,d.objective.objectives),'Client/server objective mismatch');
    for(const m of d.maps) {
      require(!maps.has(m.id),'Duplicate map ID');maps.add(m.id);
      require(m.raw.map.lines.length===11 && m.raw.map.lines.every(l=>l.chips.length===11),'Expected 11×11 grid');
      for(const set of m.sets) {
        require(!sets.has(set.id),'Duplicate enemy-set ID');sets.add(set.id);
        for(const e of set.raw.enemySet) {
          require(enemies.has(id(e.id)),'Missing enemy definition');
          integer(e.dropRate,0,1000,'Drop chance per thousand');
        }
      }
    }
    for(const c of d.serverMission.dropCandidates) {
      integer(c.chancePerThousand,0,1000,'Drop chance per thousand');
      const m=map(s,c.mapId),set=m.sets.find(x=>x.id===id(c.enemySetId));
      require(set&&set.raw.enemySet.some(e=>e.id===c.enemyId),'Orphaned drop candidate');
      require(enemy(p,c.enemyId).dropId===c.dropId,'Client/server drop item mismatch');
    }
  }
  return p;
}
export function importProject(text) {return validateProject(JSON.parse(text));}
export function exportProject(p) {validateProject(p);return JSON.stringify(p,null,2)+'\n';}
function edit(p, fn) {const next=clone(p);fn(next);validateProject(next);return next;}
export function questSummaries(p) {
  return p.catalog.stages.map(s=>({localId:s.spec.localId,stageId:s.slot.stageId,missionId:s.slot.missionId,
    name:s.spec.name,missionName:s.spec.missionName,banner:s.banner,mapCount:s.donor.maps.length,
    bosses:s.donor.maps.flatMap((m,i)=>m.sets.some(x=>x.raw.enemySet.some(e=>e.type===2))?[i+1]:[])}));
}
export function scene(p, localId, mapId, labels={enemies:{}}) {
  const s=stage(p,localId),m=map(s,mapId),players=[];
  const cells=m.raw.map.lines.flatMap((l,y)=>l.chips.map((chip,x)=>({chip,grid:[x,y],field:[75*x,105*y]})));
  for(let slot=0;slot<6;slot++) {
    const cell=cells.find(c=>c.chip===8+slot);
    players.push({slot,chip:8+slot,grid:cell?.grid||[5,8],field:cell?.field||[375,840],fallback:!cell});
  }
  return {mapId:m.id,title:m.raw.title,backgroundId:id(m.raw.mapBgId),cells,players,
    projection:'logical-grid; not a calibrated phone camera',
    enemies:m.sets.flatMap(set=>set.raw.enemySet.map((entry,index)=>{
      const e=enemy(p,entry.id),label=labels.enemies[id(entry.id)];
      return {key:`${set.id}:${index}`,enemyId:id(entry.id),setId:set.id,index,
        name:label?.name||`Enemy ${entry.id}`,preview:label||null,boss:entry.type===2,
        hp:e.hp.s,attack:e.atk.s,defense:e.def.s,level:entry.level,count:entry.count,
        facing:entry.way,spawnCandidates:cells.filter(c=>c.chip===2||c.chip===15+entry.enterId),
        selectedPosition:null,dropItemId:id(e.dropId),chancePerThousand:entry.dropRate};
    }))};
}
function rebuildNormalDrops(p,s,library) {
  const out=[];
  for(const m of s.donor.maps) for(const set of m.sets) for(const entry of set.raw.enemySet) {
    if(!entry.dropRate)continue;
    const e=enemy(p,entry.id),i=item(library,e.dropId);
    out.push({mapId:Number(m.id),enemySetId:Number(set.id),enemyId:e.id,dropId:e.dropId,unitType3:i.type3,
      chancePerThousand:entry.dropRate,enemyCount:entry.count,unitLevelMin:e.dropUnitLevelMin,
      unitLevelMax:e.dropUnitLevelMax,luck:e.dropLuck,skillLevel:e.dropSkillLevel,ability:e.dropAbilityLevel,
      plusS:e.dropPlus_s,plusA:e.dropPlus_a,plusD:e.dropPlus_d,plusSp:e.dropPlus_sp});
  }
  s.donor.serverMission.dropCandidates=out;
  s.donor.drops.normalUnits=[...new Set(out.map(x=>x.dropId))];
}
export function setNormalDrop(p,localId,mapId,enemyId,itemId,chancePerThousand,library) {
  integer(chancePerThousand,0,1000,'Drop chance per thousand');const i=item(library,itemId);
  return edit(p,n=>{
    const s=stage(n,localId),m=map(s,mapId),e=enemy(n,enemyId);
    require(m.sets.some(x=>x.raw.enemySet.some(t=>t.id===e.id)),'Enemy does not occur on selected map');
    // Drop item is per enemy definition, not per placement. Refuse cross-map side effects.
    for(const st of n.catalog.stages) for(const other of st.donor.maps)
      if(other.id!==m.id)require(!other.sets.some(x=>x.raw.enemySet.some(t=>t.id===e.id)),'Shared enemy requires an explicit isolated clone before editing');
    e.dropId=Number(i.id);
    for(const k of ['s','a','d','sp'])e['dropPlus_'+k]=i.defaultBonuses[k];
    for(const set of m.sets)for(const t of set.raw.enemySet)if(t.id===e.id)t.dropRate=chancePerThousand;
    rebuildNormalDrops(n,s,library);
  });
}
export function setLuckyReward(p,localId,itemId,quantity,library) {
  integer(quantity,1,999,'Draft lucky reward quantity');const i=item(library,itemId);
  return edit(p,n=>{
    const drops=stage(n,localId).donor.drops;
    require(drops.lucky.length===1,'This convenience editor expects one lucky reward row');
    Object.assign(drops.lucky[0],{chara_id:Number(i.id),num:quantity});
    for(const k of ['s','a','d','sp'])drops.lucky[0]['plus_'+k]=i.defaultBonuses[k];
  });
}
export function setObjectiveReward(p,localId,objectiveId,itemId,quantity,library) {
  integer(quantity,1,999,'Draft objective reward quantity');const i=item(library,itemId);
  return edit(p,n=>{
    const d=stage(n,localId).donor;
    const objective=d.mission.missionInfo.subMission.find(o=>id(o.id)===id(objectiveId));
    require(objective,'Unknown objective');
    const rows=objective.subMissionReward.units;require(rows.length>0,'Missing unit reward slots');
    for(const u of rows)Object.assign(u,{unitId:0,unitNum:0});
    Object.assign(rows[0],{unitId:Number(i.id),unitNum:quantity});
    for(const k of ['s','a','d','sp'])rows[0]['plus_'+k]=i.defaultBonuses[k];
    d.objective.objectives=clone(d.mission.missionInfo.subMission);
  });
}
export function moveMarker(p,localId,mapId,chip,x,y) {
  integer(x,0,10,'Grid X');integer(y,0,10,'Grid Y');
  require((chip>=8&&chip<=13)||(chip>=16&&chip<=25),'Select a player or enemy-entry marker');
  return edit(p,n=>{
    const m=map(stage(n,localId),mapId),grid=m.raw.map.lines;const found=[];
    grid.forEach((l,cy)=>l.chips.forEach((c,cx)=>{if(c===chip)found.push([cx,cy]);}));
    require(found.length===1,'Marker must occur exactly once');const [sx,sy]=found[0];
    if(sx===x&&sy===y)return;
    require(grid[y].chips[x]===1,'Destination must be an empty floor cell');
    grid[sy].chips[sx]=1;grid[y].chips[x]=chip;
  });
}
export function gameExportStatus() {
  return {allowed:false,reason:'Website project only. v2.4.0 generic imports accept layout edits; these built-in quests are SHA-pinned. A validated game installer extension is required for edited rewards/stats.'};
}
