/* Forge Stages, app v2.5.0: the website side of the three native stage modes.
   Pure functions only (no DOM, no storage), so the page and the node tests share them.
   stage-modes.mjs is the import contract and stays byte-for-byte as supplied; every spec this file
   builds goes through its validate(), setEnabled() and exportFiles(). Game IDs are never chosen here:
   slot cards are project positions and the app allocates real destinations when it imports. */
import * as SM from './stage-modes.mjs';
export { SM };

export const KINDS = {
  emergency: { profile: SM.modes.emergency, label: 'Emergency', capacity: SM.capacity[SM.modes.emergency], prefix: 'forge-stages', exclusive: false },
  road: { profile: SM.modes.road, label: 'Ninja Road', capacity: SM.capacity[SM.modes.road], prefix: 'forge-road', exclusive: true },
  castle: { profile: SM.modes.castle, label: 'Phantom Castle', capacity: SM.capacity[SM.modes.castle], prefix: 'forge-castle', exclusive: true }
};
export const KIND_LIST = ['emergency', 'road', 'castle'];
export const kindOfProfile = p => KIND_LIST.find(k => KINDS[k].profile === p) || null;
export const PRE_250_EMERGENCY_SLOTS = 20; // projects saved before v2.5.0 had 20 Emergency slots (stage 3800-3819)
export const MAX_MOVES = 16;
export const LOCAL_ID_RE = /^[A-Za-z0-9_.:-]{1,96}$/;
export const isLocalId = s => typeof s === 'string' && LOCAL_ID_RE.test(s) && s.includes(':');
const copy = x => JSON.parse(JSON.stringify(x));
const bytes = s => new TextEncoder().encode(s).length;

// ---- slots: the supplied destination table, split by mode. These are planned destinations shown in
// Advanced details; the app assigns the first unused slot of the matching mode when it imports.
export function slotTable(catalog) {
  const out = { emergency: [], road: [], castle: [] };
  for (const s of catalog.slots || []) {
    const kind = s.profile ? kindOfProfile(s.profile) : 'emergency'; if (!kind) continue;
    const n = out[kind].length + 1;
    out[kind].push(kind === 'castle' ? { slot: n, ledgerSlot: s.slot, pvpId: String(s.pvpId) } : { slot: n, ledgerSlot: s.slot, stageId: String(s.stageId), missionId: String(s.missionId) });
  }
  return out;
}
export function ledgerToKind(ledgerSlot, table) {
  for (const k of KIND_LIST) { const s = table[k].find(x => x.ledgerSlot === ledgerSlot); if (s) return { kind: k, slot: s.slot }; }
  return null;
}
export function newLocalId(kind, random = defaultRandom) {
  const r = random(8); return KINDS[kind].prefix + ':' + [...r].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
function defaultRandom(n) { const r = new Uint8Array(n); globalThis.crypto.getRandomValues(r); return r; }

export function templateList(catalog, kind) { return SM.templates(catalog, KINDS[kind].profile); }
export function template(catalog, kind, id) { const t = templateList(catalog, kind); return id != null && Object.hasOwn(t, String(id)) ? t[String(id)] : null; }
/** which mode a donor ID belongs to (template IDs don't overlap between modes) */
export function kindOfDonor(catalog, id) { for (const k of ['emergency', 'road']) if (template(catalog, k, id)) return k; return null; }

// ---- name checks shared by every mode (the adapter repeats them; these give friendlier wording first)
export function nameProblem(name) {
  const n = (name || '').trim(), b = bytes(n);
  if (!b) return 'Give it a name.';
  if (b > 96) return `The name is ${b} bytes long; the game allows 96 (accented letters and other scripts take more than one).`;
  if (/[\x00-\x1f\x7f]/.test(n)) return 'The name can’t contain control characters.';
  return null;
}

// ---- Emergency / Road layouts: marker moves between a template grid and an edited grid
export const chipsOf = m => m.raw.map.lines.map(l => l.chips.slice());
export const isMarker = c => (c >= 8 && c <= 13) || (c >= 16 && c <= 25);
export const markerName = c => c <= 13 ? `start spot ${c - 7}` : `entry point ${c - 15}`;
export function cellsWith(G, c) { const o = []; for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (G[y][x] === c) o.push([x, y]); return o; }

/** moves that turn template grid O into edited grid E, plus what can't carry over to the game */
export function mapMoves(O, E, label) {
  const moves = [], errs = [], lost = [], from = {};
  for (let c = 8; c <= 25; c++) { if (!isMarker(c)) continue;
    const a = cellsWith(O, c), b = cellsWith(E, c);
    if (!a.length && !b.length) continue;
    if (!a.length) { lost.push(`${label}: new ${markerName(c)}. The template has no ${markerName(c)}, so the game leaves it out.`); continue; }
    if (a.length > 1) { if (JSON.stringify(a) !== JSON.stringify(b)) lost.push(`${label}: ${markerName(c)} is a random entry in ${a.length} cells in this template, so the game keeps it where it is.`); continue; }
    if (b.length !== 1) { lost.push(`${label}: ${markerName(c)} ${b.length ? 'is in more than one spot' : 'was taken off the field'}; the game keeps it where it is.`); continue; }
    if (a[0][0] === b[0][0] && a[0][1] === b[0][1]) continue;
    moves.push({ chip: c, grid: [b[0][0], b[0][1]] }); from[c] = a[0];
  }
  if (moves.length > MAX_MOVES) errs.push(['STAGE_MARKERS', `${label} moves ${moves.length} markers; the game takes up to ${MAX_MOVES} per map.`]);
  const G = O.map(r => r.slice()); for (const mv of moves) { const [x, y] = from[mv.chip]; G[y][x] = 1; }
  const used = new Set();
  for (const mv of moves) { const [x, y] = mv.grid, k = x + ',' + y;
    if (G[y][x] !== 1 || used.has(k)) errs.push(['STAGE_OCCUPIED', `${label}: ${markerName(mv.chip)} is on a cell that isn’t open floor in the template (or another marker’s destination). Move it to a field cell.`]);
    used.add(k); }
  for (const mv of moves) G[mv.grid[1]][mv.grid[0]] = mv.chip;
  let shape = 0; for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (E[y][x] !== G[y][x] && !isMarker(E[y][x]) && !isMarker(G[y][x])) shape++;
  if (shape) lost.push(`${label}: the field shape changed in ${shape} cell${shape === 1 ? '' : 's'}; the game keeps the template’s field.`);
  return { moves, errs, lost };
}
/** put spec moves onto the template grids; returns the edited grids and how many moves didn't fit */
export function gridsFromMoves(tpl, specMaps) {
  let skipped = 0;
  const grids = tpl.maps.map((m, i) => { const O = chipsOf(m), mv = ((specMaps || [])[i] || []).filter(v => v && isMarker(v.chip) && Array.isArray(v.grid));
    const ok = mv.filter(v => cellsWith(O, v.chip).length === 1 && v.grid.length === 2 && v.grid.every(n => Number.isInteger(n) && n >= 0 && n <= 10)); skipped += mv.length - ok.length;
    const G = O.map(r => r.slice()); for (const v of ok) { const [x, y] = cellsWith(O, v.chip)[0]; G[y][x] = 1; }
    const used = new Set(), keep = [];
    for (const v of ok) { const k = v.grid.join(','); if (G[v.grid[1]][v.grid[0]] === 1 && !used.has(k)) { used.add(k); keep.push(v); } else skipped++; }
    for (const v of ok) if (!keep.includes(v)) { const [x, y] = cellsWith(O, v.chip)[0]; G[y][x] = v.chip; }
    for (const v of keep) G[v.grid[1]][v.grid[0]] = v.chip; return G; });
  return { grids, skipped };
}
/** a layout spec (ForgeStage schema 2) from edited grids; maps keep the template's IDs and order */
export function layoutSpec(kind, { localId, name, donor, enabled }, tpl, moves) {
  return { format: 'ForgeStage', schema: 2, profile: KINDS[kind].profile, localId, name: (name || '').trim(), donorMissionId: String(donor),
    enabled: enabled !== false, maps: tpl.maps.map((m, i) => ({ donorMapId: m.id, markers: (moves && moves[i]) || [] })) };
}
/** the adapter's verdict on a spec, as a message (null when it passes) */
export function contractProblem(catalog, spec) { try { SM.validate(catalog, spec); return null; } catch (e) { return e.message; } }

// ---- enemy sets and spawn candidates on one template map, labeled honestly
export function mapCandidates(tpl, mapIndex) {
  const m = tpl.maps[mapIndex]; if (!m) return null; const G = chipsOf(m), list = m.raw.enemySetList || [];
  const total = list.reduce((a, s) => a + (s.rate || 0), 0) || 0;
  const sets = (m.sets || []).map((set, i) => { const row = list.find(r => String(r.enemySetId) === set.id) || {};
    const entries = set.raw.enemySet.map((e, seq) => e.id < 0 ? { command: e.id, param: e.param, seq } : { seq, enemyId: String(e.id), enterId: e.enterId, chip: 15 + e.enterId, count: e.count || 1, type: e.type, level: e.level,
      cells: cellsWith(G, 15 + e.enterId), random: cellsWith(G, 15 + e.enterId).length > 1 });
    return { id: set.id, ordinal: i + 1, rate: row.rate ?? null, chance: total && row.rate != null ? row.rate / total : (m.sets.length === 1 ? 1 : null), entries }; });
  const users = {}; for (const s of sets) for (const e of s.entries) if (e.enemyId) (users[e.chip] = users[e.chip] || []).push({ set: s.id, seq: e.seq, enemyId: e.enemyId });
  return { mapId: m.id, sets, users, randomChips: Object.keys(users).map(Number).filter(c => cellsWith(G, c).length > 1) };
}

// ---- Phantom Castle: floor progression and rewards
export function compatiblePresets(catalog, pvpId) {
  const c = catalog.castleDonors, base = c[String(pvpId)]; if (!base) return [];
  const key = JSON.stringify(base.points); return Object.keys(c).filter(id => JSON.stringify(c[id].points) === key);
}
/** cumulative thresholds scaled and rounded to the nearest whole point; base values and the final zero stay */
export function scaledPoints(points, scale = 1) {
  return points.map(([floor, cumulative, base]) => ({ floor, original: cumulative, scaled: cumulative === 0 ? 0 : Math.round(cumulative * scale), base }));
}
export function castleSpec({ localId, name, donorPvpId, rewardPvpId, pointScale, enabled }) {
  const s = { format: 'ForgeCastle', schema: 1, profile: KINDS.castle.profile, localId, name: (name || '').trim(), enabled: enabled !== false, donorPvpId: String(donorPvpId), pointScale: pointScale ?? 1 };
  if (rewardPvpId != null && String(rewardPvpId) !== String(donorPvpId)) s.rewardPvpId = String(rewardPvpId);
  return s;
}
// reward events: kind codes matched one-for-one against the season's own raw reward rows
// (2 = jewel, 6 = coin, 7 = fp, 3 = gemNormal, 11 = battleSkipBill, 1 = unit/item row)
export const REWARD_KINDS = { 1: { key: 'item', label: 'Item' }, 2: { key: 'jewel', label: 'Ninja Pearls', field: 'jewel' }, 3: { key: 'gemNormal', label: 'Cat Granny coins', field: 'gemNormal' },
  6: { key: 'coin', label: 'Ryo', field: 'coin' }, 7: { key: 'fp', label: 'Friend points', field: 'fp' }, 11: { key: 'skip', label: 'Skip tickets', field: 'battleSkipBill' } };
export function decodeReward(ev) {
  const k = REWARD_KINDS[ev[0]];
  if (!k) return { key: 'unknown', label: `Reward type ${ev[0]}`, qty: ev[1] ?? null, raw: ev };
  if (k.key !== 'item') return { key: k.key, label: k.label, qty: ev[1], raw: ev };
  return { key: 'item', label: 'Item', qty: ev[1], unitId: String(ev[2]), level: ev[3], plus: { s: ev[6] || 0, a: ev[7] || 0, d: ev[8] || 0, sp: ev[9] || 0 }, raw: ev };
}
export function castleView(catalog, spec) {
  const c = catalog.castleDonors, base = c[spec.donorPvpId], rw = c[spec.rewardPvpId || spec.donorPvpId] || base; if (!base) return null;
  const rawFloor = {}; for (const r of (rw.arena && rw.arena.arenaFloorRewards) || []) rawFloor[r.floor] = r;
  const pts = scaledPoints(base.points, spec.pointScale ?? 1);
  const floors = pts.map(p => ({ ...p, rewards: (rw.floorRewards[String(p.floor)] || []).map(decodeReward), sourceName: rawFloor[p.floor] ? rawFloor[p.floor].name : null }));
  const ranking = (rw.rankingRewards || []).map((r, i) => ({ start: r.start, end: r.end, rewards: r.events.map(decodeReward), raw: (rw.arena.arenaRankingRewards || [])[i] || null }));
  return { base, rewardSeason: rw, floorMax: base.season.floorMax, floors, ranking, presets: compatiblePresets(catalog, spec.donorPvpId),
    assets: { points: base.season.points, floorRewards: rw.season.floorRewards, rankingRewards: rw.season.rankingRewards } };
}

// ---- Ninja Road rewards: server rows and client display rows are kept apart and labeled by source
export function roadRewards(tpl) {
  const own = new Set(tpl.maps.map(m => Number(m.id)));
  const server = (tpl.clearRewards && tpl.clearRewards.rewardList) || [];
  const sm = (tpl.serverStage && tpl.serverStage.missions && tpl.serverStage.missions[0]) || {};
  const client = (tpl.mission && tpl.mission.missionInfo && tpl.mission.missionInfo.mapClearReward) || [];
  return { server: server.filter(r => own.has(r.mapId)), serverMission: (sm.mapClearRewards || []).filter(r => own.has(r.mapId)), client: client.filter(r => own.has(r.mapId)),
    clientElsewhere: client.filter(r => !own.has(r.mapId)).length, missionClear: sm.missionClearComplete || (tpl.mission && tpl.mission.missionInfo && tpl.mission.missionInfo.missionClearComplete) || null };
}
export function rewardBundle(r) { // a game reward record -> readable parts
  if (!r) return []; const out = [];
  for (const [f, label] of [['jewel', 'Ninja Pearls'], ['coin', 'Ryo'], ['fp', 'Friend points'], ['gemNormal', 'Cat Granny coins'], ['battleSkipBill', 'Skip tickets']]) if (r[f]) out.push({ key: f, label, qty: r[f] });
  for (const u of r.units || []) if (u.unitId) out.push({ key: 'item', label: 'Item', unitId: String(u.unitId), qty: u.unitNum, level: u.unitLv, plus: { s: u.plus_s, a: u.plus_a, d: u.plus_d, sp: u.plus_sp } });
  return out;
}

// ---- the one-active rule for Road and Castle, through the adapter
export function applyEnabled(records, localId, on) {
  const specs = records.map(r => ({ localId: r.localId, profile: r.profile, enabled: r.enabled !== false }));
  const next = SM.setEnabled(specs, localId, on); return Object.fromEntries(next.map(s => [s.localId, s.enabled !== false]));
}

/* ---- the game pack. candidates: [{ kind, slot, name, spec|null, why, exported }] in pack order.
   Default: only configured, enabled definitions. includeDisabled: enabled plus the disabled ones picked
   (pick defaults to definitions this browser exported before, since a never-imported disabled definition
   would still take a permanent slot on the phone). Returns { files, included, leftOut, error }. */
export function planExport(catalog, candidates, { includeDisabled = false, pick = null } = {}) {
  const included = [], leftOut = [], valid = [];
  for (const c of candidates) {
    if (!c.spec) { leftOut.push({ ...c, why: c.why || 'Not configured' }); continue; }
    const bad = contractProblem(catalog, c.spec); if (bad) { leftOut.push({ ...c, why: 'Can’t export: ' + bad }); continue; }
    if (c.spec.enabled === false) {
      if (!includeDisabled) { leftOut.push({ ...c, why: 'Switched off (disabled)' }); continue; }
      const want = pick ? pick(c) : !!c.exported;
      if (!want) { leftOut.push({ ...c, why: 'Switched off and never exported from here, so a phone probably doesn’t have it (sending it would still take a permanent slot)', optional: true }); continue; }
    }
    valid.push(c);
  }
  for (const k of KIND_LIST) { const n = valid.filter(c => c.kind === k).length; if (n > KINDS[k].capacity) return { files: null, included: [], leftOut, error: `${n} ${KINDS[k].label} definitions; the app holds ${KINDS[k].capacity}.` }; }
  if (!valid.some(c => includeDisabled || c.spec.enabled !== false)) return { files: null, included: [], leftOut, error: includeDisabled ? 'Nothing to send: no configured definitions are picked.' : 'Nothing to export: no configured definition is switched on.' };
  let files; try { files = SM.exportFiles(catalog, valid.map(c => c.spec), { includeDisabled }); } catch (e) { return { files: null, included: [], leftOut, error: e.message }; }
  const order = JSON.parse(files['forge-mod.json']).stages; let i = 0;
  for (const c of valid) { if (!includeDisabled && c.spec.enabled === false) continue; included.push({ ...c, path: order[i++] }); }
  return { files, included, leftOut, error: null };
}
/** the ZIP members, in order: forge-mod.json first, then its stages/*.json, nothing else */
export function packMembers(files) {
  const man = JSON.parse(files['forge-mod.json']); const names = ['forge-mod.json', ...man.stages];
  if (Object.keys(files).length !== names.length || names.some(n => typeof files[n] !== 'string')) throw new Error('Pack files don’t match forge-mod.json.');
  return names.map(n => ({ name: n, text: files[n] }));
}

// ---- importing game files: split a definition into its installable spec and any extra fields
const SPEC_KEYS = { layout: ['format', 'schema', 'profile', 'localId', 'name', 'enabled', 'donorMissionId', 'maps'], castle: ['format', 'schema', 'profile', 'localId', 'name', 'enabled', 'donorPvpId', 'rewardPvpId', 'pointScale'] };
export function splitDefinition(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'Not a stage definition.' };
  const kind = kindOfProfile(j.profile);
  if (!kind) return { error: j.format === 'ForgeStage' && j.schema === 1 ? 'draft' : `Unknown stage profile ${JSON.stringify(j.profile || null)}.` };
  const keys = SPEC_KEYS[kind === 'castle' ? 'castle' : 'layout'], spec = {}, extra = {};
  for (const [k, v] of Object.entries(j)) (keys.includes(k) ? spec : extra)[k] = v;
  if (kind !== 'castle' && Array.isArray(spec.maps)) spec.maps = spec.maps.map((m, i) => { if (!m || typeof m !== 'object') return m; const o = {}; for (const [k, v] of Object.entries(m)) { if (k === 'donorMapId' || k === 'markers') o[k] = v; else ((extra.mapFields = extra.mapFields || {})[i] = extra.mapFields[i] || {})[k] = v; } return o; });
  return { kind, spec, extra: Object.keys(extra).length ? extra : null };
}

// ---- projects: saved workspaces from before v2.5.0 (20 Emergency slots) open into the 50-slot layout
export function normalizeWorkspace(ws) {
  if (!ws || ws.format !== 'ForgeStageWorkspace' || ![1, 2].includes(ws.schema) || !Array.isArray(ws.slots)) return null;
  const cap = KINDS.emergency.capacity, out = { schema: 2, emergency: [], road: [], castle: [], drafts: ws.drafts || {}, ids: ws.ids || {}, ledger: ws.ledger || null, projects: ws.projects || [], exported: ws.exported || {} };
  for (const s of ws.slots) if (Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= cap) out.emergency.push({ slot: s.slot, stage: s.stage || null });
  for (const s of (ws.roadSlots || [])) if (Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= KINDS.road.capacity) out.road.push({ slot: s.slot, stage: s.stage || null });
  for (const s of (ws.castleSlots || [])) if (Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= KINDS.castle.capacity) out.castle.push({ slot: s.slot, record: s.record || null });
  out.pre250 = ws.schema === 1;
  return out;
}
export { copy as clone };
