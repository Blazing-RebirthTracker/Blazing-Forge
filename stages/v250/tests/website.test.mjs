// Website-side checks for the v2.5.0 stage modes (run: node tests/website.test.mjs from stages/v250).
// These cover the page's own logic around the supplied adapter; they say nothing about phone playback.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as F from '../forge-modes.mjs';
const { SM } = F;
const c = JSON.parse(gunzipSync(readFileSync(new URL('../authoring-catalog.json.gz', import.meta.url))));
const ids = JSON.parse(readFileSync(new URL('../slot-ids.json', import.meta.url)));
const results = [];
const test = (name, fn) => { fn(); results.push(name); };

test('slot table: 50/10/10, slots 1-20 keep 3800-3819, 21-50 skip the reserved 3820-3822', () => {
  const t = F.slotTable(c);
  assert.equal(t.emergency.length, 50); assert.equal(t.road.length, 10); assert.equal(t.castle.length, 10);
  t.emergency.slice(0, 20).forEach((s, i) => { assert.equal(s.stageId, String(3800 + i)); assert.equal(s.missionId, String((3800 + i) * 100 + 1)); });
  t.emergency.slice(20).forEach((s, i) => assert.equal(s.stageId, String(3823 + i)));
  assert.ok(!t.emergency.some(s => ['3820', '3821', '3822'].includes(s.stageId)));
  assert.deepEqual(t.road.map(s => s.missionId), Array.from({ length: 10 }, (_, i) => String(88001 + i * 10)));
  assert.deepEqual(t.castle.map(s => s.pvpId), Array.from({ length: 10 }, (_, i) => String(9800 + i)));
  assert.deepEqual([t.emergency[0].ledgerSlot, t.road[0].ledgerSlot, t.castle[9].ledgerSlot], [1, 51, 70]);
  assert.deepEqual(F.ledgerToKind(55, t), { kind: 'road', slot: 5 });
  assert.deepEqual(ids.slots, c.slots, 'slot-ids.json and the catalog agree');
  assert.deepEqual(ids.reservedKirito.map(k => k.stageId), ['3820', '3821', '3822']);
});

test('template counts per mode', () => {
  assert.equal(Object.keys(F.templateList(c, 'emergency')).length, 195);
  assert.equal(Object.keys(F.templateList(c, 'road')).length, 41);
  assert.equal(Object.keys(F.templateList(c, 'castle')).length, 120);
  assert.equal(F.template(c, 'road', '80014'), null, 'Road 80014 stays excluded');
  assert.equal(F.kindOfDonor(c, '300301'), 'emergency'); assert.equal(F.kindOfDonor(c, '80043'), 'road');
});

test('distinct, stable, namespaced local IDs', () => {
  const seen = new Set();
  for (const k of F.KIND_LIST) for (let i = 0; i < 500; i++) { const id = F.newLocalId(k); assert.ok(F.isLocalId(id)); assert.ok(id.startsWith(F.KINDS[k].prefix + ':')); assert.ok(!seen.has(id)); seen.add(id); }
  assert.ok(!F.isLocalId('nocolon')); assert.ok(!F.isLocalId('a:' + 'x'.repeat(95))); assert.ok(!F.isLocalId('bad:space here'));
});

const tplE = F.template(c, 'emergency', '300301'), tplR = F.template(c, 'road', '80043');
const specE = F.layoutSpec('emergency', { localId: 'test:e', name: 'E', donor: '300301' }, tplE, []);
const specR = F.layoutSpec('road', { localId: 'test:r', name: 'R', donor: '80043' }, tplR, []);
const specC = F.castleSpec({ localId: 'test:c', name: 'C', donorPvpId: '1' });

test('layout specs keep every template map in order and pass the adapter', () => {
  assert.equal(F.contractProblem(c, specE), null); assert.equal(F.contractProblem(c, specR), null); assert.equal(F.contractProblem(c, specC), null);
  assert.deepEqual(specR.maps.map(m => m.donorMapId), tplR.maps.map(m => m.id));
  assert.deepEqual(specE, SM.create(c, SM.modes.emergency, '300301', 'test:e', 'E'));
  const swapped = structuredClone(specR); [swapped.maps[0], swapped.maps[1]] = [swapped.maps[1], swapped.maps[0]];
  assert.match(F.contractProblem(c, swapped), /order/);
  assert.match(F.contractProblem(c, { ...specR, maps: specR.maps.slice(1) }), /every template map/);
});

test('per-mode donor restrictions', () => {
  assert.ok(F.contractProblem(c, { ...specR, donorMissionId: '300301' }));
  assert.ok(F.contractProblem(c, { ...specE, donorMissionId: '80043' }));
  assert.ok(F.contractProblem(c, { ...specE, donorMissionId: 300301 }), 'numeric donor IDs fail');
  assert.ok(F.contractProblem(c, { ...specC, donorPvpId: '80043' }));
});

test('marker moves: valid move, invalid cells, random entries, 16-move cap', () => {
  const O = F.chipsOf(tplE.maps[0]);
  const floor = (() => { for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (O[y][x] === 1) return [x, y]; })();
  const E = O.map(r => r.slice()); const [px, py] = F.cellsWith(O, 8)[0]; E[py][px] = 1; E[floor[1]][floor[0]] = 8;
  const r = F.mapMoves(O, E, 'Map 1'); assert.deepEqual(r.moves, [{ chip: 8, grid: floor }]); assert.equal(r.errs.length, 0);
  const moved = F.layoutSpec('emergency', { localId: 'test:e', name: 'E', donor: '300301' }, tplE, [r.moves]); assert.equal(F.contractProblem(c, moved), null);
  const scene = SM.markerScene(c, moved, 0); assert.deepEqual(scene.cells.find(v => v.chip === 8).grid, floor);
  // a wall cell (chip 0) is not open floor
  const wall = (() => { for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (O[y][x] === 0) return [x, y]; })();
  const W = O.map(r => r.slice()); W[py][px] = 1; W[wall[1]][wall[0]] = 8; const rw = F.mapMoves(O, W, 'Map 1');
  assert.equal(rw.errs[0][0], 'STAGE_OCCUPIED');
  assert.ok(F.contractProblem(c, F.layoutSpec('emergency', { localId: 'test:e', name: 'E', donor: '300301' }, tplE, [rw.moves])));
  // onto another marker that stays put
  const [ex, ey] = F.cellsWith(O, 16)[0]; const X = O.map(r => r.slice()); X[py][px] = 1; X[ey][ex] = 8;
  assert.ok(F.contractProblem(c, { ...specE, maps: specE.maps.map((m, i) => i ? m : { ...m, markers: [{ chip: 8, grid: [ex, ey] }] }) }));
  // swapping two markers is fine (each lands on a vacated cell)
  const [qx, qy] = F.cellsWith(O, 9)[0];
  assert.equal(F.contractProblem(c, { ...specE, maps: specE.maps.map((m, i) => i ? m : { ...m, markers: [{ chip: 8, grid: [qx, qy] }, { chip: 9, grid: [px, py] }] }) }), null);
  // out-of-range and non-integer coordinates
  for (const g of [[-1, 0], [11, 0], [1.5, 2], [1]]) assert.ok(F.contractProblem(c, { ...specE, maps: specE.maps.map((m, i) => i ? m : { ...m, markers: [{ chip: 8, grid: g }] }) }));
  // random entry: 300302 map 1 has entry point 6 (chip 21) in 4 cells
  const t2 = F.template(c, 'emergency', '300302'); const cand = F.mapCandidates(t2, 0);
  assert.ok(cand.randomChips.includes(21)); const e21 = cand.sets.flatMap(s => s.entries).find(e => e.chip === 21); assert.ok(e21.random && e21.cells.length === 4);
  const sp2 = F.layoutSpec('emergency', { localId: 'test:e2', name: 'E2', donor: '300302' }, t2, [[{ chip: 21, grid: [5, 5] }]]);
  assert.ok(F.contractProblem(c, sp2), 'a random-entry marker can’t be moved on its own');
  const O2 = F.chipsOf(t2.maps[0]), E2 = O2.map(r => r.slice()); const cells = F.cellsWith(O2, 21); E2[cells[0][1]][cells[0][0]] = 1;
  assert.match(F.mapMoves(O2, E2, 'Map 1').lost.join(' '), /random entry/);
  // 17 moves on one map
  assert.match(F.contractProblem(c, { ...specE, maps: specE.maps.map((m, i) => i ? m : { ...m, markers: Array.from({ length: 17 }, () => ({ chip: 8, grid: floor })) }) }), /16/);
});

test('moves round-trip through the template grids', () => {
  const O = F.chipsOf(tplR.maps[2]); const [px, py] = F.cellsWith(O, 10)[0];
  let dest; for (let y = 0; y < 11 && !dest; y++) for (let x = 0; x < 11; x++) if (O[y][x] === 1) { dest = [x, y]; break; }
  const { grids, skipped } = F.gridsFromMoves(tplR, [[], [], [{ chip: 10, grid: dest }, { chip: 99, grid: [0, 0] }, { chip: 8, grid: [0, 0] }]]);
  assert.equal(skipped, 1, 'the wall destination is skipped; the unknown chip is dropped');
  assert.equal(grids[2][dest[1]][dest[0]], 10); assert.equal(grids[2][py][px], 1);
  assert.deepEqual(F.mapMoves(O, grids[2], 'Map 3').moves, [{ chip: 10, grid: dest }]);
});

test('enemy sets keep their probabilities', () => {
  const multi = Object.entries(F.templateList(c, 'road')).flatMap(([id, t]) => t.maps.map((m, i) => [id, i, m])).find(([, , m]) => m.sets.length > 1);
  const cand = F.mapCandidates(F.template(c, 'road', multi[0]), multi[1]);
  assert.ok(cand.sets.length > 1); const sum = cand.sets.reduce((a, s) => a + s.chance, 0); assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('castle: point scales, final zero, presets', () => {
  const pts = c.castleDonors['1'].points; const last = pts[pts.length - 1];
  assert.equal(last[1], 0, 'the final threshold is zero in the source');
  for (const s of [0.1, 1, 1.5, 10]) { assert.equal(F.contractProblem(c, { ...specC, pointScale: s }), null);
    const rows = F.scaledPoints(pts, s); assert.equal(rows[rows.length - 1].scaled, 0); assert.equal(rows[0].scaled, Math.round(pts[0][1] * s)); assert.equal(rows[5].base, pts[5][2]); }
  for (const s of [0, 0.09, 10.01, NaN, Infinity, '2']) assert.ok(F.contractProblem(c, { ...specC, pointScale: s }), 'scale ' + s);
  const big = F.scaledPoints(pts, 2), small = F.scaledPoints(pts, 1);
  assert.ok(big.slice(0, -1).every((r, i) => r.scaled >= small[i].scaled), 'a higher scale raises cumulative thresholds');
  const presets = F.compatiblePresets(c, '1'); assert.ok(presets.length > 100 && presets.includes('1'));
  for (const p of presets.slice(0, 5)) assert.equal(F.contractProblem(c, F.castleSpec({ localId: 'test:c', name: 'C', donorPvpId: '1', rewardPvpId: p })), null);
  const other = Object.keys(c.castleDonors).find(id => !presets.includes(id)); assert.ok(other);
  assert.match(F.contractProblem(c, F.castleSpec({ localId: 'test:c', name: 'C', donorPvpId: '1', rewardPvpId: other })), /floor progression/);
  assert.equal(F.castleSpec({ localId: 'a:b', name: 'x', donorPvpId: '1', rewardPvpId: '1' }).rewardPvpId, undefined, 'same season means inherit');
  const v = F.castleView(c, F.castleSpec({ localId: 'a:b', name: 'x', donorPvpId: '1', rewardPvpId: presets[3], pointScale: 2 }));
  assert.equal(v.floors.length, 100); assert.equal(v.floors[0].scaled, 1000); assert.ok(v.ranking.length > 0);
});

test('reward codes match the raw reward rows', () => {
  assert.deepEqual(F.decodeReward([2, 30]), { key: 'jewel', label: 'Ninja Pearls', qty: 30, raw: [2, 30] });
  const it = F.decodeReward([1, 1, 11812, 1, 0, 1, 5, 0, 0, 0, 1]); assert.equal(it.unitId, '11812'); assert.equal(it.plus.s, 5);
  let items = 0, hit = 0;
  for (const d of Object.values(c.castleDonors)) { const raw = Object.fromEntries(d.arena.arenaFloorRewards.map(r => [r.floor, r]));
    for (const [fl, evs] of Object.entries(d.floorRewards)) for (const ev of evs) { const r = raw[+fl]; if (!r) continue; const k = F.REWARD_KINDS[ev[0]];
      if (k && k.field) assert.equal(r[k.field], ev[1]); if (ev[0] === 1) { items++; if (r.units.some(u => u.unitId === ev[2] && u.unitNum === ev[1])) hit++; } } }
  assert.ok(hit / items > 0.99, `item rows match the raw unit rows (${hit}/${items}; the rest come from rows the source skipped)`);
});

test('road rewards stay split by source and only for the road’s own maps', () => {
  const rr = F.roadRewards(tplR), own = new Set(tplR.maps.map(m => Number(m.id)));
  for (const k of ['server', 'serverMission', 'client']) assert.ok(rr[k].every(r => own.has(r.mapId)));
  assert.ok(rr.server.length > 0);
});

const cand = (kind, slot, spec, exported) => ({ kind, slot, name: spec ? spec.name : '', spec, exported: !!exported });
test('export: zero, one, full, overflow, disabled exclusion and explicit disabled export', () => {
  assert.ok(F.planExport(c, []).error, 'zero definitions');
  assert.ok(F.planExport(c, [cand('emergency', 1, null)]).error, 'empty slots are never exported');
  const one = F.planExport(c, [cand('road', 1, specR)]); assert.equal(one.error, null);
  assert.deepEqual(F.packMembers(one.files).map(m => m.name), ['forge-mod.json', 'stages/01.json']);
  assert.deepEqual(JSON.parse(one.files['stages/01.json']), specR);
  const full = [...Array.from({ length: 50 }, (_, i) => cand('emergency', i + 1, { ...specE, localId: 'full:e' + i, enabled: i % 2 === 0 }, true)),
    ...Array.from({ length: 10 }, (_, i) => cand('road', i + 1, { ...specR, localId: 'full:r' + i, enabled: i === 0 }, true)),
    ...Array.from({ length: 10 }, (_, i) => cand('castle', i + 1, { ...specC, localId: 'full:c' + i, enabled: i === 3 }, true))];
  const on = F.planExport(c, full); assert.equal(on.error, null); assert.equal(on.included.length, 25 + 1 + 1);
  assert.ok(on.included.every(x => x.spec.enabled !== false)); assert.equal(on.leftOut.length, 70 - 27);
  const all = F.planExport(c, full, { includeDisabled: true }); assert.equal(all.error, null); assert.equal(all.included.length, 70);
  const man = JSON.parse(all.files['forge-mod.json']); assert.equal(man.stages.length, 70); assert.equal(Object.keys(all.files).length, 71);
  assert.ok(Object.values(all.files).reduce((n, v) => n + Buffer.byteLength(v), 0) <= 2 * 1024 * 1024);
  const over = F.planExport(c, [...full, cand('emergency', 51, { ...specE, localId: 'over:e' }, true)], { includeDisabled: true }); assert.match(over.error, /50/);
  const overR = F.planExport(c, [...full.filter(x => x.kind === 'road'), cand('road', 11, { ...specR, localId: 'over:r', enabled: false }, true)], { includeDisabled: true }); assert.match(overR.error, /10/);
  // disabled definitions never exported from here stay out unless picked
  const mixed = [cand('emergency', 1, { ...specE, localId: 'm:on' }), cand('emergency', 2, { ...specE, localId: 'm:sent', enabled: false }, true), cand('emergency', 3, { ...specE, localId: 'm:new', enabled: false }, false)];
  assert.deepEqual(F.planExport(c, mixed).included.map(x => x.spec.localId), ['m:on']);
  const ex = F.planExport(c, mixed, { includeDisabled: true }); assert.deepEqual(ex.included.map(x => x.spec.localId), ['m:on', 'm:sent']); assert.ok(ex.leftOut.find(x => x.spec.localId === 'm:new').optional);
  assert.deepEqual(F.planExport(c, mixed, { includeDisabled: true, pick: () => true }).included.map(x => x.spec.localId), ['m:on', 'm:sent', 'm:new']);
  assert.equal(JSON.parse(ex.files['stages/02.json']).enabled, false, 'disabled definitions go as explicit updates');
  // two active roads can't be exported
  assert.match(F.planExport(c, [cand('road', 1, specR), cand('road', 2, { ...specR, localId: 'test:r2' })]).error, /one active/i);
  // duplicate local IDs
  assert.match(F.planExport(c, [cand('emergency', 1, specE), cand('emergency', 2, { ...specE })]).error, /Duplicate/);
  // invalid ones are listed, not silently dropped
  const badOne = F.planExport(c, [cand('emergency', 1, { ...specE, rewards: [] }), cand('road', 1, specR)]);
  assert.equal(badOne.included.length, 1); assert.match(badOne.leftOut[0].why, /unsupported edits/);
});

test('one active Road and Castle through setEnabled', () => {
  const recs = [{ localId: 'r:1', profile: specR.profile, enabled: true }, { localId: 'r:2', profile: specR.profile, enabled: false }, { localId: 'e:1', profile: specE.profile, enabled: true }, { localId: 'e:2', profile: specE.profile, enabled: true }];
  assert.deepEqual(F.applyEnabled(recs, 'r:2', true), { 'r:1': false, 'r:2': true, 'e:1': true, 'e:2': true });
  assert.deepEqual(F.applyEnabled(recs, 'e:2', false), { 'r:1': true, 'r:2': false, 'e:1': true, 'e:2': false });
});

test('imports keep extra fields out of the installable spec', () => {
  const s = F.splitDefinition({ ...specR, notes: 'hi', maps: specR.maps.map((m, i) => i ? m : { ...m, title: 'x' }) });
  assert.equal(s.kind, 'road'); assert.equal(F.contractProblem(c, s.spec), null); assert.deepEqual(s.extra, { notes: 'hi', mapFields: { 0: { title: 'x' } } });
  assert.equal(F.splitDefinition({ format: 'ForgeStage', schema: 1, maps: [] }).error, 'draft');
  assert.equal(F.splitDefinition(JSON.parse(readFileSync(new URL('../examples/castle.json', import.meta.url)))).kind, 'castle');
  for (const f of ['emergency', 'road', 'castle']) { const j = JSON.parse(readFileSync(new URL(`../examples/${f}.json`, import.meta.url))); assert.equal(F.contractProblem(c, F.splitDefinition(j).spec), null); }
});

test('projects: 20-slot projects open into the 50-slot layout; newer projects keep Road and Castle', () => {
  const old = { format: 'ForgeStageWorkspace', schema: 1, slots: Array.from({ length: 20 }, (_, i) => ({ slot: i + 1, stageId: String(3800 + i), stage: i === 4 ? { maps: [], localId: 'forge-stages:old' } : null })) };
  const n = F.normalizeWorkspace(old); assert.equal(n.pre250, true); assert.equal(n.emergency.length, 20); assert.equal(n.emergency[4].stage.localId, 'forge-stages:old'); assert.equal(n.emergency[4].slot, 5);
  const v2 = F.normalizeWorkspace({ format: 'ForgeStageWorkspace', schema: 2, slots: [{ slot: 50, stage: null }, { slot: 51, stage: {} }], roadSlots: [{ slot: 10, stage: { kind: 'road', maps: [] } }, { slot: 11, stage: {} }], castleSlots: [{ slot: 1, record: { spec: specC } }] });
  assert.deepEqual([v2.emergency.length, v2.road.length, v2.castle.length], [1, 1, 1]); assert.equal(v2.road[0].stage.kind, 'road'); assert.equal(v2.castle[0].record.spec.localId, 'test:c');
  assert.equal(F.normalizeWorkspace({ format: 'ForgeStagePack' }), null);
});

console.log(JSON.stringify({ passed: true, tests: results.length, names: results }, null, 1));
