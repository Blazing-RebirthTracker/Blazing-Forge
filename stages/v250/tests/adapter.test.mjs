import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {modes,templates,create,validate,setEnabled,exportFiles,markerScene} from '../stage-modes.mjs';
const c=JSON.parse(gunzipSync(readFileSync(new URL('../authoring-catalog.json.gz',import.meta.url))));
let count=0;
for(const profile of Object.values(modes))for(const id of Object.keys(templates(c,profile))){
 const s=create(c,profile,id,'test:'+id,'Test');
 validate(c,s);count++;
 if(profile!==modes.castle)assert.equal(markerScene(c,s,0).cells.length,121);
}
const e=create(c,modes.emergency,'300301','test:emergency','Emergency');
const r=create(c,modes.road,'80043','test:road','Road');
const p=create(c,modes.castle,'1','test:castle','Castle');
assert.throws(()=>exportFiles(c,[]));
assert.throws(()=>validate(c,{...r,donorMissionId:'300301'}));
assert.throws(()=>validate(c,{...e,donorMissionId:'80043'}));
assert.throws(()=>validate(c,{...p,pointScale:0}));
assert.throws(()=>validate(c,{...p,pointScale:Infinity}));
assert.throws(()=>validate(c,{...p,rewardPvpId:'999999'}));
assert.throws(()=>validate(c,{...e,rewards:[]}));
assert.throws(()=>validate(c,{...r,maps:r.maps.slice(1)}));
const bad=structuredClone(e);bad.maps[0].markers=[{chip:8,grid:[-1,0]}];assert.throws(()=>validate(c,bad));
const floor=markerScene(c,e,0).cells.find(v=>v.chip===1);
const moved=structuredClone(e);moved.maps[0].markers=[{chip:8,grid:floor.grid}];
validate(c,moved);assert.equal(markerScene(c,moved,0).cells.filter(v=>v.chip===8).length,1);
const rr={...r,localId:'test:road2'},pp={...p,localId:'test:castle2'};
assert.throws(()=>exportFiles(c,[r,rr]));
let selected=setEnabled([r,{...rr,enabled:false},p,{...pp,enabled:false}],rr.localId,true);
assert.equal(selected[0].enabled,false);assert.equal(selected[1].enabled,true);
assert.equal(selected[2].enabled,true);
const active=exportFiles(c,selected);assert.equal(JSON.parse(active['forge-mod.json']).stages.length,2);
assert.equal(JSON.parse(exportFiles(c,selected,{includeDisabled:true})['forge-mod.json']).stages.length,4);
for(const [s,max] of [[e,50],[r,10],[p,10]]){
 const list=Array.from({length:max},(_,i)=>({...s,localId:'capacity:'+s.profile.split('/')[0]+i,enabled:i===0}));
 assert.doesNotThrow(()=>exportFiles(c,list,{includeDisabled:true}));
 assert.throws(()=>exportFiles(c,[...list,{...s,localId:'overflow:test',enabled:false}]));
}
assert.equal(c.slots.length,70);assert.equal(new Set(c.slots.map(s=>s.slot)).size,70);
assert.equal(c.slots.filter(s=>s.stageId&&['3820','3821','3822'].includes(s.stageId)).length,0);
assert.equal(c.roadDonors['80014'],undefined);
console.log(JSON.stringify({passed:true,templates:count,capacities:[50,10,10],disabledExport:true,markerValidation:true}));
