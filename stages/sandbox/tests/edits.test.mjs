// Checks for sandbox-edits.mjs against the supplied event package.
// usage: node stages/sandbox/tests/edits.test.mjs <extracted package folder>
// (The package isn't stored in this repo; it's imported into the browser by whoever edits it.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as K from '../sandbox-edits.mjs';
const dir = process.argv[2]; if (!dir) { console.log('usage: node edits.test.mjs <extracted package folder>'); process.exit(2); }
const read = f => readFileSync(join(dir, f), 'utf8');
const text = read('Kirito-Events.forge-stage-project.json'), lib = JSON.parse(read('catalogs/rewards.json')), labels = JSON.parse(read('catalogs/enemies.json'));
const p = K.importText(text, lib), done = [];
const t = (name, fn) => { fn(); done.push(name); };
const [intro, equip, floor] = p.catalog.stages.map(s => s.spec.localId);
const fm = p.catalog.stages[2].donor.maps;

t('no-op round trip is byte-identical (with the file’s own line endings)', () => { assert.equal(K.withEol(K.SA.exportProject(p), K.eolOf(text)), text); assert.deepEqual(K.importText(K.SA.exportProject(p), lib), p); });
t('reserved IDs, map order and projectId kept', () => {
  assert.equal(p.projectId, 'kirito:events-v240'); assert.deepEqual(p.catalog.stages.map(s => [s.slot.stageId, s.slot.missionId]), [['3820', '382001'], ['3821', '382101'], ['3822', '382201']]);
  assert.deepEqual(p.catalog.stages.map(s => s.donor.maps.length), [1, 3, 99]);
});
t('big integers that a number can’t hold are refused', () => assert.throws(() => K.importText(text.replace('"schema": 1', '"schema": 1, "x": 12345678901234567890'), lib), /too large/));
t('coins and EXP keep client and server together', () => {
  const n = K.setCurrency(p, intro, { minCoin: 100, maxCoin: 200, exp: 3000, charaExp: 4000 }, lib), d = n.catalog.stages[0].donor;
  assert.deepEqual([d.mission.missionInfo.minCoin, d.mission.missionInfo.maxCoin, d.mission.missionInfo.exp, d.mission.missionInfo.charaExp], [100, 200, 3000, 4000]);
  assert.deepEqual([d.serverMission.minimumCoin, d.serverMission.maximumCoin, d.serverMission.experience, d.serverMission.characterExperience], [100, 200, 3000, 4000]);
  assert.throws(() => K.setCurrency(p, intro, { minCoin: 300, maxCoin: 200, exp: 0, charaExp: 0 }, lib)); assert.throws(() => K.setCurrency(p, intro, { minCoin: -1, maxCoin: 2, exp: 0, charaExp: 0 }, lib));
});
t('challenge currency keeps conditions and the mirrored objective array', () => {
  const n = K.setChallengeCurrency(p, floor, '1', { jewel: 20, coin: 5000 }, lib), d = n.catalog.stages[2].donor, o = d.mission.missionInfo.subMission[0];
  assert.deepEqual([o.subMissionReward.jewel, o.subMissionReward.coin], [20, 5000]); assert.deepEqual(d.objective.objectives, d.mission.missionInfo.subMission);
  const b = p.catalog.stages[2].donor.mission.missionInfo.subMission[0]; for (const k of ['state', 'sign', 'value', 'limited']) assert.deepEqual(o[k], b[k]);
  assert.throws(() => K.setChallengeCurrency(p, floor, '1', { jewel: 10000, coin: 0 }, lib));
});
t('normal, lucky, challenge and coin edits stay independent', () => {
  let n = K.SA.setNormalDrop(p, intro, '3820011', '60000001', '16445', 30, lib); n = K.setNormalDropDetails(n, intro, '3820011', '60000001', { levelMin: 2, levelMax: 3, luck: 1, plus: { s: 1, a: 2, d: 3, sp: 4 } }, lib);
  const c = n.catalog.stages[0].donor.serverMission.dropCandidates; assert.ok(c.length && c.every(x => x.unitLevelMin === 2 && x.plusSp === 4 && x.dropId === 16445));
  assert.deepEqual(n.catalog.stages[0].donor.drops.lucky, p.catalog.stages[0].donor.drops.lucky); assert.deepEqual(n.catalog.stages[0].donor.mission.missionInfo.subMission, p.catalog.stages[0].donor.mission.missionInfo.subMission);
  n = K.SA.setLuckyReward(n, equip, '12966', 2, lib); n = K.setLuckyDetails(n, equip, { level: 5, luck: 2, plus: { s: 0, a: 0, d: 0, sp: 0 } }, lib);
  assert.equal(n.catalog.stages[1].donor.drops.lucky[0].chara_level, 5); assert.deepEqual(n.catalog.stages[1].donor.serverMission, p.catalog.stages[1].donor.serverMission);
  assert.deepEqual(n.catalog.stages[0].donor.firstClearGroup, p.catalog.stages[0].donor.firstClearGroup, 'first clear untouched');
});
t('placements: level range, count, role, facing, on/off; drop candidates follow', () => {
  const m = fm[0], set = m.sets[0], e = p.catalog.enemies.find(x => x.id === set.raw.enemySet[0].id);
  assert.deepEqual(K.levelRange(e), [1, 1]); assert.throws(() => K.setPlacement(p, floor, m.id, set.id, 0, { level: 2, count: 1, type: 0, way: 4, enabled: true }, lib), /1–1/);
  const n = K.setPlacement(p, floor, m.id, set.id, 0, { level: 1, count: 3, type: 3, way: 5, enabled: false }, lib), t2 = n.catalog.stages[2].donor.maps[0].sets[0].raw.enemySet[0];
  assert.deepEqual([t2.count, t2.type, t2.way, t2.enabled], [3, 3, 5, false]);
  const cand = n.catalog.stages[2].donor.serverMission.dropCandidates.filter(c => c.mapId === Number(m.id) && c.enemyId === t2.id); assert.equal(cand.filter(c => c.enemyCount === 3).length, 1); assert.equal(n.catalog.stages[2].donor.serverMission.dropCandidates.length, p.catalog.stages[2].donor.serverMission.dropCandidates.length);
  for (const bad of [{ count: 0 }, { count: 21 }, { type: 1 }, { way: 6 }, { enabled: 'yes' }]) assert.throws(() => K.setPlacement(p, floor, m.id, set.id, 0, { level: 1, count: 1, type: 0, way: 4, enabled: true, ...bad }, lib));
});
t('stats: row level and paramDatas mirrored', () => {
  const m = fm[8], eid = m.sets[0].raw.enemySet[0].id; const n = K.setEnemyStats(p, floor, m.id, eid, { hp: 123456, atk: 789, def: 10 }, lib), e = n.catalog.enemies.find(x => x.id === eid);
  assert.deepEqual([e.hp.s, e.hp.e, e.atk.s, e.def.s], [123456, 123456, 789, 10]); assert.deepEqual([e.paramDatas[0].hp, e.paramDatas[0].atk, e.paramDatas[0].def], [e.hp, e.atk, e.def]);
  assert.throws(() => K.setEnemyStats(p, floor, m.id, eid, { hp: 0, atk: 1, def: 1 }, lib)); assert.throws(() => K.setEnemyStats(p, floor, fm[0].id, eid, { hp: 5, atk: 1, def: 1 }, lib), /another map/);
});
t('difficulty value and stat multiplier over a map range', () => {
  const n = K.setDifficulty(p, floor, 3, lib); assert.deepEqual([n.catalog.stages[2].donor.mission.missionInfo.difficulty, n.catalog.stages[2].donor.serverMission.difficulty], [3, 3]); assert.throws(() => K.setDifficulty(p, floor, 6, lib));
  const s = K.scaleStats(p, floor, 10, 18, 1.5, { hp: true, atk: true, def: false }, lib);
  const before = id => p.catalog.enemies.find(x => x.id === id), after = id => s.catalog.enemies.find(x => x.id === id);
  const inId = fm[9].sets[0].raw.enemySet[0].id, outId = fm[19].sets[0].raw.enemySet[0].id;
  assert.equal(after(inId).hp.s, Math.round(before(inId).hp.s * 1.5)); assert.equal(after(inId).def.s, before(inId).def.s); assert.deepEqual(after(outId), before(outId));
  assert.throws(() => K.scaleStats(p, floor, 1, 99, 11, null, lib)); assert.throws(() => K.scaleStats(p, floor, 5, 2, 2, null, lib));
});
t('reset a map restores its layout, placements and its own enemy rows', () => {
  const m = fm[8], eid = m.sets[0].raw.enemySet[0].id; let n = K.setEnemyStats(p, floor, m.id, eid, { hp: 5, atk: 5, def: 5 }, lib); n = K.SA.moveMarker(n, floor, m.id, 8, 1, 3 + 0) ;
  const r = K.resetMap(n, p, floor, m.id, lib); assert.deepEqual(r.catalog.enemies, p.catalog.enemies); assert.deepEqual(r.catalog.stages[2].donor.maps[8], p.catalog.stages[2].donor.maps[8]);
});
t('scene keeps the supplied derivation and adds the raw placement fields', () => {
  const v = K.scene(p, floor, fm[8].id, labels), s0 = K.SA.scene(p, floor, fm[8].id, labels);
  assert.equal(v.enemies.length, s0.enemies.length); assert.ok(v.enemies.every((e, i) => e.spawnCandidates.length === s0.enemies[i].spawnCandidates.length && e.entry && e.type === e.entry.type));
});
t('the supplied game-export gate stays closed', () => assert.equal(K.SA.gameExportStatus().allowed, false));
console.log(JSON.stringify({ passed: true, checks: done.length, names: done }, null, 1));
