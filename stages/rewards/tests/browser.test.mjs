// Browser checks for stage rewards and banners in custom slots (website only; no phone playback or payout).
// Serve the repo root (python3 -m http.server 8765), then: node stages/rewards/tests/browser.test.mjs [http://127.0.0.1:8765]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import * as R from '../stage-rewards.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765') + '/stages/index.html?debug=1';
const ROOT = new URL('../../../', import.meta.url).pathname;
const cat = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'stages/v250/authoring-catalog.json.gz'))));
const items = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(ROOT, 'tools/data/item-catalog.json'))).items).map(([k, v]) => [k, { bonus: v.b || [0, 0, 0, 0], type3: v.k || 0 }]));
const sha = b => createHash('sha256').update(b).digest('hex');
const passed = [], errors = [], TMP = mkdtempSync(join(tmpdir(), 'bf-rewards-'));
const b = await chromium.launch();
async function page(viewport = { width: 1280, height: 900 }) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true }); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  p.load = async () => { await p.goto(BASE, { waitUntil: 'load' }); await p.waitForFunction(() => window.__stages && window.__stages.FM && window.__stages.RW && document.getElementById('bdSub').textContent.length > 0, null, { timeout: 30000 }); };
  p.S = (fn, a) => p.evaluate(fn, a); await p.load(); await p.S(() => localStorage.clear()); await p.load(); p.ctx = ctx; return p;
}
const step = async (name, fn) => { await fn(); passed.push(name); console.log('ok -', name); };
const download = async (p, click) => { const d = p.waitForEvent('download', { timeout: 60000 }); await click(); const f = await d; return readFileSync(await f.path()); };
const unzipList = buf => { const f = join(TMP, 'x' + Math.random().toString(36).slice(2) + '.zip'); writeFileSync(f, buf); return { f, names: execFileSync('unzip', ['-Z1', f]).toString().split('\n').filter(Boolean) }; };
const member = (f, n) => execFileSync('unzip', ['-p', f, n], { maxBuffer: 1 << 26 });
const openExport = async (p, full) => { await p.S(() => __stages.openExport('enabled')); await p.waitForTimeout(800); if ((await p.S(() => document.getElementById('xFull').checked)) !== full) { await p.click('#xFull'); await p.waitForTimeout(1200); } };

// a 1200×900 photo-like picture to fit into the 680×320 banner
const big = await (async () => { const p0 = await page(); const data = await p0.S(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1200, 900); gr.addColorStop(0, '#2a1c55'); gr.addColorStop(1, '#ff7a3d'); g.fillStyle = gr; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText('TEST', 420, 500); return c.toDataURL('image/jpeg', 0.9); }); await p0.ctx.close(); return Buffer.from(data.split(',')[1], 'base64'); })();

const p = await page();
let draftRewards, bannerSha;
await step('speed pills: findable as "speed pill" / "pill", with their art and +Speed bonus, and addable to a challenge reward', async () => {
  await p.S(() => __stages.setKind('emergency', { mode: 'game' })); await p.waitForTimeout(1500);
  await p.fill('#rwExp', '3000'); await p.press('#rwExp', 'Tab'); await p.waitForTimeout(1500);
  assert.equal(await p.S(() => __stages.st.key), 'slot-1');
  await p.click('#rwBody .rwrow >> nth=0 >> text=Edit reward…'); await p.fill('#rwQ', 'speed pill'); await p.waitForTimeout(300);
  const hits = await p.S(() => [...document.querySelectorAll('#rwItems button')].map(b => b.innerText.replace(/\s+/g, ' ')));
  assert.equal(hits.length, 2, hits.join(' | ')); assert.ok(hits.some(h => /Large Sprint Sphere/.test(h) && /\+2 Speed/.test(h) && /Speed pill/.test(h)));
  await p.fill('#rwQ', 'pill'); await p.waitForTimeout(300); assert.equal(await p.S(() => document.querySelectorAll('#rwItems button').length), 6, 'HP, ATK and Speed pills, two sizes each');
  await p.fill('#rwQ', '13683'); await p.waitForTimeout(800);
  assert.equal(await p.S(() => document.querySelector('#rwItems canvas.rt').dataset.painted), '1', 'card art drawn for the large speed pill');
  await p.click('#rwItems button >> nth=0'); await p.click('#rwSave'); await p.waitForTimeout(500);
  const r = await p.S(() => __stages.st.draft.rewards.challenges[0].reward); assert.ok(r.some(x => x.key === 'item' && x.unitId === '13683'));
  assert.match(await p.S(() => document.querySelector('#rwBody .rwrow').innerText), /\+2 Speed/);
  // the lucky reward as a single pick
  await p.click('#rwBody >> text=Lucky reward >> xpath=.. >> text=Change item…'); await p.fill('#rwQ', 'speed pill'); await p.waitForTimeout(300);
  await p.click('#rwItems button:has-text("Sprint Sphere") >> nth=0'); await p.waitForTimeout(500);
  assert.equal(await p.S(() => __stages.st.draft.rewards.lucky.unitId), '13682');
});
await step('banner: upload a picture, fit it (zoom, drag, arrow keys), save as a 680×320 PNG; undo and redo', async () => {
  await p.setInputFiles('#bnFile', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: big }); await p.waitForTimeout(800);
  assert.ok(await p.S(() => !!document.querySelector('#bnBody canvas.bncv')));
  assert.match(await p.S(() => document.getElementById('bnBody').innerText), /Whole picture[\s\S]*1200×900[\s\S]*becomes the 680×320 banner/i, 'the crop is shown on the whole picture');
  assert.match(await p.S(() => document.querySelector('#bnBody .bntag').textContent), /680×320/);
  await p.S(() => { const z = document.getElementById('bnZoom'); z.value = '1.6'; z.dispatchEvent(new Event('input')); });
  const r = await p.S(() => { const c = document.querySelector('#bnBody canvas.bncv'); c.scrollIntoView({ block: 'center' }); const b = c.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  await p.mouse.move(...r); await p.mouse.down(); await p.mouse.move(r[0] + 60, r[1] + 20, { steps: 6 }); await p.mouse.up();
  await p.focus('#bnBody canvas.bncv'); await p.keyboard.press('ArrowLeft');
  await p.click('#bnBody >> text=Use this banner'); await p.waitForFunction(() => __stages.st.draft.banner, null, { timeout: 10000 });
  const bn = await p.S(() => __stages.st.draft.banner); assert.equal(bn.width, 680); assert.equal(bn.height, 320); assert.match(bn.sha256, /^[0-9a-f]{64}$/); bannerSha = bn.sha256;
  const bytes = Buffer.from(await p.S(async s => [...new Uint8Array(await (await __stages.getBanner(s)).arrayBuffer())], bn.sha256)); assert.equal(sha(bytes), bn.sha256); assert.deepEqual(R.pngSize(bytes), { width: 680, height: 320 });
  await p.waitForTimeout(300); assert.ok(await p.S(() => (document.querySelector('#bnBody img.bnimg') || {}).src?.startsWith('blob:')));
  await p.S(() => __stages.undoMain()); await p.waitForTimeout(300); assert.equal(await p.S(() => __stages.st.draft.banner), undefined);
  await p.S(() => __stages.redoMain()); await p.waitForTimeout(300); assert.equal(await p.S(() => __stages.st.draft.banner.sha256), bannerSha);
  draftRewards = await p.S(() => __stages.st.draft.rewards);
});
await step('castle: a floor reward of speed pills', async () => {
  await p.S(() => __stages.setKind('castle', { mode: 'game' })); await p.waitForTimeout(800);
  await p.click('#cFloors .fwrap tbody tr >> nth=1 >> button'); await p.fill('#rwQ', 'speed pill'); await p.waitForTimeout(300); await p.click('#rwItems button:has-text("Large Sprint Sphere")'); await p.click('#rwSave'); await p.waitForTimeout(1200);
  assert.ok(await p.S(() => __stages.cs.rec.draft.rewards.floors['2'].some(x => x.unitId === '13683')));
});
await step('enemy drops: item and chance changed in the editor; the 3-item limit is counted, warned and blocks the export until fixed', async () => {
  await p.S(() => __stages.setKind('emergency', { mode: 'custom', board: true })); await p.waitForTimeout(600);
  await p.S(() => __stages.createSlot(2, '300302')); await p.waitForTimeout(800); await p.S(() => __stages.openSlot('slot-2')); await p.waitForTimeout(1500);
  const row = id => `#rwBody .rwrow:has-text("id ${id}")`;
  await p.click('#mapTabs button >> nth=1'); await p.waitForTimeout(600);
  await p.click(`${row(30030211)} >> text=Change item…`); await p.fill('#rwQ', 'speed pill'); await p.waitForTimeout(300); await p.click('#rwItems button:has-text("Large Sprint Sphere")'); await p.waitForTimeout(600);
  await p.fill('#rwD30030211', '300'); await p.press('#rwD30030211', 'Tab'); await p.waitForTimeout(600);
  assert.deepEqual(await p.S(() => __stages.st.draft.rewards.drops['30030211']), { item: '13683', chance: 300, varies: false });
  assert.match(await p.S(() => document.querySelector('#rwBody .hint.bad').textContent), /now drops 4 different items/);
  assert.match(await p.S(() => document.getElementById('gameIssues').innerText), /at most 3 per mission/);
  await openExport(p, true); assert.match(await p.S(() => document.getElementById('xIn').innerText), /Can’t add your reward and challenge edits: Edited drops support at most three distinct normal items/);
  await p.click('#xSave'); await p.waitForTimeout(800); assert.match(await p.S(() => document.getElementById('xMsg').textContent), /at most three/); await p.S(() => document.getElementById('xDlg').close());
  await p.click('#mapTabs button >> nth=0'); await p.waitForTimeout(600);
  await p.click(`${row(30030212)} >> text=Change item…`); await p.fill('#rwQ', '13683'); await p.waitForTimeout(300); await p.click('#rwItems button >> nth=0'); await p.waitForTimeout(600);
  assert.equal(await p.S(() => document.querySelector('#rwBody .hint.bad')), null); assert.match(await p.S(() => document.getElementById('rwBody').innerText), /Different drop items in this mission: 3 of 3/);
  await openExport(p, true); const plan = await p.S(() => __stages.plan.full && Object.values(__stages.plan.full.files));
  const def = plan.map(t => JSON.parse(t)).find(d => d.donorMissionId === '300302'); assert.equal(def.schema, 3); R.validateDefinition(cat, def, items);
  assert.deepEqual(def.rewards.drops['30030211'], { item: { id: '13683', level: 1, plus: { hp: 0, atk: 0, def: 0, speed: 2 } }, chancePerThousand: 300 });
  const o = R.compileStage(cat, def, items, R.standardAlloc('emergency', 2)); assert.deepEqual(o.server.drops.normalUnits.sort(), [11074, 11822, 13683]);
  await p.S(() => document.getElementById('xDlg').close());
});
await step('Ninja Road: a map clear reward and the Road clear reward edited in the editor', async () => {
  await p.S(() => __stages.setKind('road', { mode: 'custom', board: true })); await p.waitForTimeout(600);
  await p.S(() => __stages.createSlot(1, '80043')); await p.waitForTimeout(800); await p.S(() => __stages.openSlot('road-1')); await p.waitForTimeout(1500);
  await p.click('#rwBody .rwrow:has-text("map 8043015") >> button'); await p.fill('#rwQ', 'speed pill'); await p.waitForTimeout(300); await p.click('#rwItems button:has-text("Large Sprint Sphere")'); await p.click('#rwSave'); await p.waitForTimeout(500);
  await p.click('#rwBody >> text=Road clear reward >> xpath=.. >> text=Edit reward…'); await p.selectOption('#rwCur', 'jewel'); await p.fill('#rwCurQ', '25'); await p.click('#rwCurAdd'); await p.click('#rwSave'); await p.waitForTimeout(500);
  const r = await p.S(() => __stages.st.draft.rewards); assert.ok(r.mapClear['8043015'].some(x => x.unitId === '13683')); assert.ok(r.roadClear.some(x => x.key === 'jewel' && x.qty === 25));
});
await step('disabled stages: switched off they stay out of the pack but keep their rewards; switched back on they return', async () => {
  const lid = await p.S(() => __stages.readStore().drafts['slot-2'].localId);
  await p.S(l => __stages.setEnabledFor('emergency', l, false), lid); await openExport(p, true);
  let defs = await p.S(() => Object.entries(__stages.plan.full.files).filter(([n]) => n !== 'forge-mod.json').map(([, t]) => JSON.parse(t)));
  assert.ok(!defs.some(d => d.localId === lid), 'switched-off stage left out'); assert.ok(defs.some(d => d.donorMissionId === '300301') && defs.some(d => d.profile === 'ninja-road/2'));
  assert.equal(await p.S(() => __stages.readStore().drafts['slot-2'].rewards.drops['30030211'].item), '13683', 'its edits are kept'); await p.S(() => document.getElementById('xDlg').close());
  await p.S(l => __stages.setEnabledFor('emergency', l, true), lid); await openExport(p, true);
  defs = await p.S(() => Object.entries(__stages.plan.full.files).filter(([n]) => n !== 'forge-mod.json').map(([, t]) => JSON.parse(t)));
  assert.equal(defs.find(d => d.localId === lid).rewards.drops['30030211'].chancePerThousand, 300); await p.S(() => document.getElementById('xDlg').close());
});
await step('export with Rewards and banners off: the pack is exactly the layout-only pack older apps take', async () => {
  await openExport(p, false);
  const plan = await p.S(() => ({ files: __stages.plan.files, full: !!__stages.plan.full }));
  assert.equal(plan.full, false); assert.equal(JSON.parse(plan.files['forge-mod.json']).schema, 1);
  for (const [n, t] of Object.entries(plan.files)) if (n !== 'forge-mod.json') { const j = JSON.parse(t); assert.ok(!('rewards' in j) && !('banner' in j)); assert.ok(j.schema === 2 || (j.format === 'ForgeCastle' && j.schema === 1)); }
  assert.match(await p.S(() => document.getElementById('xIn').innerText), /Turn on Rewards and banners/);
  await p.S(() => document.getElementById('xDlg').close());
});
let packBuf;
await step('export with Rewards and banners on: schema 3 / castle schema 2 with their banner, validated, saved as a ZIP', async () => {
  await openExport(p, true);
  assert.match(await p.S(() => document.getElementById('xIn').innerText), /go in this pack/);
  packBuf = await download(p, () => p.click('#xSave')); await p.S(() => document.getElementById('xDlg').close());
  const { f, names } = unzipList(packBuf); const man = JSON.parse(member(f, 'forge-mod.json'));
  assert.equal(man.schema, 2); assert.equal(man.banners.length, 1); assert.deepEqual(names.sort(), ['forge-mod.json', ...man.stages, ...man.banners].sort());
  const defs = man.stages.map(n => JSON.parse(member(f, n))); R.validatePack(names, man, defs);
  const em = defs.find(d => d.profile === 'emergency/2' && d.donorMissionId === '300301'), ca = defs.find(d => d.profile === 'phantom-castle/2');
  assert.ok(defs.some(d => d.profile === 'ninja-road/2' && d.rewards.roadClear.pearls === 25));
  assert.ok(em && ca); assert.equal(em.schema, 3); assert.equal(ca.schema, 2); R.validateDefinition(cat, em, items); R.validateDefinition(cat, ca, items);
  assert.equal(em.rewards.playerExp, 3000); assert.equal(em.rewards.lucky.id, '13682'); assert.equal(em.rewards.lucky.plus.speed, 1); assert.ok(em.rewards.challenges[0].reward.items.some(i => i.id === '13683' && i.plus.speed === 2));
  const png = member(f, em.banner.file); assert.equal(sha(png), em.banner.sha256); assert.equal(em.banner.sha256, bannerSha);
  assert.deepEqual(ca.rewards.floors['2'].items.map(i => [i.id, i.plus.speed]), [['13683', 2]]);
  const c1 = R.compileStage(cat, em, items, R.standardAlloc('emergency', 1)); assert.equal(c1.server.drops.lucky[0].plus_sp, 1); assert.equal(c1.banner.imageId, 3800);
  const c2 = R.compileCastle(cat, ca, items, R.standardAlloc('castle', 1)); assert.deepEqual(c2.server.floorRewards['2'].find(e => e[0] === 1), [1, 1, 13683, 1, 0, 1, 0, 0, 0, 2, 1]);
});
await step('reimport the pack into a clean browser: rewards, banner and castle rewards come back', async () => {
  const q = await page();
  await q.setInputFiles('#bdOpen', { name: 'pack.zip', mimeType: 'application/zip', buffer: packBuf }); await q.waitForTimeout(2500);
  const d = await q.S(() => Object.values(__stages.readStore().drafts).find(x => x.localId && x.base === '300301' || x.base === 300301));
  assert.ok(d, 'the Emergency stage is back'); assert.deepEqual(JSON.parse(JSON.stringify(d.rewards)).lucky, draftRewards.lucky); assert.equal(d.rewards.exp, 3000); assert.equal(d.banner.sha256, bannerSha);
  assert.ok(await q.S(async s => !!(await __stages.getBanner(s)), bannerSha), 'the banner picture is stored');
  assert.ok(await q.S(() => Object.values(__stages.readStore().castles || {}).some(c => c.draft && c.draft.rewards && c.draft.rewards.floors['2'])));
  await q.ctx.close();
});
await step('Save editable project keeps the banner picture; restoring it in a clean browser brings it back', async () => {
  const ws = await download(p, () => p.S(() => __stages.saveWorkspace())); const { f, names } = unzipList(ws);
  assert.ok(names.includes(`banners/${bannerSha}.png`)); assert.equal(sha(member(f, `banners/${bannerSha}.png`)), bannerSha);
  const q = await page(); await q.setInputFiles('#bdOpen', { name: 'Forge-stages-project.zip', mimeType: 'application/zip', buffer: ws }); await q.waitForTimeout(2500);
  assert.ok(await q.S(async s => !!(await __stages.getBanner(s)), bannerSha)); await q.ctx.close();
});
await step('a Road definition with rewards imports from a JSON file into the Road reward editor', async () => {
  const road = JSON.parse(readFileSync(join(ROOT, 'stages/rewards/examples/road-rewards.json'), 'utf8'));
  await p.setInputFiles('#bdOpen', { name: 'road-rewards.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(road)) }); await p.waitForTimeout(2000);
  const d = await p.S(() => Object.values(__stages.readStore().drafts).find(x => x.localId === 'example:road-rewards'));
  assert.ok(d && d.rewards); assert.ok(d.rewards.mapClear['8043015'].some(x => x.unitId === '13683')); assert.equal(d.rewards.mapClear['8043020'], undefined); assert.ok(d.rewards.roadClear.some(x => x.key === 'jewel' && x.qty === 50));
});
for (const w of [375, 390, 430]) await step(`phone width ${w}: the Banner card and the export switch fit`, async () => {
  const q = await page({ width: w, height: 860 }); await q.S(() => __stages.setKind('emergency', { mode: 'game' })); await q.waitForTimeout(1500);
  await q.fill('#rwExp', '3001'); await q.press('#rwExp', 'Tab'); await q.waitForTimeout(1200);
  await q.setInputFiles('#bnFile', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: big }); await q.waitForTimeout(800);
  assert.ok(await q.S(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
  assert.ok(await q.S(() => { const r = document.querySelector('#bnBody canvas.bncv').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.width > 200; }));
  await q.S(() => __stages.openExport('enabled')); await q.waitForTimeout(800); assert.ok(await q.S(() => document.querySelector('.xfull').getBoundingClientRect().right <= innerWidth + 1)); await q.ctx.close();
});
await b.close();
assert.deepEqual(errors, [], 'no page errors');
console.log(JSON.stringify({ passed: true, checks: passed.length, names: passed, phoneTested: false }, null, 1));
