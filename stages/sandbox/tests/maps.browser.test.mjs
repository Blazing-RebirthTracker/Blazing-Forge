// Browser acceptance for Kirito map editing (website only; no phone playback or settlement).
// usage: serve the repo root (python3 -m http.server 8765), then
//   node stages/sandbox/tests/maps.browser.test.mjs <folder with the core + part ZIPs> <extracted package folder> [http://127.0.0.1:8765]
// Imports the core ZIP and every asset part ZIP through the Kirito events tab, then: background change -> floor layout
// replacement with a wall marker placed by hand -> reorder (drag and keyboard) -> undo/redo -> save/reopen ->
// developer export -> reimport into a clean browser, checking the same enemies, drops and challenges stay attached.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright';
const [zipDir, dir, base = 'http://127.0.0.1:8765'] = process.argv.slice(2);
if (!zipDir || !dir) { console.log('usage: node maps.browser.test.mjs <zip folder> <extracted folder> [base url]'); process.exit(2); }
const zips = readdirSync(zipDir).filter(f => /\.zip$/i.test(f)).sort().map(f => join(zipDir, f));
assert.ok(zips.some(z => /core/i.test(z)) && zips.length > 1, 'the folder needs the core ZIP and its part ZIPs');
const URL0 = base + '/stages/index.html?debug=1', original = readFileSync(join(dir, 'Kirito-Events.forge-stage-project.json'), 'utf8');
const done = [], errors = [], t0 = Date.now();
const b = await chromium.launch();
const open = async () => { const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); return { ctx, p }; };
let { ctx, p } = await open();
const S = (fn, a) => p.evaluate(fn, a);
const load = async (q = '') => { await p.goto(URL0 + q, { waitUntil: 'load' }); await p.waitForFunction(() => window.__stages && window.__stages.FM && document.getElementById('bdSub').textContent.length > 0, null, { timeout: 30000 }); await p.waitForTimeout(300); };
const step = async (name, fn) => { const t = Date.now(); await fn(); done.push(`${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); console.log('ok -', name); };
const st = () => S(() => { const s = ForgeSandboxUI._debug(); return { p: s.p, qi: s.qi, mi: s.mi, msg: document.getElementById('sxMsg').textContent, undo: s.undo.length, redo: s.redo.length, draft: s.layoutDraft }; });
const download = async click => { const d = p.waitForEvent('download', { timeout: 120000 }); await click(); const f = await d; return readFileSync(await f.path()); };
const quest = async i => { await p.click(`#sxQuests .qcard >> nth=${i}`); await p.waitForTimeout(300); };
const jump = async i => { await p.selectOption('#sxJump', String(i)); await p.waitForTimeout(300); };
const tab = async t => { await p.click(`#sxInsTabs [data-tab=${t}]`); await p.waitForTimeout(200); };
const waitIdle = () => p.waitForFunction(() => { const b = document.getElementById('busy'); return !b || b.hidden || !b.textContent; }, null, { timeout: 15 * 60000, polling: 1000 });
// everything that must stay attached to a map, by map ID: its enemy sets (ids and stats), and the quest's drops, challenges and coin/EXP
const attached = (proj, qi) => { const q = proj.catalog.stages[qi], sm = q.donor.serverMission || {}; return { maps: Object.fromEntries(q.donor.maps.map(m => [m.id, JSON.stringify({ sets: m.sets, title: m.raw.title })])),
  drops: JSON.stringify(q.donor.drops), objectives: JSON.stringify([q.donor.objective, q.donor.firstClearGroup]),
  server: JSON.stringify([sm.dropCandidates, sm.experience, sm.characterExperience, sm.minimumCoin, sm.maximumCoin, sm.difficulty, sm.stamina]),
  serverMaps: Object.fromEntries((sm.maps || []).map(m => [String(m.mapId ?? m.id), JSON.stringify({ ...m, mapBackgroundId: undefined })])) }; };
const canvasPt = async ([x, y]) => S(([x, y]) => { const c = document.getElementById('sxCv'), r = c.getBoundingClientRect(), k = c.width / r.width; return [r.left + x / k, r.top + y / k]; }, [x, y]);
const drag = async (from, to) => { await p.mouse.move(from[0], from[1]); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8); await p.mouse.up(); await p.waitForTimeout(250); };

await load(); await S(async () => { localStorage.clear(); for (const x of await ForgeSandboxUI.listProjects()) await ForgeSandboxUI.deleteProject(x.id); }); await load('&kirito');
let before, after, Q = 2, F = 4, mapId, newBg, tid;

await step(`import the core and ${zips.length - 1} asset part ZIPs at once through the Kirito events tab`, async () => {
  await p.setInputFiles('#kiritoFile', zips);
  await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 15 * 60000, polling: 1000 });
  for (let i = 0; i < 500; i++) { const l = await S(async () => (await ForgeSandboxUI.listProjects()).map(x => [x.expected, x.missing])); if (l.length && l[0][0] && !l[0][1]) break; await p.waitForTimeout(3000); }
  await waitIdle(); await p.waitForTimeout(1500);
  const s = await st(); assert.equal(s.p.projectId, 'kirito:events-v240'); assert.equal(s.p.schema, 1); assert.equal(s.p.format, 'ForgeStageSandbox');
  assert.deepEqual(s.p.catalog.stages.map(x => x.donor.maps.length), [1, 3, 99]);
  assert.deepEqual(s.p.catalog.stages.map(x => x.slot.stageId + '/' + x.slot.missionId), ['3820/382001', '3821/382101', '3822/382201']);
  assert.equal(await S(() => Object.keys(__stages.readStore().drafts).length), 0, 'no Emergency slot was used');
  const list = await S(() => ForgeSandboxUI.listProjects()); const rec = list.find(x => x.id === s.p.projectId);
  assert.equal(rec.missing, 0, `every package file stored (${rec.files} of ${rec.expected})`);
  assert.equal(await S(() => !!ForgeSandboxUI._debug().maps && Object.keys(ForgeSandboxUI._debug().maps.definitions).length), 458);
  before = s.p;
});
await step('no-op save is byte-identical to the imported project', async () => { assert.equal((await download(() => p.click('#sxSave'))).toString('utf8'), original); });
await step('numbered floor strip: thumbnail, floor number, background name, enemy count, boss badge', async () => {
  await quest(Q); await jump(F); await p.waitForTimeout(600);
  const chips = await S(() => [...document.querySelectorAll('#sxStripIn .mchip.big')].map(c => ({ t: c.textContent, img: c.querySelector('img.th') && c.querySelector('img.th').src.slice(0, 10), hdl: !!c.querySelector('.hdl'), i: +c.dataset.i })));
  assert.ok(chips.length >= 5); const c = chips.find(x => x.i === F); assert.match(c.t, new RegExp(`Floor ${F + 1}`)); assert.match(c.t, /enem/); assert.ok(c.hdl); assert.equal(c.img, 'data:image');
  const bosses = (await st()).p.catalog.stages[Q].donor.maps.map((m, i) => m.sets.some(s => s.raw.enemySet.some(e => e.type === 2)) ? i : -1).filter(i => i >= 0);
  const vis = chips.filter(x => bosses.includes(x.i)); for (const v of vis) assert.match(v.t, /Boss/);
  assert.match(await S(() => document.querySelector('#sxCv + .tag').textContent), /Layout preview.*Logical field 750×1050 · camera uncalibrated/);
});
await step('change the background through the Map tab picker (exact definition, base texture, animated parts)', async () => {
  const s = await st(); mapId = s.p.catalog.stages[Q].donor.maps[F].id; const cur = String(s.p.catalog.stages[Q].donor.maps[F].raw.mapBgId);
  newBg = await S(cur => { const A = ForgeSandboxUI.A; return Object.keys(ForgeSandboxUI._debug().maps.definitions).find(id => id !== cur && !A.backgroundInfo(id).needs.length && A.backgroundInfo(id).animated > 0); }, cur);
  await tab('map'); assert.match(await S(() => document.getElementById('sxIns').textContent), new RegExp(`Floor ${F + 1} of 99`));
  await p.click('#sxIns >> text=Change background…'); await p.waitForSelector('#mbDlg[open]');
  const dev = await S(() => { document.querySelector('#mbFilter [data-f=dev]').click(); return [...document.querySelectorAll('#mbList button')].length; }); assert.ok(dev > 0, 'gimmick backgrounds are listed separately');
  await S(() => document.querySelector('#mbFilter [data-f=ok]').click());
  await p.fill('#mbQ', newBg); await p.waitForTimeout(200); await p.click(`#mbList button:has-text("${newBg}")`); await p.waitForTimeout(2500);
  const det = await S(() => ({ t: document.getElementById('mbDetail').textContent, img: (document.querySelector('#mbDetail img.big') || {}).src || '', canvas: !!document.querySelector('#mbDetail canvas') }));
  assert.match(det.t, /not a composed in-game screenshot/); assert.ok(det.img.startsWith('data:image') || det.img.startsWith('blob:'), 'base texture shown'); assert.ok(det.canvas);
  assert.ok(!/couldn’t be played|aren’t stored/.test(det.t), 'animated part plays: ' + det.t.slice(0, 300));
  await p.click(`#mbDetail >> text=Use on floor ${F + 1}`); await p.waitForTimeout(400);
  const n = await st(), m = n.p.catalog.stages[Q].donor.maps[F]; assert.equal(m.id, mapId); assert.equal(String(m.raw.mapBgId), newBg);
  assert.deepEqual(attached(n.p, Q), attached(before, Q), 'enemies, drops and challenges unchanged');
  await S(() => ForgeSandboxUI.A.validateMaps(ForgeSandboxUI._debug().p));
  assert.match(await S(() => document.getElementById('sxBgNote').textContent), /base texture, fitted to the field/);
});
await step('replace the floor layout: preview, place a wall marker on a free floor tile by hand, apply', async () => {
  const s = await st();
  tid = await S(([qi, mid]) => { const A = ForgeSandboxUI.A, sb = ForgeSandboxUI._debug(), lid = sb.p.catalog.stages[qi].spec.localId;
    return Object.values(sb.maps.templates).filter(t => A.templateSupported(t)).map(t => [t.id, A.layoutCheck(sb.p, lid, mid, t.id).conflicts]).filter(([, c]) => c >= 1 && c <= 3).map(x => x[0])[0]; }, [Q, mapId]);
  assert.ok(tid, 'a layout that puts a marker in a wall');
  await p.click('#sxIns >> text=Change floor layout…'); await p.waitForSelector('#mlDlg[open]'); assert.match(await S(() => document.getElementById('mlSpecial').textContent), /developer integration/);
  await p.fill('#mlQ', tid); await p.waitForTimeout(300); await p.click(`#mlList button:has-text("Layout ${tid}")`); await p.waitForTimeout(500);
  assert.equal((await st()).draft.tid, tid); assert.equal(await S(() => document.getElementById('sxLayoutApply').disabled), true, 'apply blocked while a marker sits in a wall');
  // drag the first red marker onto the nearest free floor tile
  const chk = await S(([qi, mid, tid]) => { const A = ForgeSandboxUI.A, sb = ForgeSandboxUI._debug(); const c = A.layoutCheck(sb.p, sb.p.catalog.stages[qi].spec.localId, mid, tid); return { c, sug: A.suggestPlacements(c) }; }, [Q, mapId, tid]);
  const bad = chk.c.markers.find(m => !m.ok), target = chk.sug[bad.chip]; const h = (await S(() => ForgeSandboxUI._hits())).find(x => x.kind === 'draft' && x.chip === bad.chip);
  await drag(await canvasPt([h.x, h.y]), await canvasPt(await S(([x, y]) => ForgeSandboxUI._cell(x, y), target)));
  const d1 = (await st()).draft; assert.deepEqual(d1.place[bad.chip], target, 'marker placed where it was dropped');
  // the keyboard moves the selected draft marker too (and back)
  await p.locator('#sxCv').focus(); const kx = target[0] > 0 ? 'ArrowLeft' : 'ArrowRight', back = kx === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  await p.keyboard.press(kx); await p.keyboard.press(back); assert.deepEqual((await st()).draft.place[bad.chip], target);
  if (chk.c.conflicts > 1) { await p.click('#sxLayoutSuggest'); await p.waitForTimeout(200); }
  assert.equal(await S(() => document.getElementById('sxLayoutApply').disabled), false);
  const place = (await st()).draft.place; await p.click('#sxLayoutApply'); await p.waitForTimeout(400);
  const n = await st(), m = n.p.catalog.stages[Q].donor.maps[F]; assert.equal(n.draft, null); assert.equal(m.id, mapId); assert.equal(String(m.raw.mapBgId), newBg, 'background kept');
  const expect = await S(([qi, mid, tid, place]) => { const A = ForgeSandboxUI.A, sb = ForgeSandboxUI._debug(); return A.layoutCheck(sb.undo[sb.undo.length - 1].p, sb.p.catalog.stages[qi].spec.localId, mid, tid, place); }, [Q, mapId, tid, place]);
  for (const mk of expect.markers) assert.equal(m.raw.map.lines[mk.at[1]].chips[mk.at[0]], mk.chip, `marker ${mk.chip} at ${mk.at}`);
  for (const [y, l] of expect.lines.entries()) for (const [x, c] of l.chips.entries()) if (!expect.markers.some(mk => mk.at[0] === x && mk.at[1] === y)) assert.equal(m.raw.map.lines[y].chips[x], c, `grid ${x},${y}`);
  assert.deepEqual(attached(n.p, Q), attached(before, Q), 'enemies, stats, drops and challenges unchanged');
  await S(() => ForgeSandboxUI.A.validateMaps(ForgeSandboxUI._debug().p));
});
await step('reorder floors: drag a handle in the strip, then Alt+→ on a chip; bosses stay with their maps', async () => {
  await quest(1); await tab('map'); const s0 = await st(), ids0 = s0.p.catalog.stages[1].donor.maps.map(m => m.id);
  const hs = await S(() => [...document.querySelectorAll('#sxStripIn .mchip.big .hdl')].map(h => { const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  const strip = await S(() => { const r = document.getElementById('sxStripIn').getBoundingClientRect(); return [r.left, r.top + r.height / 2]; });
  await drag(hs[0], [strip[0] + 3 * 154 - 4, strip[1]]); // past the last of 3 floors
  let ids = (await st()).p.catalog.stages[1].donor.maps.map(m => m.id); assert.deepEqual(ids, [ids0[1], ids0[2], ids0[0]]);
  assert.match((await st()).msg, /enemies, drops and rewards went with it/);
  await quest(Q); await jump(10); await p.locator(`#sxStripIn .mchip[data-i="10"]`).focus(); await p.keyboard.press('Alt+ArrowRight'); await p.waitForTimeout(300);
  const s = await st(), a0 = before.catalog.stages[Q].donor.maps.map(m => m.id), a1 = s.p.catalog.stages[Q].donor.maps.map(m => m.id);
  assert.equal(a1.length, 99); assert.equal(a1[11], a0[10]); assert.equal(a1[10], a0[11]); assert.equal(s.mi, 11);
  const bossIds = pr => pr.catalog.stages[Q].donor.maps.filter(m => m.sets.some(t => t.raw.enemySet.some(e => e.type === 2))).map(m => m.id).sort();
  assert.deepEqual(bossIds(s.p), bossIds(before), 'boss flags stay with their maps');
  assert.deepEqual(attached(s.p, 1), attached(before, 1)); assert.deepEqual(attached(s.p, Q), attached(before, Q));
  await S(() => ForgeSandboxUI.A.validateMaps(ForgeSandboxUI._debug().p));
  after = s.p;
});
await step('undo everything back to the import, then redo everything', async () => {
  const n = (await st()).undo; for (let i = 0; i < n; i++) await p.click('#sxUndo'); await p.waitForTimeout(300);
  assert.deepEqual((await st()).p, before); assert.equal((await download(() => p.click('#sxSave'))).toString('utf8'), original, 'undone save is byte-identical');
  for (let i = 0; i < n; i++) await p.click('#sxRedo'); await p.waitForTimeout(300); assert.deepEqual((await st()).p, after);
});
await step('save, reload the page, and the edits reopen', async () => {
  await S(() => new Promise(r => setTimeout(r, 900))); await load(); await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 30000 }); await p.waitForTimeout(800);
  assert.deepEqual((await st()).p, after);
});
let exported, exportedProject;
await step('export the Kirito project for developer: edited project, map report and exactly the used background assets', async () => {
  exported = await download(() => p.click('#sxHandoff'));
  const zf = join(tmpdir(), 'kirito-handoff-test.zip'); writeFileSync(zf, exported); const z = {};
  for (const k of execFileSync('unzip', ['-Z1', zf], { maxBuffer: 1 << 26 }).toString().split('\n').filter(Boolean)) z[k] = /\.(json|md)$/.test(k) && !/^(backgrounds|animation)\//.test(k) ? execFileSync('unzip', ['-p', zf, k], { maxBuffer: 1 << 28 }).toString('utf8') : 1;
  exportedProject = z['Kirito-Events.forge-stage-project.json']; assert.ok(exportedProject); assert.deepEqual(JSON.parse(exportedProject), after);
  const maps = JSON.parse(z['handoff/MAPS.json']); assert.deepEqual(maps.newBackgrounds.includes(newBg), true); assert.equal(maps.missingAssetFiles.length, 0);
  const q = maps.quests[Q], f = q.changedFloors.find(r => r.mapId === mapId); assert.equal(f.background, newBg); assert.equal(f.floorGridChanged, true);
  assert.equal(maps.geometry.camera, 'uncalibrated');
  assert.ok(z[`backgrounds/definitions/${newBg}.json`]); assert.ok(Object.keys(z).some(k => k.startsWith('backgrounds/textures/')));
  assert.ok(Object.keys(z).filter(k => k.startsWith('backgrounds/definitions/')).length < 100, 'not the whole library');
  assert.ok(z['catalogs/map-library.json'] && z['integration/stage-map-authoring.mjs'] && z['handoff/CHANGES.json']);
  assert.match(z['handoff/README.md'], /## Map changes/); assert.ok(!z['forge-mod.json'] && !Object.keys(z).some(k => k.startsWith('stages/')), 'not a phone install pack');
  console.log(`  export: ${Object.keys(z).length} files, ${(exported.length / 1048576).toFixed(1)} MB`);
});
await step('reimport the export into a clean browser: same project, same attached enemies, drops and challenges, map library ready', async () => {
  await ctx.close(); ({ ctx, p } = await open()); await load('&kirito');
  await p.setInputFiles('#kiritoFile', { name: 'kirito-developer-handoff.zip', mimeType: 'application/zip', buffer: exported });
  await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 5 * 60000 }); await waitIdle(); await p.waitForTimeout(800);
  const s = await st(); assert.deepEqual(s.p, after); for (const qi of [0, 1, 2]) assert.deepEqual(attached(s.p, qi), attached(before, qi));
  assert.equal(await S(() => Object.keys(ForgeSandboxUI._debug().maps.definitions).length), 458);
  assert.equal((await download(() => p.click('#sxSave'))).toString('utf8'), exportedProject, 'reimported save is byte-identical to the export');
  await quest(Q); await jump(F); await tab('map'); await p.waitForTimeout(800);
  assert.match(await S(() => (document.querySelector('#sxIns img.mapgrid') || {}).src || ''), /^data:image/, 'the new background picture travels with the export');
  // reset this map returns it to the released baseline
  await p.click('#sxReset'); await p.waitForTimeout(400); const r = await st();
  assert.equal(JSON.stringify(r.p.catalog.stages[Q].donor.maps[F].raw.map), JSON.stringify(before.catalog.stages[Q].donor.maps.find(m => m.id === r.p.catalog.stages[Q].donor.maps[F].id).raw.map));
});
await step('other workspaces still open: Emergency, Ninja Road, Phantom Castle', async () => {
  await S(() => ForgeSandboxUI.close()); await load();
  for (const m of ['emergency', 'road', 'castle']) { const b = await p.$(`#modeSeg [data-mode=${m}]`); if (b) { await b.click(); await p.waitForTimeout(400); } }
});
for (const w of [375, 390, 430]) await step(`phone width ${w}: strip, Map tab and pickers fit without sideways scroll`, async () => {
  await p.setViewportSize({ width: w, height: 860 }); await load(); await S(async () => { const l = await ForgeSandboxUI.listProjects(); await ForgeSandboxUI.openProject(l[0].id); }); await p.waitForTimeout(800);
  await quest(Q); await tab('map'); await p.waitForTimeout(300);
  assert.ok(await S(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow');
  await p.click('#sxIns >> text=Change floor layout…'); await p.waitForSelector('#mlDlg[open]');
  assert.ok(await S(() => document.getElementById('mlDlg').getBoundingClientRect().right <= innerWidth + 1)); await p.click('#mlClose');
  await p.click('#sxIns >> text=Change background…'); await p.waitForSelector('#mbDlg[open]');
  assert.ok(await S(() => document.getElementById('mbDlg').getBoundingClientRect().right <= innerWidth + 1)); await p.click('#mbClose');
});
await b.close();
console.log(JSON.stringify({ passed: !errors.length, seconds: Math.round((Date.now() - t0) / 1000), steps: done, pageErrors: errors }, null, 1));
if (errors.length) process.exit(1);
