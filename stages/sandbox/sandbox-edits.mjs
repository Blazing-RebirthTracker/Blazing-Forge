/* Extra editing operations for ForgeStageSandbox projects with the supplied event catalog (profile kirito-events/1).
   stage-sandbox.mjs (supplied, unchanged) implements import/export, validation, scenes, marker moves and the three
   reward conveniences; this file adds the controls it doesn't have. Every operation returns a new project, keeps the
   raw client/server mirrors together and runs the supplied validateProject on the result, so a bad value never lands.
   Website authoring data only: nothing here makes a project installable or allocates game IDs. */
import * as SA from './stage-sandbox.mjs';
import * as MA from './stage-map-authoring.mjs';
export { SA, MA };

const clone = x => JSON.parse(JSON.stringify(x));
const need = (ok, message) => { if (!ok) throw new Error(message); };
const integer = (x, min, max, label) => need(Number.isSafeInteger(x) && x >= min && x <= max, `${label}: enter a whole number from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}`);
const id = x => String(x);
export const PROFILE = 'kirito-events/1';
export const POLICY = { quantity: 999, currency: 99999999, hp: 99999999, stat: 9999999, count: 20, difficulty: [0, 5], scale: [0.1, 10] };
// editor policy, not certified engine limits; difficulty 0-5 is the range the game's own missions use
const PLUS = ['s', 'a', 'd', 'sp'];

export function supports(p) { return !!(p && p.catalog && p.catalog.profile === PROFILE); }
/** reward items the project points at must exist in the reward library (and not be a reserved material slot) */
export function checkLibrary(p, library) {
  if (!library) return p; const has = x => { const i = library.items && library.items[id(x)]; return i && i.availability !== 'reserved'; };
  for (const s of p.catalog.stages) { const d = s.donor;
    for (const c of d.serverMission.dropCandidates) need(has(c.dropId), `Unknown or reserved drop item ${c.dropId}`);
    for (const r of d.drops.lucky || []) need(has(r.chara_id), `Unknown or reserved lucky reward item ${r.chara_id}`);
    for (const o of d.mission.missionInfo.subMission) for (const u of o.subMissionReward.units) if (u.unitId) need(has(u.unitId), `Unknown or reserved challenge reward item ${u.unitId}`); }
  return p;
}
export function validate(p, library) { SA.validateProject(p); return checkLibrary(p, library); }
// JSON text -> project, refusing integers a JS number can't hold exactly (large IDs must arrive as text), then the supplied import
export function importText(text, library) {
  let i = 0; const n = text.length;
  while (i < n) { const c = text.charCodeAt(i);
    if (c === 34) { i++; while (i < n) { const d = text.charCodeAt(i); if (d === 92) i += 2; else if (d === 34) { i++; break; } else i++; } continue; }
    if (c === 45 || (c >= 48 && c <= 57)) { let j = i + 1; while (j < n && /[0-9.eE+-]/.test(text[j])) j++; const tok = text.slice(i, j);
      need(!(/^-?\d{16,}$/.test(tok) && !Number.isSafeInteger(Number(tok))), `The file has the number ${tok}, which is too large to keep exactly. Large IDs must be stored as text.`); i = j; continue; }
    i++; }
  return checkLibrary(SA.importProject(text), library);
}
/** the line ending a project file uses, so a save writes it back the same way (JSON text has no raw newlines inside strings) */
export const eolOf = text => /\r\n/.test(text) ? '\r\n' : '\n';
export const withEol = (json, eol) => eol === '\r\n' ? json.replace(/\r?\n/g, '\r\n') : json;
/** how a project file was written (line ending, indentation, final newline), so a save writes it back the same way */
export function formatOf(text) {
  const m = /^\{(\r?\n)([ \t]+)"/.exec(text);
  return { eol: eolOf(text), indent: m ? m[2] : 0, final: /\n$/.test(text) };
}
/** project -> text in a given format; the default is the supplied adapter's own (2 spaces, LF, final newline) */
export function serialize(p, fmt) {
  const f = fmt || { eol: '\n', indent: 2, final: true };
  const body = f.indent ? JSON.stringify(p, null, f.indent) : JSON.stringify(p);
  return withEol(body + (f.final === false ? '' : '\n'), f.eol);
}
function edit(p, library, fn) { const next = clone(p); fn(next); return validate(next, library); }
const stage = (p, localId) => { const s = p.catalog.stages.find(s => s.spec.localId === localId); need(s, 'Unknown quest'); return s; };
const mapOf = (s, mapId) => { const m = s.donor.maps.find(m => m.id === id(mapId)); need(m, 'Unknown map'); return m; };
const enemyOf = (p, enemyId) => { const e = p.catalog.enemies.find(e => id(e.id) === id(enemyId)); need(e, 'Unknown enemy'); return e; };
function itemOf(library, itemId) { need(library && library.items, 'The reward catalog isn’t loaded'); const i = library.items[id(itemId)]; need(i, 'Select an item from the reward catalog'); need(i.availability !== 'reserved', 'Reserved material slots cannot be awarded'); return i; }
/** maps (anywhere in the project) that use an enemy definition */
export function usesOf(p, enemyId) { const out = []; for (const s of p.catalog.stages) for (const m of s.donor.maps) if (m.sets.some(x => x.raw.enemySet.some(t => id(t.id) === id(enemyId)))) out.push({ localId: s.spec.localId, mapId: m.id }); return out; }
function soleMap(p, mapId, enemyId) { for (const u of usesOf(p, enemyId)) need(u.mapId === id(mapId), 'This enemy is also used on another map. Editing it here would change that map too.'); }
// the server drop candidates and normal-unit summary, rebuilt exactly as the supplied adapter's setNormalDrop does
export function rebuildNormalDrops(p, s, library) {
  const out = [];
  for (const m of s.donor.maps) for (const set of m.sets) for (const entry of set.raw.enemySet) {
    if (!entry.dropRate) continue;
    const e = enemyOf(p, entry.id), i = itemOf(library, e.dropId);
    out.push({ mapId: Number(m.id), enemySetId: Number(set.id), enemyId: e.id, dropId: e.dropId, unitType3: i.type3,
      chancePerThousand: entry.dropRate, enemyCount: entry.count, unitLevelMin: e.dropUnitLevelMin,
      unitLevelMax: e.dropUnitLevelMax, luck: e.dropLuck, skillLevel: e.dropSkillLevel, ability: e.dropAbilityLevel,
      plusS: e.dropPlus_s, plusA: e.dropPlus_a, plusD: e.dropPlus_d, plusSp: e.dropPlus_sp });
  }
  s.donor.serverMission.dropCandidates = out;
  s.donor.drops.normalUnits = [...new Set(out.map(x => x.dropId))];
}

// ---- normal drops: level, luck and bonuses of the dropped item (the item and chance go through SA.setNormalDrop)
export function setNormalDropDetails(p, localId, mapId, enemyId, v, library) {
  integer(v.levelMin, 0, POLICY.quantity, 'Drop level (lowest)'); integer(v.levelMax, 0, POLICY.quantity, 'Drop level (highest)'); need(v.levelMin <= v.levelMax, 'The lowest drop level can’t be above the highest');
  integer(v.luck, 0, POLICY.quantity, 'Drop luck'); for (const k of PLUS) integer(v.plus[k], 0, POLICY.quantity, 'Plus bonus');
  return edit(p, library, n => { const s = stage(n, localId), e = enemyOf(n, enemyId); mapOf(s, mapId); soleMap(n, mapId, enemyId);
    Object.assign(e, { dropUnitLevelMin: v.levelMin, dropUnitLevelMax: v.levelMax, dropLuck: v.luck }); for (const k of PLUS) e['dropPlus_' + k] = v.plus[k];
    rebuildNormalDrops(n, s, library); });
}
// ---- lucky reward: level, luck and bonuses (item and quantity go through SA.setLuckyReward)
export function setLuckyDetails(p, localId, v, library) {
  integer(v.level, 1, POLICY.quantity, 'Lucky reward level'); integer(v.luck, 0, POLICY.quantity, 'Lucky reward luck'); for (const k of PLUS) integer(v.plus[k], 0, POLICY.quantity, 'Plus bonus');
  return edit(p, library, n => { const r = stage(n, localId).donor.drops.lucky[0]; need(r, 'No lucky reward row');
    Object.assign(r, { chara_level: v.level, luck: v.luck }); for (const k of PLUS) r['plus_' + k] = v.plus[k]; });
}
// ---- challenge rewards: pearls and Ryo (the item goes through SA.setObjectiveReward); conditions stay exactly as they are
export function setChallengeCurrency(p, localId, objectiveId, v, library) {
  integer(v.jewel, 0, 9999, 'Challenge Ninja Pearls'); integer(v.coin, 0, POLICY.currency, 'Challenge Ryo');
  return edit(p, library, n => { const d = stage(n, localId).donor, o = d.mission.missionInfo.subMission.find(x => id(x.id) === id(objectiveId)); need(o, 'Unknown objective');
    Object.assign(o.subMissionReward, { jewel: v.jewel, coin: v.coin }); d.objective.objectives = clone(d.mission.missionInfo.subMission); });
}
// ---- coins and EXP: client and server copies together
export function setCurrency(p, localId, v, library) {
  for (const [k, label] of [['minCoin', 'Lowest Ryo'], ['maxCoin', 'Highest Ryo'], ['exp', 'Player EXP'], ['charaExp', 'Unit EXP']]) integer(v[k], 0, POLICY.currency, label);
  need(v.minCoin <= v.maxCoin, 'Lowest Ryo can’t be above highest Ryo');
  return edit(p, library, n => { const d = stage(n, localId).donor, mi = d.mission.missionInfo, sm = d.serverMission;
    Object.assign(mi, { minCoin: v.minCoin, maxCoin: v.maxCoin, exp: v.exp, charaExp: v.charaExp });
    Object.assign(sm, { minimumCoin: v.minCoin, maximumCoin: v.maxCoin, experience: v.exp, characterExperience: v.charaExp }); });
}
// ---- one placement in an enemy set: level, count, role, facing, on/off (entry points move with SA.moveMarker)
export const ROLES = { 0: 'Normal', 2: 'Boss', 3: 'Mini boss' };
export function levelRange(e) { const pd = e.paramDatas || []; const lo = Math.min(...pd.map(x => x.startLevel), 1), hi = Math.max(...pd.map(x => x.endLevel), e.maxLevel || 1); return [lo, hi]; }
export function setPlacement(p, localId, mapId, setId, index, v, library) {
  return edit(p, library, n => { const s = stage(n, localId), m = mapOf(s, mapId), set = m.sets.find(x => x.id === id(setId)); need(set, 'Unknown enemy set');
    const t = set.raw.enemySet[index]; need(t && t.id > 0, 'Unknown enemy placement'); const e = enemyOf(n, t.id), [lo, hi] = levelRange(e);
    integer(v.level, lo, hi, `Level (this enemy’s stat table covers ${lo}–${hi})`); integer(v.count, 1, POLICY.count, 'How many');
    need(Object.hasOwn(ROLES, v.type), 'Pick a role'); integer(v.way, 0, 5, 'Facing'); need(typeof v.enabled === 'boolean', 'On/off must be yes or no');
    Object.assign(t, { level: v.level, count: v.count, type: v.type, way: v.way, enabled: v.enabled });
    if (s.donor.serverMission.dropCandidates.length || t.dropRate) rebuildNormalDrops(n, s, library); });
}
// ---- enemy stats: row level and paramDatas mirrored; a definition shared with another map is refused
const statKeys = [['hp', 'HP', 1, POLICY.hp], ['atk', 'ATK', 0, POLICY.stat], ['def', 'DEF', 0, POLICY.stat]];
function setStat(e, key, value) { // start value = value; a growing end value keeps its ratio
  const apply = o => { const s0 = o[key].s, e0 = o[key].e; o[key].s = value; o[key].e = s0 ? Math.round(e0 * value / s0) : value; };
  apply(e); for (const pd of e.paramDatas || []) apply(pd);
}
export function setEnemyStats(p, localId, mapId, enemyId, v, library) {
  for (const [k, label, lo, hi] of statKeys) integer(v[k], lo, hi, label);
  return edit(p, library, n => { const s = stage(n, localId); mapOf(s, mapId); soleMap(n, mapId, enemyId); const e = enemyOf(n, enemyId); for (const [k] of statKeys) setStat(e, k, v[k]); });
}
// ---- difficulty: the mission's raw difficulty value (client and server), and a stat multiplier over a range of maps
export function setDifficulty(p, localId, value, library) {
  integer(value, POLICY.difficulty[0], POLICY.difficulty[1], 'Difficulty');
  return edit(p, library, n => { const d = stage(n, localId).donor; d.mission.missionInfo.difficulty = value; d.serverMission.difficulty = value; });
}
export function scaleStats(p, localId, fromMap, toMap, factor, opts, library) {
  need(Number.isFinite(factor) && factor >= POLICY.scale[0] && factor <= POLICY.scale[1], `Multiplier: enter ${POLICY.scale[0]} to ${POLICY.scale[1]}`);
  const keys = statKeys.filter(([k]) => (opts || { hp: true, atk: true, def: true })[k]); need(keys.length, 'Pick at least one stat to scale');
  return edit(p, library, n => { const s = stage(n, localId), maps = s.donor.maps; integer(fromMap, 1, maps.length, 'First map'); integer(toMap, fromMap, maps.length, 'Last map');
    const inRange = new Set(maps.slice(fromMap - 1, toMap).map(m => m.id)), ids = new Set();
    for (const m of maps.slice(fromMap - 1, toMap)) for (const set of m.sets) for (const t of set.raw.enemySet) if (t.id > 0) ids.add(t.id);
    for (const eid of ids) { for (const u of usesOf(n, eid)) need(inRange.has(u.mapId) && u.localId === localId, `Enemy ${eid} is also used outside maps ${fromMap}–${toMap}; scaling it would change those maps too.`);
      const e = enemyOf(n, eid); for (const [k, label, lo, hi] of keys) { const v = Math.round(e[k].s * factor); integer(Math.max(lo, v), lo, hi, `${label} of enemy ${eid} after scaling`); setStat(e, k, Math.max(lo, v)); } } });
}
// ---- put one map back the way the baseline had it: layout, background, placements and the rows of enemies used only there
export function resetMap(p, baseline, localId, mapId, library, mapLibrary) {
  const src = mapOf(stage(baseline, localId), mapId);
  const out = edit(p, library, n => { const s = stage(n, localId), i = s.donor.maps.findIndex(m => m.id === id(mapId)); need(i >= 0, 'Unknown map');
    s.donor.maps[i] = clone(src);
    const bs = stage(baseline, localId).spec.maps.find(m => m.donorMapId === id(mapId)), ns = s.spec.maps.find(m => m.donorMapId === id(mapId)); if (bs && ns) ns.markers = clone(bs.markers);
    for (const set of src.sets) for (const t of set.raw.enemySet) { if (t.id < 0) continue; const uses = usesOf(n, t.id); if (uses.length !== 1) continue;
      const b = baseline.catalog.enemies.findIndex(e => id(e.id) === id(t.id)), j = n.catalog.enemies.findIndex(e => id(e.id) === id(t.id)); if (b >= 0 && j >= 0) n.catalog.enemies[j] = clone(baseline.catalog.enemies[b]); }
    rebuildNormalDrops(n, s, library); });
  // the map's server row follows its restored background (and the asset lists gain its parts) through the supplied map adapter
  return mapLibrary ? MA.setMapBackground(out, localId, mapId, String(src.raw.mapBgId), mapLibrary) : out;
}

// ---- maps: backgrounds and floor layouts from the supplied map library (catalogs/map-library.json)
export const isMarkerChip = c => (c >= 8 && c <= 13) || (c >= 16 && c <= 25);
const floorChip = c => c > 7 || ((0x6e >> c) & 1) !== 0;
const PLAIN = c => c === 0 || c === 1 || c === 2 || isMarkerChip(c);
// readable names for the background file stems (the game's own romanized Japanese); the stem is always shown too
export const BG_NAMES = { heigen: 'Plains', mori: 'Forest', shinomori: 'Forest of Death', kaoiwa: 'Hokage Rock', konohasato: 'Leaf Village', konoha_houkai: 'Leaf Village (destroyed)',
  kaido: 'Highway', kaigan: 'Coast', kawara: 'Riverbank', sabaku: 'Desert', suna: 'Sand Village', doukutu: 'Cave', hyouzan: 'Ice mountain', yougan: 'Lava', iwaba: 'Rocky ground',
  kouya: 'Wasteland', senjyou: 'Battlefield', oohashi: 'Great bridge', utiha: 'Uchiha', utiha2: 'Uchiha 2', akatuki: 'Akatsuki', samurai: 'Samurai', tetu: 'Land of Iron',
  hinotera: 'Fire Temple', syumatu: 'Valley of the End', syuumatunotani: 'Valley of the End', tanzaku: 'Tanzaku Town', tenti: 'Heaven-Earth Bridge', isidan: 'Stone steps',
  ame_soto: 'Rain Village outskirts', kinoko: 'Mushrooms', takenoko: 'Bamboo', kyodaijyu: 'Giant tree', jigokudani: 'Hell Valley', kankin: 'Prison', kitaajito: 'North hideout',
  jitukensisetu: 'Laboratory', mugenjyou: 'Infinite castle', nenohonbu: 'Root headquarters', shinratensei: 'Shinra Tensei crater', hondou: 'Main hall', yosen: 'Preliminaries', honsen: 'Finals arena' };
export function baseLayer(def) {
  const flat = def.layers.filter(l => !l.raw.isSpriteStudio && l.textures && l.textures.length).sort((a, b) => (a.raw.layer - b.raw.layer) || (a.sourceIndex - b.sourceIndex));
  return flat[0] || def.layers.find(l => l.textures && l.textures.length) || null;
}
/** a background definition, summarised for pickers: name, base texture, animated parts, and why it needs developer work */
export function backgroundInfo(mapLibrary, bgId) {
  const def = mapLibrary && mapLibrary.definitions[id(bgId)]; if (!def) return null;
  const base = baseLayer(def), tex = base && base.textures[0], stem = tex ? (/^bg_\d+_(.+)$/.exec(tex.name) || [, tex.name])[1] : null;
  const r = def.raw || {}, needs = [];
  if (r.isChangeMapChip) needs.push('changes the floor grid during battle');
  if ((r.mapGimmickList || []).length) needs.push(`${r.mapGimmickList.length} map gimmick${r.mapGimmickList.length === 1 ? '' : 's'} (traps or effects)`);
  if ((r.envEffList || []).length) needs.push(`${r.envEffList.length} environment effect${r.envEffList.length === 1 ? '' : 's'}`);
  if (def.layers.some(l => l.raw.mapGimmickId)) needs.push('layer gimmicks');
  const parts = def.layers.filter(l => l.animations && l.animations.length);
  return { id: def.backgroundId, name: stem ? (BG_NAMES[stem] ? `${BG_NAMES[stem]} (${stem})` : stem) : 'Background ' + def.backgroundId, stem, texture: tex ? tex.file : null,
    textureSize: tex ? [tex.width, tex.height] : null, layers: def.layers.length, animated: parts.length, parts, needs, usedBy: (def.usedBy && def.usedBy.maps || []).length, def };
}
/** the template's floor grid with its own markers cleared (what replaceMapLayout starts from) */
export function plainLines(template) { return template.lines.map(l => ({ chips: l.chips.map(c => isMarkerChip(c) || c === 2 ? 1 : c) })); }
export function templateSupported(template) { return !!(template && template.supportedPlainLayout !== false && template.lines.every(l => l.chips.every(PLAIN))); }
/** where the selected map's markers would land on a template, and which ones need a free floor tile first */
export function layoutCheck(p, localId, mapId, mapLibrary, templateId, placements = {}) {
  const t = mapLibrary.templates[id(templateId)]; need(t, 'Choose a supplied layout'); const m = mapOf(stage(p, localId), mapId), lines = plainLines(t), markers = [], taken = new Map();
  m.raw.map.lines.forEach((l, y) => l.chips.forEach((chip, x) => { if (isMarkerChip(chip)) markers.push({ chip, from: [x, y] }); }));
  for (const mk of markers) { mk.at = placements[mk.chip] || mk.from; mk.moved = !!placements[mk.chip]; const k = mk.at.join(','); taken.set(k, (taken.get(k) || 0) + 1); }
  for (const mk of markers) { const [x, y] = mk.at; const inside = x >= 0 && y >= 0 && x < 11 && y < 11;
    mk.ok = inside && floorChip(lines[y].chips[x]) && taken.get(mk.at.join(',')) === 1; mk.reason = !inside ? 'outside the grid' : !floorChip(lines[y].chips[x]) ? 'in a wall' : mk.ok ? '' : 'on the same tile as another marker'; }
  return { template: t, supported: templateSupported(t), lines, markers, conflicts: markers.filter(x => !x.ok).length };
}
/** nearest free floor tile for each conflicting marker (a proposal the user sees and can change, never applied silently) */
export function suggestPlacements(check) {
  const used = new Set(check.markers.filter(m => m.ok).map(m => m.at.join(','))), out = {};
  for (const mk of check.markers) { if (mk.ok) continue; let best = null, bd = 1e9;
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) { if (!floorChip(check.lines[y].chips[x]) || used.has(x + ',' + y)) continue; const d = Math.abs(x - mk.from[0]) + Math.abs(y - mk.from[1]); if (d < bd) { bd = d; best = [x, y]; } }
    if (best) { out[mk.chip] = best; used.add(best.join(',')); } }
  return out;
}
/** validate a project with both supplied adapters: the sandbox rules and, when the map library is loaded, the map rules */
export function validateAll(p, library, mapLibrary) { validate(p, library); if (mapLibrary) MA.validateMaps(p, mapLibrary); return p; }
/** files a developer needs for the backgrounds a project uses: definition, textures, serialized records and animations */
export function backgroundFiles(p, mapLibrary, assetIndex) {
  const out = new Set(), byRoute = new Map((assetIndex || []).map(a => [a.route, a]));
  for (const s of p.catalog.stages) for (const m of s.donor.maps) { const def = mapLibrary.definitions[id(m.raw.mapBgId)]; if (!def) continue;
    out.add(`backgrounds/definitions/${def.backgroundId}.json`);
    for (const l of def.layers) { for (const t of l.textures || []) out.add(t.file); for (const a of l.animations || []) { out.add('animation/' + a.model); out.add('animation/' + a.clip); }
      const a = byRoute.get(l.route); if (a && a.serialized) out.add(a.serialized); } }
  return [...out];
}
/** source-relative change list: JSON path, before, after */
export function changes(a, b, path = '', out = [], max = 5000) {
  if (out.length >= max || JSON.stringify(a) === JSON.stringify(b)) return out;
  const oa = a && typeof a === 'object', ob = b && typeof b === 'object';
  if (oa && ob && Array.isArray(a) === Array.isArray(b)) {
    const keys = Array.isArray(a) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) changes(a[k], b[k], path + (Array.isArray(a) ? `[${k}]` : (path ? '.' : '') + k), out, max); return out; }
  out.push({ path, before: a === undefined ? null : a, after: b === undefined ? null : b }); return out;
}
/** the supplied scene, plus the raw placement fields the editor shows (read from the same records, never changed) */
export function scene(p, localId, mapId, labels) {
  const v = SA.scene(p, localId, mapId, labels), m = mapOf(stage(p, localId), mapId);
  for (const en of v.enemies) { const t = m.sets.find(x => x.id === en.setId).raw.enemySet[en.index]; Object.assign(en, { entry: t, type: t.type, enterId: t.enterId }); }
  return v;
}
