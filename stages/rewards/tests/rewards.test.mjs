// Host tests for stage rewards and banners (website export + the app-side reference compiler).
// usage: node stages/rewards/tests/rewards.test.mjs [--write]   (--write regenerates examples/ and tests/golden/)
// Phone results are not covered: payout, settlement, retries and existing saves need a device.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as R from '../stage-rewards.mjs';
import * as SM from '../../v250/stage-modes.mjs';
import * as FM from '../../v250/forge-modes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), PKG = join(HERE, '..'), ROOT = join(PKG, '..', '..'), WRITE = process.argv.includes('--write');
const cat = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'stages/v250/authoring-catalog.json.gz'))));
const ic = JSON.parse(readFileSync(join(ROOT, 'tools/data/item-catalog.json'))).items;
const items = Object.fromEntries(Object.entries(ic).map(([k, v]) => [k, { bonus: v.b || [0, 0, 0, 0], type3: v.k || 0 }]));
const sha = b => createHash('sha256').update(b).digest('hex'), shaAsync = async b => sha(Buffer.from(b));
const done = [], step = (name, fn) => { fn(); done.push(name); };
const pill = (q, extra = {}) => ({ id: '13683', quantity: q, level: 1, plus: { hp: 0, atk: 0, def: 0, speed: 2 }, ...extra });
const json = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const errCode = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.code, code, `${code} expected, got ${e.code}: ${e.message}`); return e.message; } assert.fail(`${code} expected, nothing thrown`); };

// ---- the three examples (static files in examples/, regenerated with --write)
const banner = readFileSync(join(PKG, 'examples/pack/banners/example-emergency.png'));
function makeExamples() {
  const t = cat.donors['300301'], ch = t.mission.missionInfo.subMission;
  const emergency = R.withRewards(SM.create(cat, 'emergency-layout/1', '300301', 'example:emergency-rewards', 'Rewards Example'), {
    playerExp: 3000, unitExp: 2500, ryo: { min: 2000, max: 3000 }, firstClearPearls: 5,
    challenges: [
      { state: 3, sign: 3, value: 15, limited: [], text: 'Complete within 15 turns', reward: { pearls: 5, items: [pill(3)] } },
      { state: ch[1].state, sign: ch[1].sign, value: ch[1].value, limited: [1], text: 'Skill elementals only', reward: { pearls: 3 } },
      { state: 10, sign: 3, value: 20, limited: [], text: 'Character cost 20 or lower only', reward: { ryo: 10000 } }],
    lucky: pill(2),
    drops: { 30030111: { item: { id: '13683', level: 1, plus: { hp: 0, atk: 0, def: 0, speed: 2 } }, chancePerThousand: 250 },
      30030112: { item: { id: '11822', level: 1, plus: { hp: 0, atk: 2, def: 0, speed: 0 } }, chancePerThousand: 500 },
      30030110: { item: null, chancePerThousand: 0 } }
  }, { file: 'banners/example-emergency.png', sha256: sha(banner), width: 680, height: 320 });
  emergency.maps[0].markers = [{ chip: 8, grid: [2, 6] }];
  const road = R.withRewards(SM.create(cat, 'ninja-road-layout/1', '80043', 'example:road-rewards', 'Road Rewards Example'), {
    mapClear: { 8043015: { items: [pill(1)] }, 8043020: {}, 8043010: { pearls: 10 } }, roadClear: { pearls: 50, items: [{ id: '12966', quantity: 1, level: 1 }] } });
  const castle = R.withRewards({ format: 'ForgeCastle', schema: 1, profile: 'phantom-castle/1', localId: 'example:castle-rewards', name: 'Castle Rewards Example', donorPvpId: '1', pointScale: 1, enabled: true }, {
    floors: { 5: { items: [pill(5)] }, 3: {}, 100: { pearls: 100 } }, ranking: { '1-100': { pearls: 50, items: [pill(10)] } } });
  return { emergency, road, castle };
}
const ALLOC = { emergency: R.standardAlloc('emergency', 1), road: R.standardAlloc('road', 1), castle: R.standardAlloc('castle', 1) };
if (WRITE) {
  const ex = makeExamples(); json(join(PKG, 'examples/emergency-rewards.json'), ex.emergency); json(join(PKG, 'examples/road-rewards.json'), ex.road); json(join(PKG, 'examples/castle-rewards.json'), ex.castle);
  json(join(PKG, 'examples/pack/stages/emergency-rewards.json'), ex.emergency); json(join(PKG, 'examples/pack/stages/road-rewards.json'), ex.road); json(join(PKG, 'examples/pack/stages/castle-rewards.json'), ex.castle);
  json(join(PKG, 'examples/pack/forge-mod.json'), R.packManifest(['stages/emergency-rewards.json', 'stages/road-rewards.json', 'stages/castle-rewards.json'], ['banners/example-emergency.png']));
  json(join(HERE, 'golden/emergency.compiled.json'), R.compileStage(cat, ex.emergency, items, R.standardAlloc('emergency', 1)));
  json(join(HERE, 'golden/road.compiled.json'), R.compileStage(cat, ex.road, items, R.standardAlloc('road', 1)));
  json(join(HERE, 'golden/castle.compiled.json'), R.compileCastle(cat, ex.castle, items, R.standardAlloc('castle', 1)));
  console.log('wrote examples and golden files');
}
const EX = { emergency: read(join(PKG, 'examples/emergency-rewards.json')), road: read(join(PKG, 'examples/road-rewards.json')), castle: read(join(PKG, 'examples/castle-rewards.json')) };

step('examples validate, and their layout view passes the supplied layout validator unchanged', () => {
  assert.equal(R.validateDefinition(cat, EX.emergency, items), 'emergency'); assert.equal(R.validateDefinition(cat, EX.road, items), 'road'); assert.equal(R.validateDefinition(cat, EX.castle, items), 'castle');
  for (const d of Object.values(EX)) SM.validate(cat, R.layoutView(d));
  assert.deepEqual(R.layoutView(EX.emergency).maps, EX.emergency.maps); assert.equal(R.layoutView(EX.emergency).schema, 2); assert.equal(R.layoutView(EX.castle).schema, 1);
});
step('compiled rows match the golden files (the app-side contract)', () => {
  assert.deepEqual(R.compileStage(cat, EX.emergency, items, R.standardAlloc('emergency', 1)), read(join(HERE, 'golden/emergency.compiled.json')));
  assert.deepEqual(R.compileStage(cat, EX.road, items, R.standardAlloc('road', 1)), read(join(HERE, 'golden/road.compiled.json')));
  assert.deepEqual(R.compileCastle(cat, EX.castle, items, R.standardAlloc('castle', 1)), read(join(HERE, 'golden/castle.compiled.json')));
});
step('Emergency: speed pills keep their +2 Speed everywhere they are paid', () => {
  const o = R.compileStage(cat, EX.emergency, items, R.standardAlloc('emergency', 1));
  assert.equal(o.client.missionInfo.subMission[0].subMissionReward.units[0].plus_sp, 2);
  assert.equal(o.server.drops.lucky[0].plus_sp, 2); assert.equal(o.client.missionInfo.missionDropComplete.luckDropRewards[0].units[0].plus_sp, 2);
  const c = o.server.mission.dropCandidates.filter(r => r.dropId === 13683); assert.ok(c.length > 0 && c.every(r => r.plusSp === 2 && r.unitType3 === 93 && r.chancePerThousand === 250));
  assert.deepEqual(o.client.enemyClones.map(x => x.set.dropPlus_sp), [2]);
});
step('Emergency: a new drop item clones the shared enemy definition; a chance-only edit doesn’t; no-drop clears the rate', () => {
  const o = R.compileStage(cat, EX.emergency, items, R.standardAlloc('emergency', 1));
  assert.deepEqual(o.client.enemyClones.map(x => [x.from, x.to]), [[30030111, 61001001]]);
  assert.ok(o.client.dependencies.enemyUnitIds.includes(61001001) && !o.client.dependencies.enemyUnitIds.includes(30030111) && o.client.dependencies.enemyUnitIds.includes(30030112));
  const all = Object.values(o.client.enemySets).flat(); assert.ok(!all.some(e => e.id === 30030111)); assert.ok(all.filter(e => e.id === 30030112).every(e => e.dropRate === 500)); assert.ok(all.filter(e => e.id === 30030110).every(e => e.dropRate === 0));
  assert.ok(!o.server.mission.dropCandidates.some(r => r.enemyId === 30030110)); assert.deepEqual(o.server.drops.normalUnits, o.client.missionInfo.missionDropComplete.dropUnits);
  assert.ok(Object.keys(o.client.enemySets).every(id => /^380001\d{3}$/.test(id)), 'only this mission’s cloned sets');
});
step('Emergency: first clear, challenge strings, banner image and mirrored objectives', () => {
  const o = R.compileStage(cat, EX.emergency, items, R.standardAlloc('emergency', 1));
  assert.equal(o.client.stage.rewardJewel, 5); assert.deepEqual(o.server.firstClearGroup, { missionIds: [380001], reward: 5 });
  assert.deepEqual(o.strings, { forge_stage_380001_objective_1: 'Complete within 15 turns', forge_stage_380001_objective_3: 'Character cost 20 or lower only' });
  assert.equal(o.client.missionInfo.subMission[1].langSubMissionNameId, cat.donors['300301'].mission.missionInfo.subMission[1].langSubMissionNameId, 'unchanged condition keeps the game’s own string');
  assert.deepEqual(o.server.objectives, o.client.missionInfo.subMission); assert.equal(o.client.missionInfo.subMission[0].limited.length, 300);
  assert.deepEqual(o.banner, { imageId: 3800, file: 'banners/example-emergency.png', sha256: sha(banner), width: 680, height: 320 }); assert.equal(o.client.stage.imageId, 3800); assert.equal(o.server.stage.imageId, 3800);
});
step('Road: client sroad display rows and server sroadRewards stay identical; removed and added maps; Road clear on both sides', () => {
  const o = R.compileStage(cat, EX.road, items, R.standardAlloc('road', 1));
  assert.deepEqual(o.client.sroadMapClearRewards, o.server.sroadRewards);
  const ids = o.server.sroadRewards.map(r => r.mapId); assert.ok(ids.includes(8800101) && !ids.includes(8800106) && ids.includes(8800104));
  assert.equal(o.server.sroadRewards.find(r => r.mapId === 8800104).reward[0].units[0].plus_sp, 2);
  assert.equal(o.client.missionInfo.missionClearComplete.jewel, 50); assert.equal(o.server.missionClearComplete.units[0].unitId, 12966);
});
step('Castle: floors and ranking go into the slot season’s own tables, events and client rows agree', () => {
  const o = R.compileCastle(cat, EX.castle, items, R.standardAlloc('castle', 1));
  assert.deepEqual(o.server.floorRewards['5'], [[1, 5, 13683, 1, 0, 1, 0, 0, 0, 2, 1]]); assert.equal(o.server.floorRewards['3'], undefined); assert.deepEqual(o.server.floorRewards['100'], [[2, 100]]);
  assert.equal(o.client.arenaFloorRewards.find(r => r.floor === 5).units[0].plus_sp, 2); assert.ok(!o.client.arenaFloorRewards.some(r => r.floor === 3));
  assert.deepEqual(o.server.rankingRewards[0].events, [[2, 50], [1, 10, 13683, 1, 0, 1, 0, 0, 0, 2, 1]]); assert.equal(o.client.arenaRankingRewards[0].jewel, 50);
  assert.deepEqual(o.server.rankingRewards.slice(1), cat.castleDonors['1'].rankingRewards.slice(1), 'other bands untouched');
  assert.equal(o.destination.pvpId, 9800);
});
step('compatible stock drop candidates are reproduced; six wider legacy lists reject edited drops', () => {
  // restate every enemy whose drop rate is the same at all its placements (and that has a drop item) with its own
  // item and rate: the rebuilt candidates must equal the template's own server rows, row for row
  let restated = 0;
  for (const [id, t] of Object.entries(cat.donors)) {
    const base = R.dropItemsOf(t), rates = {}; for (const m of t.maps) for (const s of m.sets) for (const e of s.raw.enemySet) if (e.id > 0) (rates[e.id] = rates[e.id] || new Set()).add(e.dropRate);
    const drops = {}; for (const [e, set] of Object.entries(rates)) { const b = base[e]; if (!b || set.size !== 1) continue; drops[e] = { item: { id: b.item, level: b.level, plus: { hp: b.row.plusS, atk: b.row.plusA, def: b.row.plusD, speed: b.row.plusSp } }, chancePerThousand: [...set][0] }; }
    if (!Object.keys(drops).length) continue;
    const def = R.withRewards(SM.create(cat, 'emergency-layout/1', id, 'test:x', 'X'), { drops }, null);
    if (new Set(t.serverMission.dropCandidates.map(c => c.dropId)).size > 3) { errCode(() => R.compileStage(cat, def, items, R.standardAlloc('emergency', 1)), 'REWARD_DROP'); continue; }
    const o = R.compileStage(cat, def, items, { ...R.standardAlloc('emergency', 1), mapId: i => Number(t.maps[i].id), setId: (i, j) => Number(t.maps[i].sets[j].id) });
    assert.equal(o.client.enemyClones, undefined, `${id}: nothing to clone when nothing changes`);
    const want = t.serverMission.dropCandidates.map(c => ({ ...c, unitType3: items[String(c.dropId)] ? items[String(c.dropId)].type3 : c.unitType3 }));
    assert.deepEqual(o.server.mission.dropCandidates, want, `${id}: rebuilt candidates`); assert.deepEqual(o.server.drops.normalUnits, [...new Set(want.map(c => c.dropId))]);
    restated += Object.keys(drops).length;
  }
  assert.ok(restated > 300, `restated ${restated} enemies`);
});
step('drafts: website edits become a definition and come back the same', () => {
  const t = cat.donors['300301'], base = FM.templateRewards('emergency', t), r = JSON.parse(JSON.stringify(base));
  assert.equal(R.fromDraft('emergency', base, r, items, t), null, 'no edits, no rewards block');
  r.exp = 3000; r.lucky = { unitId: '13683', qty: 2 }; r.drops['30030111'] = { item: '13683', chance: 250, varies: false }; r.challenges[2].reward = [{ key: 'jewel', qty: 9 }];
  const rw = R.fromDraft('emergency', base, r, items, t); assert.deepEqual(Object.keys(rw).sort(), ['challenges', 'drops', 'lucky', 'playerExp']);
  assert.deepEqual(rw.lucky.plus, { hp: 0, atk: 0, def: 0, speed: 2 }); assert.deepEqual(R.toDraft('emergency', base, rw), r);
  const rt = cat.roadDonors['80043'], rb = FM.templateRewards('road', rt), rr = JSON.parse(JSON.stringify(rb)); rr.mapClear['8043015'] = [{ key: 'item', unitId: '13682', qty: 4, level: 1 }]; rr.roadClear = [{ key: 'jewel', qty: 20 }];
  const rrw = R.fromDraft('road', rb, rr, items, rt); assert.deepEqual(rrw.mapClear['8043015'].items[0].plus.speed, 1); assert.deepEqual(R.toDraft('road', rb, rrw), rr);
  const cv = R.castleFromDraft(cat, EX.castle, { floors: { 5: [{ key: 'item', unitId: '13683', qty: 5, level: 1 }] }, ranking: { 0: [{ key: 'jewel', qty: 50 }] } }, items);
  assert.deepEqual(Object.keys(cv.ranking), ['1-100']); assert.deepEqual(R.castleToDraft(cat, EX.castle, cv), { floors: { 5: [{ key: 'item', unitId: '13683', qty: 5, level: 1 }] }, ranking: { 0: [{ key: 'jewel', qty: 50 }] } });
});
step('every rejection has its code', () => {
  const e = JSON.parse(JSON.stringify(EX.emergency)), mut = f => { const d = JSON.parse(JSON.stringify(e)); f(d); return () => R.validateDefinition(cat, d, items); };
  errCode(mut(d => { d.rewards.lucky.id = '99999999'; }), 'REWARD_ITEM');
  errCode(mut(d => { d.rewards.lucky.plus.speed = 9; }), 'REWARD_BONUS');
  errCode(mut(d => { d.rewards.challenges[0].reward.items = [pill(1), pill(1), pill(1), pill(1), pill(1)]; }), 'REWARD_TOO_MANY');
  errCode(mut(d => { d.rewards.challenges.pop(); }), 'REWARD_CHALLENGE');
  errCode(mut(d => { d.rewards.challenges[0].state = 99; }), 'REWARD_CHALLENGE');
  errCode(mut(d => { d.rewards.challenges[1].limited = [7]; }), 'REWARD_CHALLENGE');
  errCode(mut(d => { d.rewards.drops['1'] = { item: null, chancePerThousand: 0 }; }), 'REWARD_DROP');
  errCode(mut(d => { d.rewards.drops['30030111'].item = null; }), 'REWARD_DROP');
  errCode(mut(d => { d.rewards.ryo = { min: 5, max: 1 }; }), 'REWARD_NUMBER');
  errCode(mut(d => { d.rewards.bonusPearls = 1; }), 'REWARD_FIELD');
  errCode(mut(d => { d.banner.width = 512; }), 'BANNER_SIZE');
  errCode(mut(d => { d.banner.file = 'banner.png'; }), 'BANNER_FORMAT');
  errCode(mut(d => { d.schema = 2; }), 'REWARD_FORMAT');
  const noLucky = R.withRewards(SM.create(cat, 'emergency-layout/1', '302101', 'test:y', 'Y'), { lucky: pill(1) }, null); errCode(() => R.validateDefinition(cat, noLucky, items), 'REWARD_LUCKY');
  const road = JSON.parse(JSON.stringify(EX.road)); road.rewards.mapClear['3003011'] = {}; errCode(() => R.validateDefinition(cat, road, items), 'REWARD_MAP');
  const c1 = JSON.parse(JSON.stringify(EX.castle)); c1.rewards.ranking['1-50'] = {}; errCode(() => R.validateDefinition(cat, c1, items), 'REWARD_RANKING');
  const c2 = JSON.parse(JSON.stringify(EX.castle)); c2.rewards.floors['101'] = {}; errCode(() => R.validateDefinition(cat, c2, items), 'REWARD_FLOOR');
});
step('pack manifest, banner bytes and file list', () => {
  const man = read(join(PKG, 'examples/pack/forge-mod.json')), names = ['forge-mod.json', ...readdirSync(join(PKG, 'examples/pack/stages')).map(f => 'stages/' + f), ...readdirSync(join(PKG, 'examples/pack/banners')).map(f => 'banners/' + f)];
  R.validatePack(names, man, Object.values(EX));
  errCode(() => R.validatePack([...names, 'units/x.json'], man, Object.values(EX)), 'PACK_FORMAT');
  errCode(() => R.validatePack(names.filter(n => !n.startsWith('banners/')), man, Object.values(EX)), 'PACK_FORMAT');
  assert.deepEqual(R.pngSize(banner), { width: 680, height: 320 });
});
await R.checkBannerBytes(EX.emergency, new Uint8Array(banner), shaAsync);
await assert.rejects(R.checkBannerBytes({ banner: { ...EX.emergency.banner, sha256: '0'.repeat(64) } }, new Uint8Array(banner), shaAsync), e => e.code === 'BANNER_HASH'); done.push('banner bytes: size and SHA-256 checked');
step('layout-only definitions are untouched: no rewards and no banner stay schema 2 / castle schema 1', () => {
  const l = SM.create(cat, 'emergency-layout/1', '300301', 'test:z', 'Z'); assert.equal(R.withRewards(l, null, null), l);
  assert.equal(R.withRewards({ format: 'ForgeCastle', schema: 1, profile: 'phantom-castle/1', localId: 'a:b', name: 'C', donorPvpId: '1' }, null, null).schema, 1);
});
console.log(JSON.stringify({ passed: true, checks: done.length, names: done, phoneTested: false }, null, 1));
