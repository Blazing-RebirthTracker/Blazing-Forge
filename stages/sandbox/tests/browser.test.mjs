// Browser acceptance for the Kirito events workspace (website only; no phone playback or settlement).
// usage: serve the repo root (python3 -m http.server 8765), then
//   node stages/sandbox/tests/browser.test.mjs <package.zip> <extracted package folder> [http://127.0.0.1:8765]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
const [zipPath, dir, base = 'http://127.0.0.1:8765'] = process.argv.slice(2);
if (!zipPath || !dir) { console.log('usage: node browser.test.mjs <package.zip> <extracted folder> [base url]'); process.exit(2); }
const URL0 = base + '/stages/index.html?debug=1', original = readFileSync(join(dir, 'Kirito-Events.forge-stage-project.json'), 'utf8');
const done = [], errors = [];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message)); await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const S = (fn, a) => p.evaluate(fn, a);
const load = async (q = '') => { await p.goto(URL0 + q, { waitUntil: 'load' }); await p.waitForFunction(() => window.__stages && window.__stages.FM && document.getElementById('bdSub').textContent.length > 0, null, { timeout: 30000 }); await p.waitForTimeout(300); };
const wipe = async () => { await S(async () => { localStorage.clear(); for (const x of await ForgeSandboxUI.listProjects()) await ForgeSandboxUI.deleteProject(x.id); }); await load(); };
const step = async (name, fn) => { await fn(); done.push(name); };
const sb = () => S(() => { const s = ForgeSandboxUI._debug(); return { p: s.p, qi: s.qi, mi: s.mi, msg: document.getElementById('sxMsg').textContent, undo: s.undo.length }; });
const download = async click => { const d = p.waitForEvent('download'); await click(); const f = await d; return readFileSync(await f.path()); };
const unzip = buf => S(async a => { const files = await window.__forgeKit.unzip(new Uint8Array(a)); const o = {}; for (const [k, v] of Object.entries(files)) o[k] = k.endsWith('.json') || k.endsWith('.md') ? new TextDecoder().decode(v) : v.length; return o; }, [...buf]);
const quest = async i => { await p.click(`#sxQuests .qcard >> nth=${i}`); await p.waitForTimeout(300); };
const jump = async i => { await p.selectOption('#sxJump', String(i)); await p.waitForTimeout(300); };
const tab = async t => { await p.click(`#sxInsTabs [data-tab=${t}]`); await p.waitForTimeout(200); };
const selectFirstEnemy = async () => { await S(() => { const s = ForgeSandboxUI._debug(), A = ForgeSandboxUI.A, q = s.p.catalog.stages[s.qi]; const v = A.scene(s.p, q.spec.localId, q.donor.maps[s.mi].id, s.labels); s.sel = { kind: 'enemy', key: v.enemies[0].key }; }); await tab('sel'); };

await load(); await wipe();
await step('the tab stays hidden until an event project is in the browser', async () => {
  assert.equal(await S(() => document.getElementById('kindKirito').hidden), true);
  await load('&kirito'); assert.equal(await S(() => document.body.classList.contains('kirito-landing')), true);
});
await step('import the package through the Kirito events tab (ForgeStageSandbox, not the game importer)', async () => {
  await p.setInputFiles('#kiritoFile', zipPath);
  await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 600000 }); await p.waitForTimeout(800);
  const s = await sb(); assert.equal(s.p.projectId, 'kirito:events-v240'); assert.deepEqual(s.p.catalog.stages.map(x => x.donor.maps.length), [1, 3, 99]);
  assert.deepEqual(s.p.catalog.stages.map(x => x.slot.stageId + '/' + x.slot.missionId), ['3820/382001', '3821/382101', '3822/382201']);
  assert.equal(await S(() => Object.keys(__stages.readStore().drafts).length), 0, 'no custom slot was used');
  assert.equal(await S(() => document.getElementById('sxHandoff').textContent), 'Export Kirito project for developer');
  assert.equal(await S(() => document.getElementById('kindKirito').getAttribute('aria-pressed')), 'true');
});
await step('readable names, banners, previews and labeled missing previews', async () => {
  const cards = await S(() => [...document.querySelectorAll('#sxQuests .qcard')].map(c => [c.querySelector('b').textContent, !!c.querySelector('img')]));
  assert.equal(cards.length, 3); assert.ok(cards.every(([n, img]) => n && img));
  await quest(2); await jump(8); await selectFirstEnemy(); assert.match(await S(() => document.querySelector('#sxIns .ihead').textContent), /Orochimaru.*exact idle assets/);
  await quest(0); await selectFirstEnemy(); assert.match(await S(() => document.querySelector('#sxIns .ihead').textContent), /Sound Ninja.*placeholder/i);
});
await step('no-op save is byte-identical to the imported project', async () => {
  const buf = await download(() => p.click('#sxSave')); assert.equal(buf.toString('utf8'), original);
});
await step('edit through the page controls: marker, drop, lucky, challenge, coins/EXP, placement, stats, difficulty', async () => {
  // marker: start spot 1 one cell left (arrow key on the focused field)
  await quest(0); await S(() => { const s = ForgeSandboxUI._debug(); s.sel = { kind: 'marker', chip: 8 }; }); await p.locator('#sxCv').focus(); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300);
  let s = await sb(); assert.equal(s.p.catalog.stages[0].donor.maps[0].raw.map.lines[6].chips[2], 8);
  // normal drop chance and lucky quantity (Rewards tab)
  await tab('rewards'); const ch = await S(() => document.querySelector('#sxIns input[id^=nd][id$=_ch]').id);
  await p.fill('#' + ch, '250'); await p.click(`#sxIns .rcard:has(#${ch}) >> text=Apply`); await p.waitForTimeout(300);
  s = await sb(); assert.ok(s.p.catalog.stages[0].donor.serverMission.dropCandidates.every(c => c.chancePerThousand === 250));
  await quest(1); await tab('rewards'); await p.fill('#lk_q', '2'); await p.click('#sxIns section:has(#lk_q) >> text=Apply'); await p.waitForTimeout(300);
  s = await sb(); assert.equal(s.p.catalog.stages[1].donor.drops.lucky[0].num, 2);
  // challenge pearls and Ryo, then coins/EXP
  await p.fill('#ob1_j', '30'); await p.fill('#ob1_c', '1000'); await p.click('text=Apply pearls and Ryo >> nth=0'); await p.waitForTimeout(300);
  s = await sb(); const d1 = s.p.catalog.stages[1].donor; assert.deepEqual([d1.mission.missionInfo.subMission[0].subMissionReward.jewel, d1.mission.missionInfo.subMission[0].subMissionReward.coin], [30, 1000]); assert.deepEqual(d1.objective.objectives, d1.mission.missionInfo.subMission);
  await p.fill('#cx_exp', '5000'); await p.click('#sxIns section:has(#cx_exp) >> text=Apply'); await p.waitForTimeout(300);
  s = await sb(); assert.equal(s.p.catalog.stages[1].donor.serverMission.experience, 5000);
  // placement and stats on floor map 9 (the boss)
  await quest(2); await jump(8); await selectFirstEnemy(); const pre = await S(() => document.querySelector('#sxIns select[id$=_ro]').id.replace(/ro$/, ''));
  await p.selectOption('#' + pre + 'ro', '3'); await p.fill('#' + pre + 'ct', '2'); await p.click(`#sxIns section:has(#${pre}ct) >> text=Apply`); await p.waitForTimeout(300);
  s = await sb(); const t = s.p.catalog.stages[2].donor.maps[8].sets[0].raw.enemySet[0]; assert.deepEqual([t.type, t.count], [3, 2]);
  await selectFirstEnemy(); const hp = await S(() => document.querySelector('#sxIns input[id^=st][id$=_hp]').id); await p.fill('#' + hp, '77777'); await p.click('text=Apply stats'); await p.waitForTimeout(300);
  s = await sb(); const e = s.p.catalog.enemies.find(x => x.id === t.id); assert.deepEqual([e.hp.s, e.paramDatas[0].hp.s], [77777, 77777]);
  // invalid input is refused immediately and changes nothing
  const before = JSON.stringify((await sb()).p); await selectFirstEnemy(); await p.fill('#' + hp, '0'); await p.click('text=Apply stats'); await p.waitForTimeout(200);
  assert.equal(JSON.stringify((await sb()).p), before); assert.match((await sb()).msg, /HP/);
  // difficulty value and a stat multiplier over maps 10-18
  await tab('difficulty'); await p.fill('#df_v', '3'); await p.click('#sxIns section:has(#df_v) >> text=Apply'); await p.waitForTimeout(200);
  await p.fill('#dsc_a', '10'); await p.fill('#dsc_b', '18'); await p.fill('#dsc_f', '1.5'); await p.click('#sxIns button:text-is("Scale")'); await p.waitForTimeout(300);
  s = await sb(); assert.equal(s.p.catalog.stages[2].donor.serverMission.difficulty, 3);
  const id10 = s.p.catalog.stages[2].donor.maps[9].sets[0].raw.enemySet[0].id, orig = JSON.parse(original).catalog.enemies.find(x => x.id === id10);
  assert.equal(s.p.catalog.enemies.find(x => x.id === id10).hp.s, Math.round(orig.hp.s * 1.5));
  assert.deepEqual(s.p.catalog.stages[0].donor.firstClearGroup, JSON.parse(original).catalog.stages[0].donor.firstClearGroup, 'first clear stays read-only');
});
await step('undo and redo step through the edits', async () => {
  const end = JSON.stringify((await sb()).p); await p.click('#sxUndo'); await p.waitForTimeout(150); assert.notEqual(JSON.stringify((await sb()).p), end);
  await p.click('#sxRedo'); await p.waitForTimeout(150); assert.equal(JSON.stringify((await sb()).p), end);
});
let edited;
await step('reload keeps the edited project and reopens it', async () => {
  edited = (await sb()).p; await p.waitForTimeout(700); await load();
  await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 30000 }); assert.deepEqual((await sb()).p, edited);
});
let handoff;
await step('Save editable project and Export Kirito project for developer write the complete project', async () => {
  const saved = (await download(() => p.click('#sxSave'))).toString('utf8'); assert.deepEqual(JSON.parse(saved), edited); assert.ok(saved.includes('\r\n'), 'keeps the file’s line endings');
  handoff = await download(() => p.click('#sxHandoff')); const files = await unzip(handoff);
  assert.deepEqual(JSON.parse(files['Kirito-Events.forge-stage-project.json']), edited);
  for (const f of ['catalogs/rewards.json', 'catalogs/enemies.json', 'characters/index.json', 'backgrounds/index.json', 'assets/introduction-banner.png', 'integration/stage-sandbox.mjs', 'reference/released-catalog.json', 'handoff/CHANGES.json', 'handoff/README.md']) assert.ok(f in files, f);
  const ch = JSON.parse(files['handoff/CHANGES.json']); assert.ok(ch.count > 0); assert.match(files['handoff/README.md'], /3822, mission 382201/);
  assert.equal(await S(() => Object.keys(__stages.readStore().drafts).length), 0, 'still no custom slot used');
});
await step('reimport the developer export into a clean browser', async () => {
  await wipe(); await load('&kirito');
  await p.setInputFiles('#kiritoFile', { name: 'handoff.zip', mimeType: 'application/zip', buffer: handoff });
  await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 30000 }); await p.waitForTimeout(500);
  assert.deepEqual((await sb()).p, edited);
});
await step('the Emergency, Ninja Road and Phantom Castle tabs still work alongside', async () => {
  for (const k of ['emergency', 'road', 'castle']) { await p.click(`#kindSeg [data-kind=${k}]`); await p.waitForTimeout(800);
    assert.equal(await S(() => document.body.classList.contains('sbx-on')), false); assert.ok(await S(() => document.getElementById('bdSub').textContent.length > 0)); }
  await p.click('#kindSeg [data-kind=kirito]'); await p.waitForFunction(() => document.body.classList.contains('sbx-on'), null, { timeout: 30000 });
});
assert.deepEqual(errors, [], 'no page errors');
console.log(JSON.stringify({ passed: true, checks: done.length, names: done }, null, 1));
await b.close();
