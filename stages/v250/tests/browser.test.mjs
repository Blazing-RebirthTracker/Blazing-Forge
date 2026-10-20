// Browser acceptance checks for the Stages page (website only; they say nothing about phone playback or rewards).
// Needs Playwright with Chromium and the repo served over http, e.g. from the repo root:
//   python3 -m http.server 8765  &&  node stages/v250/tests/browser.test.mjs [http://127.0.0.1:8765]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const BASE = (process.argv[2] || 'http://127.0.0.1:8765') + '/stages/index.html?debug=1';
const ex = f => JSON.parse(readFileSync(new URL(`../examples/${f}.json`, import.meta.url)));
const passed = [], errors = [];
const b = await chromium.launch();
async function page(viewport = { width: 1280, height: 900 }, extra = {}) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true, ...extra }); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  p.load = async () => { await p.goto(BASE, { waitUntil: 'load' }); await p.waitForFunction(() => window.__stages && window.__stages.FM && document.getElementById('bdSub').textContent.length > 0, null, { timeout: 30000 }); };
  p.S = (fn, a) => p.evaluate(fn, a); await p.load(); await p.S(() => localStorage.clear()); await p.load(); return p;
}
const step = async (name, fn) => { await fn(); passed.push(name); };
const importJSON = async (p, name, obj) => { await p.setInputFiles('#bdOpen', { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) }); await p.waitForTimeout(1500); return p.S(() => document.getElementById('bdMsg').textContent); };
const pack = async (p, mode, pick) => { await p.S(m => __stages.openExport(m), mode); await p.waitForTimeout(1200); if (pick) { await p.S(() => { for (const i of document.querySelectorAll('#xOut .pick input')) i.click(); }); await p.waitForTimeout(1500); }
  const plan = await p.S(() => { const x = __stages.plan; return x && { files: x.files, n: x.included.length, error: x.error }; }); await p.S(() => document.getElementById('xDlg').close()); return plan; };

const p = await page();
await step('empty project: 50/10/10 placeholder cards, nothing exportable', async () => {
  for (const [k, n] of [['emergency', 50], ['road', 10], ['castle', 10]]) { await p.S(k => __stages.setKind(k, { mode: 'custom', board: true }), k); await p.waitForTimeout(500); assert.equal(await p.S(() => document.querySelectorAll('#slotGrid .slot.empty').length), n); }
  const plan = await pack(p, 'enabled'); assert.equal(plan.files, null); assert.ok(plan.error);
});
await step('template edit makes a custom copy; undo/redo; keyboard; map strip order', async () => {
  await p.S(() => __stages.setKind('emergency', { mode: 'game' })); await p.waitForTimeout(1500);
  const tplMaps = await p.S(() => __stages.tplOf('300301', 'emergency').maps.map(m => m.id));
  await p.S(() => { __stages.st.mk = 8; __stages.nudgeMarker(1, 0); }); await p.waitForTimeout(1500);
  assert.deepEqual(await p.S(() => [__stages.st.mode, __stages.st.key]), ['custom', 'slot-1']);
  assert.equal(await p.S(() => __stages.readStore().drafts['m300301']), undefined, 'the stock stage has no saved edit');
  assert.deepEqual(await p.S(() => __stages.st.draft.maps.map(m => String(m.donor))), tplMaps);
  assert.equal(await p.S(() => document.querySelectorAll('#mapTabs button').length), tplMaps.length);
  await p.click('#undoBtn'); await p.waitForTimeout(200); assert.equal(await p.S(() => __stages.gameCheck(__stages.st.draft, __stages.st.mission, true).moves), 0);
  await p.click('#redoBtn'); await p.waitForTimeout(200); assert.equal(await p.S(() => __stages.gameCheck(__stages.st.draft, __stages.st.mission, true).moves), 1);
  await p.click('#mkList button >> nth=1'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(700); assert.equal(await p.S(() => __stages.gameCheck(__stages.st.draft, __stages.st.mission, true).moves), 2);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200); assert.equal(await p.S(() => __stages.gameCheck(__stages.st.draft, __stages.st.mission, true).moves), 1);
  await p.locator('#cv').focus(); await p.keyboard.press(']'); assert.equal(await p.S(() => __stages.st.mapI), 1); await p.keyboard.press('['); assert.equal(await p.S(() => __stages.st.mapI), 0);
});
await step('mouse drag of a start spot, and a drag onto a wall is refused', async () => {
  await p.S(() => { document.getElementById('cv').scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(300);
  const pt = await p.S(() => { const cv = document.getElementById('cv'), r = cv.getBoundingClientRect(), m = __stages.st.draft.maps[0]; let at; m.chips.forEach((row, y) => row.forEach((c, x) => { if (c === 9) at = [x, y]; }));
    const k = Math.min(cv.width / 750, cv.height / 1050), ox = (cv.width - 750 * k) / 2, oy = (cv.height - 1050 * k) / 2, s = r.width / cv.width;
    const P = ([x, y]) => [r.left + (ox + x * 75 * k) * s, r.top + (oy + y * 105 * k) * s]; let wall; m.chips.forEach((row, y) => row.forEach((c, x) => { if (!wall && c === 0 && y > 0) wall = [x, y]; }));
    let free; m.chips.forEach((row, y) => row.forEach((c, x) => { if (!free && c === 1 && Math.abs(x - at[0]) + Math.abs(y - at[1]) > 2) free = [x, y]; })); return { from: P(at), to: P(free), wall: P(wall), free }; });
  const before = await p.S(() => JSON.stringify(__stages.st.draft.maps[0].chips));
  await p.mouse.move(...pt.from); await p.mouse.down(); await p.mouse.move(pt.wall[0], pt.wall[1], { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
  assert.equal(await p.S(() => JSON.stringify(__stages.st.draft.maps[0].chips)), before, 'a wall cell takes no marker');
  await p.mouse.move(...pt.from); await p.mouse.down(); await p.mouse.move(pt.to[0], pt.to[1], { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
  assert.equal(await p.S(f => __stages.st.draft.maps[0].chips[f[1]][f[0]], pt.free), 9);
});
await step('team sprites (No. 3, 5, 9) with slot numbers, stand-in sprites for enemies without their own art', async () => {
  await p.S(() => localStorage.clear()); await p.load(); await p.S(() => __stages.setKind('emergency', { mode: 'game' })); await p.waitForFunction(() => __stages.teamLoaded(), null, { timeout: 30000 });
  const own = await p.S(() => __stages.spriteOf('30030111')); assert.equal(own.standIn, true); assert.ok(own.donor && !['10015', '10024', '10045'].includes(own.donor));
  assert.deepEqual(await p.S(() => __stages.TEAM), ['10015', '10024', '10045']);
  await p.click('#standBtn'); assert.equal(await p.S(() => __stages.spriteOf('30030111').donor), null); await p.click('#standBtn');
});
await step('rewards and challenges: editable, validated, undoable, kept out of the game pack', async () => {
  await p.fill('#rwExp', '3000'); await p.press('#rwExp', 'Tab'); await p.waitForTimeout(1500);
  assert.equal(await p.S(() => __stages.st.key), 'slot-1', 'a stock template edit becomes a custom copy');
  await p.selectOption('#rwT0', 'turns'); await p.waitForTimeout(300); await p.fill('#rwV0', '0'); await p.press('#rwV0', 'Tab'); await p.waitForTimeout(300);
  assert.equal(await p.S(() => __stages.st.draft.rewards.challenges[0].value), 20, 'an out-of-range number is refused');
  await p.click('#rwBody .rwrow >> nth=0 >> text=Edit reward…'); await p.fill('#rwQ', 'haku'); await p.waitForTimeout(200); await p.click('#rwItems button >> nth=0'); await p.click('#rwSave'); await p.waitForTimeout(400);
  assert.equal(await p.S(() => __stages.st.draft.rewards.challenges[0].reward.filter(x => x.key === 'item').length), 1);
  const plan = await pack(p, 'enabled'); const spec = JSON.parse(plan.files['stages/01.json']); assert.equal(spec.rewards, undefined); assert.deepEqual(Object.keys(spec), ['format', 'schema', 'profile', 'localId', 'name', 'donorMissionId', 'enabled', 'maps']);
  for (let i = 0; i < 5; i++) await p.S(() => __stages.undoMain()); assert.equal(await p.S(() => __stages.st.draft.rewards), undefined);
  await p.S(() => __stages.setKind('castle', { mode: 'game' })); await p.waitForTimeout(800);
  await p.click('#cFloors .fwrap tbody tr >> nth=1 >> button'); await p.selectOption('#rwCur', 'coin'); await p.fill('#rwCurQ', '777'); await p.click('#rwCurAdd'); await p.click('#rwSave'); await p.waitForTimeout(1200);
  assert.deepEqual(await p.S(() => __stages.cs.rec.draft.rewards.floors['2'].find(x => x.key === 'coin')), { key: 'coin', qty: 777 });
  const cplan = await pack(p, 'enabled'); const cs = Object.values(cplan.files).map(v => JSON.parse(v)).find(x => x.profile === 'phantom-castle/1'); assert.ok(cs && !('rewards' in cs));
  await p.S(() => localStorage.clear()); await p.load();
});
await step('imports: all three modes, re-import updates, donor and mode restrictions', async () => {
  for (const f of ['emergency', 'road', 'castle']) assert.match(await importJSON(p, f + '.json', ex(f)), /Imported 1/);
  const r = ex('road'); assert.match(await importJSON(p, 'r.json', { ...r, name: 'Renamed' }), /Imported 1 definition into Ninja Road slot 1/);
  assert.match(await importJSON(p, 'r2.json', { ...r, donorMissionId: '80042', maps: [] }), /keeps a localId’s template/);
  assert.match(await importJSON(p, 'r3.json', { ...r, localId: 'test:other', donorMissionId: '300301' }), /Emergency template/);
  assert.match(await importJSON(p, 'c.json', { ...ex('castle'), localId: 'test:cx', rewardPvpId: '105' }), /floor progression/);
  assert.match(await importJSON(p, 'c2.json', { ...ex('castle'), localId: 'test:cy', pointScale: 10.5 }), /0\.1–10/);
  const ids = await p.S(() => { const s = __stages.readStore(); return [...Object.entries(s.drafts).filter(([k]) => /^(slot|road)-/.test(k)).map(([, d]) => d.localId), ...Object.values(s.castles || {}).map(r => r.spec.localId)]; });
  assert.equal(new Set(ids).size, ids.length, 'local IDs are distinct');
});
await step('one active Road and Castle; disabled exclusion; explicit disabled export', async () => {
  await p.S(() => __stages.setKind('road', { mode: 'custom', board: true })); await p.waitForTimeout(600);
  await p.click('#slotGrid .slot.empty button'); await p.waitForTimeout(300); await p.click('#tplList button >> nth=0'); await p.waitForTimeout(1500);
  assert.deepEqual(await p.S(() => { const d = __stages.readStore().drafts; return [d['road-1'].enabled, d['road-2'].enabled]; }), [true, false]);
  await p.click('#gOn'); await p.waitForTimeout(500);
  assert.deepEqual(await p.S(() => { const d = __stages.readStore().drafts; return [d['road-1'].enabled, d['road-2'].enabled]; }), [false, true]);
  const on = await pack(p, 'enabled'); const specs = Object.entries(on.files).filter(([k]) => k !== 'forge-mod.json').map(([, v]) => JSON.parse(v));
  assert.equal(specs.filter(s => s.profile === 'ninja-road-layout/1').length, 1); assert.ok(specs.every(s => s.enabled !== false));
  // export once so road-1 (now off) is a known import, then the disabled export carries it
  await p.S(() => __stages.openExport('enabled')); await p.waitForTimeout(1000); const dl = p.waitForEvent('download'); await p.click('#xSave'); await dl; await p.S(() => document.getElementById('xDlg').close());
  await p.S(() => __stages.setEnabledFor('road', __stages.readStore().drafts['road-1'].localId, true)); await p.waitForTimeout(200);
  const all = await pack(p, 'all'); const off = Object.entries(all.files).filter(([k]) => k !== 'forge-mod.json').map(([, v]) => JSON.parse(v)).filter(s => s.enabled === false);
  assert.ok(off.length >= 1 && off.some(s => s.profile === 'ninja-road-layout/1'), 'the switched-off Road goes as enabled:false');
  assert.deepEqual(Object.keys(all.files).sort()[0], 'forge-mod.json'); assert.ok(Object.keys(all.files).every(k => k === 'forge-mod.json' || /^stages\/\d\d\.json$/.test(k)));
});
await step('castle: point scale and reward preset, undo/redo, donor lock after export', async () => {
  await p.S(() => __stages.setKind('castle', { mode: 'custom', castle: 1 })); await p.waitForTimeout(800);
  await p.fill('#cScaleN', '2'); await p.press('#cScaleN', 'Enter'); await p.waitForTimeout(300);
  assert.equal(await p.S(() => __stages.cs.rec.spec.pointScale), 2);
  assert.equal(await p.S(() => document.querySelector('#cFloors tbody tr td.num b').textContent), '1,000');
  const last = await p.S(() => [...document.querySelectorAll('#cFloors .fwrap tbody tr')].pop().querySelector('td.num b').textContent); assert.equal(last, '0');
  await p.selectOption('#cPreset', { index: 2 }); await p.waitForTimeout(300); assert.ok(await p.S(() => __stages.cs.rec.spec.rewardPvpId));
  await p.click('#cUndo'); await p.waitForTimeout(200); assert.equal(await p.S(() => __stages.cs.rec.spec.rewardPvpId), undefined);
  await p.click('#cRedo'); await p.waitForTimeout(200); assert.ok(await p.S(() => __stages.cs.rec.spec.rewardPvpId));
  assert.equal(await p.S(() => document.getElementById('cBase').disabled), true, 'the base season is locked once exported');
});
await step('save/reopen: reload keeps everything; a saved project restores into a clean browser', async () => {
  const before = await p.S(() => JSON.stringify(__stages.readStore()));
  await p.load(); assert.equal(await p.S(() => JSON.stringify(__stages.readStore())), before);
  await p.S(() => __stages.setKind('emergency', { mode: 'custom', board: true })); await p.waitForTimeout(800);
  const dl = p.waitForEvent('download'); await p.click('#bdSave'); const d = await dl; const path = await d.path();
  await p.S(() => localStorage.clear()); await p.load();
  await p.setInputFiles('#bdOpen', { name: 'Forge-stages-project.zip', mimeType: 'application/zip', buffer: readFileSync(path) }); await p.waitForTimeout(2000);
  const s = await p.S(() => __stages.readStore()); const b0 = JSON.parse(before);
  for (const k of Object.keys(b0.drafts).filter(k => /^(slot|road)-/.test(k))) assert.deepEqual(s.drafts[k], b0.drafts[k]);
  assert.deepEqual(s.castles, b0.castles);
});
await step('20-slot projects from before v2.5.0 keep their slots and IDs', async () => {
  const d = await p.S(() => __stages.readStore().drafts['slot-1']);
  const ws = { format: 'ForgeStageWorkspace', schema: 1, slots: Array.from({ length: 20 }, (_, i) => ({ slot: i + 1, stageId: String(3800 + i), missionId: String(380001 + i * 100), stage: i === 19 ? { ...d, localId: 'forge-stages:old20', custom: { slot: 20, show: true } } : null })), drafts: {}, ids: {}, projects: [] };
  await p.S(() => localStorage.clear()); await p.load(); await importJSON(p, 'old.json', ws);
  const s = await p.S(() => __stages.readStore()); assert.equal(s.drafts['slot-20'].localId, 'forge-stages:old20');
  assert.equal(await p.S(() => __stages.slotList('emergency')[19].stageId), '3819'); assert.equal(await p.S(() => __stages.slotList('emergency')[20].stageId), '3823');
});
await step('full 50/10/10 and overflow', async () => {
  await p.S(() => localStorage.clear()); await p.load();
  const defs = [...Array.from({ length: 50 }, (_, i) => ({ ...ex('emergency'), localId: 'full:e' + i })), ...Array.from({ length: 10 }, (_, i) => ({ ...ex('road'), localId: 'full:r' + i, enabled: i === 0 })), ...Array.from({ length: 10 }, (_, i) => ({ ...ex('castle'), localId: 'full:c' + i, enabled: i === 0 }))];
  await p.S(async defs => { const enc = new TextEncoder(), files = [], list = defs.map((d, i) => { const n = 'stages/' + String(i + 1).padStart(2, '0') + '.json'; files.push({ name: n, data: enc.encode(JSON.stringify(d)) }); return n; });
    files.unshift({ name: 'forge-mod.json', data: enc.encode(JSON.stringify({ format: 'ForgeStagePack', schema: 1, stages: list })) }); await __stages.importFiles([new File([window.__forgeKit.zipBlob(files)], 'full.zip')]); }, defs);
  for (const [f, k] of [['emergency', 'over:e'], ['road', 'over:r'], ['castle', 'over:c']]) assert.match(await importJSON(p, f + '.json', { ...ex(f), localId: k }), /in use/);
  await p.S(() => __stages.openExport('all')); await p.waitForTimeout(3000); await p.S(() => { for (const i of document.querySelectorAll('#xOut .pick input')) i.click(); }); await p.waitForTimeout(3500);
  const plan = await p.S(() => __stages.plan); assert.equal(plan.included.length, 70); assert.equal(JSON.parse(plan.files['forge-mod.json']).stages.length, 70);
});
for (const w of [375, 390, 430]) await step(`no sideways scroll at ${w}px`, async () => {
  const m = await page({ width: w, height: 844 }, { isMobile: true, hasTouch: true });
  for (const f of ['emergency', 'road', 'castle']) await importJSON(m, f + '.json', ex(f));
  for (const go of [() => __stages.setKind('emergency', { mode: 'custom', board: true }), () => __stages.openSlot('slot-1'), () => __stages.setKind('road', { mode: 'game' }), () => __stages.setKind('castle', { mode: 'custom', castle: 1 }), () => __stages.setKind('castle', { mode: 'game' }), () => __stages.openExport('enabled')]) {
    await m.S(go); await m.waitForTimeout(1300); const [sw, cw] = await m.S(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(sw <= cw, `scrollWidth ${sw} > ${cw}`); }
  await m.context().close();
});
assert.deepEqual(errors, [], 'no page errors');
console.log(JSON.stringify({ passed: true, checks: passed.length, names: passed }, null, 1));
await b.close();
