/* Stage rewards and banners for custom Emergency, Ninja Road and Phantom Castle slots.

   One module for both sides of the import:
   - the website validates and writes the installable definitions with it (validateDefinition, fromDraft, toDraft);
   - the app side follows compile*(): given the template's own client/server rows (the authoring catalog holds
     exact copies) and the IDs the app allocated, it returns the rows the build must write. tests/rewards.test.mjs
     pins that output with golden files, so a port to another language can be diffed against it.

   Profiles (additive; the layout-only schema-2 / castle schema-1 files stay valid and unchanged):
     ForgeStage  schema 3  emergency/2, ninja-road/2   = schema-2 layout fields + optional rewards + optional banner
     ForgeCastle schema 2  phantom-castle/2             = schema-1 fields + optional rewards
     ForgeStagePack schema 2 manifest                   = stages/*.json plus banners/*.png
   Every rewards key is optional. A key that's present replaces that part of the template's rewards completely;
   a key that's absent keeps the template's. Re-importing a definition without rewards puts the template's back. */

export const STAGE_PROFILES = { emergency: 'emergency/2', road: 'ninja-road/2' };
export const CASTLE_PROFILE = 'phantom-castle/2';
export const LAYOUT_PROFILES = { emergency: 'emergency-layout/1', road: 'ninja-road-layout/1', castle: 'phantom-castle/1' };
export const kindOfProfile = p => p === STAGE_PROFILES.emergency || p === LAYOUT_PROFILES.emergency ? 'emergency' : p === STAGE_PROFILES.road || p === LAYOUT_PROFILES.road ? 'road' : p === CASTLE_PROFILE || p === LAYOUT_PROFILES.castle ? 'castle' : null;

export const LIMITS = { exp: 99999999, ryo: 99999999, currency: 99999999, firstClear: 9999, quantity: 999, level: 999, plus: 999, items: 4, challenges: 3, chance: 1000,
  bannerWidth: 680, bannerHeight: 320, bannerBytes: 1024 * 1024, packBytes: 16 * 1024 * 1024 };
// reward record fields <-> castle event codes <-> names used in the definitions
export const CURRENCIES = [
  { key: 'pearls', field: 'jewel', code: 2, label: 'Ninja Pearls', draft: 'jewel' },
  { key: 'ryo', field: 'coin', code: 6, label: 'Ryo', draft: 'coin' },
  { key: 'friendPoints', field: 'fp', code: 7, label: 'Friend points', draft: 'fp' },
  { key: 'catGrannyCoins', field: 'gemNormal', code: 3, label: 'Cat Granny coins', draft: 'gemNormal' },
  { key: 'skipTickets', field: 'battleSkipBill', code: 11, label: 'Skip tickets', draft: 'skip' }];
// challenge conditions the game's own missions use (state, sign); value/limited meaning per kind
export const CHALLENGES = [
  { state: 3, sign: 3, key: 'turns', value: [1, 999], text: v => `Complete within ${v} turns` },
  { state: 9, sign: 0, key: 'element', limited: [0, 4], text: (v, l) => `${['Heart', 'Skill', 'Body', 'Bravery', 'Wisdom'][l[0]]} elementals only` },
  { state: 10, sign: 3, key: 'cost', value: [1, 999], text: v => `Character cost ${v} or lower only` },
  { state: 1, sign: 0, key: 'nocontinue', text: () => 'No continues allowed' },
  { state: 2, sign: 0, key: 'nojutsu', text: () => 'No Ninjutsu allowed' },
  { state: 4, sign: 0, key: 'noheal', text: () => 'No healing allowed' },
  { state: 7, sign: 3, key: 'nostatus', text: () => "Don't get hit by status ailments" },
  { state: 15, sign: 3, key: 'all', text: () => 'Defeat all enemies' },
  { state: 12, sign: 4, key: 'combo', value: [2, 6], text: v => `Reduce the boss' HP to 0 using a ${v} person Combination` },
  { state: 14, sign: 4, key: 'bossjutsu', fixed: 1, text: () => "Reduce the boss' HP to 0 using Ninjutsu" },
  { state: 23, sign: 4, key: 'hits', value: [1, 999], text: v => `Complete with ${v} or more hits` },
  { state: 24, sign: 4, key: 'multi', value: [1, 99], text: v => `Defeat ${v} or more enemies simultaneously (excludes F Skills)` },
  { state: 22, sign: 0, key: 'affiliation', limitedOf: [0, 1, 13], text: (v, l) => `Use only ${{ 0: 'Hidden Leaf', 1: 'Mist', 13: 'Uchiha Clan' }[l[0]]} characters` },
  { state: 13, sign: 0, key: 'multiplayer', text: () => 'Complete a mission in multiplayer' }];
export const challengeKind = c => CHALLENGES.find(t => t.state === c.state && t.sign === c.sign) || null;

export class RewardError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, msg) => { throw new RewardError(code, msg); };
const need = (ok, code, msg) => { if (!ok) fail(code, msg); };
const clone = x => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const int = (v, lo, hi, what) => need(Number.isSafeInteger(v) && v >= lo && v <= hi, 'REWARD_NUMBER', `${what}: whole number ${lo.toLocaleString('en-US')}–${hi.toLocaleString('en-US')}.`);
const onlyKeys = (o, keys, what) => { need(isObj(o), 'REWARD_FORMAT', `${what} must be an object.`); for (const k of Object.keys(o)) need(keys.includes(k), 'REWARD_FIELD', `${what}: unknown field "${k}".`); };
const ID_RE = /^[1-9]\d{0,9}$/;

/* ---- items. `items` maps an item ID to { bonus: [hp, atk, def, speed], type3 }. Stat pills (HP / ATK / Speed
   boosts) have a non-zero bonus; that bonus is what the pill does, so it always travels with the item. */
export function itemInfo(items, id) { const i = items && items[String(id)]; return i ? { bonus: i.bonus || [0, 0, 0, 0], type3: i.type3 ?? 0 } : null; }
export const plusOf = b => ({ hp: b[0] || 0, atk: b[1] || 0, def: b[2] || 0, speed: b[3] || 0 });
const PLUS_KEYS = ['hp', 'atk', 'def', 'speed'];
function checkItem(it, items, what, { quantity = true } = {}) {
  onlyKeys(it, quantity ? ['id', 'quantity', 'level', 'luck', 'plus'] : ['id', 'level', 'luck', 'plus'], what);
  need(typeof it.id === 'string' && ID_RE.test(it.id), 'REWARD_ITEM', `${what}: item IDs are decimal strings.`);
  const info = itemInfo(items, it.id); need(info, 'REWARD_ITEM', `${what}: item ${it.id} isn't an item the game can give.`);
  if (quantity) int(it.quantity, 1, LIMITS.quantity, `${what} quantity`);
  if (it.level !== undefined) int(it.level, 1, LIMITS.level, `${what} level`);
  if (it.luck !== undefined) int(it.luck, 0, 99, `${what} luck`);
  if (it.plus !== undefined) { onlyKeys(it.plus, PLUS_KEYS, `${what} bonuses`); for (const k of PLUS_KEYS) if (it.plus[k] !== undefined) int(it.plus[k], 0, LIMITS.plus, `${what} +${k}`);
    if (info.bonus.some(Boolean)) need(same(fullPlus(it, info), plusOf(info.bonus)), 'REWARD_BONUS', `${what}: item ${it.id} always carries ${bonusText(info.bonus)}; its bonuses can't be changed.`); }
}
const fullPlus = (it, info) => it.plus ? { hp: it.plus.hp || 0, atk: it.plus.atk || 0, def: it.plus.def || 0, speed: it.plus.speed || 0 } : plusOf(info.bonus);
export const bonusText = b => [['HP', b[0]], ['ATK', b[1]], ['DEF', b[2]], ['Speed', b[3]]].filter(x => x[1]).map(([k, v]) => `+${v} ${k}`).join(' ');
function checkReward(r, items, what) {
  onlyKeys(r, [...CURRENCIES.map(c => c.key), 'items'], what);
  for (const c of CURRENCIES) if (r[c.key] !== undefined) int(r[c.key], 1, LIMITS.currency, `${what} ${c.label}`);
  if (r.items !== undefined) { need(Array.isArray(r.items), 'REWARD_FORMAT', `${what}: items must be a list.`); need(r.items.length <= LIMITS.items, 'REWARD_TOO_MANY', `${what}: up to ${LIMITS.items} items (a game reward has four item rows).`);
    r.items.forEach((it, i) => checkItem(it, items, `${what} item ${i + 1}`)); }
}

/* ---- the template view: what a definition's rewards replace */
export function templateOf(catalog, kind, donorId) {
  const t = kind === 'emergency' ? catalog.donors[donorId] : kind === 'road' ? catalog.roadDonors[donorId] : catalog.castleDonors[donorId];
  return t || null;
}
export function dropItemsOf(t) { // donor enemy ID -> { item, level } from the template's server candidates
  const o = {}; for (const c of (t.serverMission && t.serverMission.dropCandidates) || []) if (!o[c.enemyId]) o[String(c.enemyId)] = { item: String(c.dropId), level: c.unitLevelMin || 1, row: c }; return o;
}
const enemiesOf = t => new Set(t.maps.flatMap(m => m.sets.flatMap(s => s.raw.enemySet.filter(e => e.id > 0).map(e => String(e.id)))));
const ownMaps = t => t.maps.map(m => String(m.id));
const luckyRow = t => t.drops && t.drops.luckySupported && (t.drops.lucky || []).length === 1 ? t.drops.lucky[0] : null;
export function castleBands(catalog, spec) { const rw = catalog.castleDonors[spec.rewardPvpId || spec.donorPvpId]; return rw ? rw.rankingRewards.map(r => `${r.start}-${r.end}`) : []; }

/* ---- definition validation (website before export; app before allocating anything) */
const STAGE_KEYS2 = ['format', 'schema', 'profile', 'localId', 'name', 'donorMissionId', 'enabled', 'maps'];
const CASTLE_KEYS1 = ['format', 'schema', 'profile', 'localId', 'name', 'donorPvpId', 'rewardPvpId', 'pointScale', 'enabled'];
export function validateRewards(catalog, kind, def, items) {
  const r = def.rewards; if (r === undefined) return;
  if (kind === 'castle') {
    onlyKeys(r, ['floors', 'ranking'], 'rewards'); const base = catalog.castleDonors[def.donorPvpId]; need(base, 'REWARD_FORMAT', 'Unknown base season.');
    if (r.floors !== undefined) { onlyKeys(r.floors, Object.keys(r.floors), 'floor rewards');
      for (const [f, rw] of Object.entries(r.floors)) { need(/^[1-9]\d{0,3}$/.test(f) && +f <= base.season.floorMax, 'REWARD_FLOOR', `Floor ${f} isn't a floor of this castle (1–${base.season.floorMax}).`); checkReward(rw, items, `Floor ${f} reward`); } }
    if (r.ranking !== undefined) { const bands = castleBands(catalog, def); need(isObj(r.ranking), 'REWARD_FORMAT', 'ranking must be an object keyed "start-end".');
      for (const [b, rw] of Object.entries(r.ranking)) { need(bands.includes(b), 'REWARD_RANKING', `Ranking band ${b} isn't one of this season's bands (${bands.join(', ')}).`); checkReward(rw, items, `Ranking ${b} reward`); } }
    return;
  }
  const t = templateOf(catalog, kind, def.donorMissionId); need(t, 'REWARD_FORMAT', 'Unknown template.');
  onlyKeys(r, kind === 'emergency' ? ['playerExp', 'unitExp', 'ryo', 'firstClearPearls', 'challenges', 'lucky', 'drops'] : ['playerExp', 'unitExp', 'ryo', 'challenges', 'mapClear', 'roadClear'], 'rewards');
  if (r.playerExp !== undefined) int(r.playerExp, 0, LIMITS.exp, 'Player EXP');
  if (r.unitExp !== undefined) int(r.unitExp, 0, LIMITS.exp, 'Unit EXP');
  if (r.ryo !== undefined) { onlyKeys(r.ryo, ['min', 'max'], 'ryo'); int(r.ryo.min, 0, LIMITS.ryo, 'Lowest Ryo'); int(r.ryo.max, 0, LIMITS.ryo, 'Highest Ryo'); need(r.ryo.min <= r.ryo.max, 'REWARD_NUMBER', 'Lowest Ryo can’t be above highest Ryo.'); }
  if (r.firstClearPearls !== undefined) { need(t.firstClearGroup, 'REWARD_FIRST_CLEAR', 'This template has no first-clear reward.'); int(r.firstClearPearls, 1, LIMITS.firstClear, 'First-clear pearls'); }
  if (r.challenges !== undefined) {
    need(Array.isArray(r.challenges) && r.challenges.length === LIMITS.challenges, 'REWARD_CHALLENGE', `Send all ${LIMITS.challenges} challenges (the game shows three).`);
    r.challenges.forEach((c, i) => { const w = `Challenge ${i + 1}`; onlyKeys(c, ['state', 'sign', 'value', 'limited', 'text', 'reward'], w);
      const k = challengeKind(c); need(k, 'REWARD_CHALLENGE', `${w}: condition (state ${c.state}, sign ${c.sign}) isn't one the game's missions use.`);
      if (k.value) int(c.value, k.value[0], k.value[1], `${w} number`); else need(c.value === (k.fixed || 0), 'REWARD_CHALLENGE', `${w}: value must be ${k.fixed || 0} for this condition.`);
      need(Array.isArray(c.limited), 'REWARD_CHALLENGE', `${w}: limited must be a list.`);
      if (k.limited) need(c.limited.length === 1 && Number.isInteger(c.limited[0]) && c.limited[0] >= k.limited[0] && c.limited[0] <= k.limited[1], 'REWARD_CHALLENGE', `${w}: pick one element.`);
      else if (k.limitedOf) need(c.limited.length === 1 && k.limitedOf.includes(c.limited[0]), 'REWARD_CHALLENGE', `${w}: pick one affiliation.`);
      else need(c.limited.length === 0, 'REWARD_CHALLENGE', `${w}: this condition takes no limited list.`);
      need(typeof c.text === 'string' && c.text.length > 0 && new TextEncoder().encode(c.text).length <= 160 && !/[\u0000-\u001f\u007f]/.test(c.text), 'REWARD_CHALLENGE', `${w}: text is 1–160 UTF-8 bytes without control characters.`);
      checkReward(c.reward, items, `${w} reward`); });
  }
  if (kind === 'emergency') {
    if (r.lucky !== undefined) { need(luckyRow(t), 'REWARD_LUCKY', 'This template has no single lucky reward to change.'); checkItem(r.lucky, items, 'Lucky reward'); }
    if (r.drops !== undefined) { need(isObj(r.drops), 'REWARD_FORMAT', 'drops must be an object keyed by the template’s enemy IDs.'); const own = enemiesOf(t);
      for (const [e, d] of Object.entries(r.drops)) { need(own.has(e), 'REWARD_DROP', `Enemy ${e} isn't in this template.`); onlyKeys(d, ['item', 'chancePerThousand'], `Drop of enemy ${e}`);
        int(d.chancePerThousand, 0, LIMITS.chance, `Drop chance of enemy ${e}`);
        if (d.item !== null) { need(d.item !== undefined, 'REWARD_DROP', `Drop of enemy ${e}: item is required (null for no drop).`); checkItem(d.item, items, `Drop of enemy ${e}`, { quantity: false }); }
        else need(d.chancePerThousand === 0, 'REWARD_DROP', `Enemy ${e} has a drop chance but no item.`); } }
    if (r.drops) { const probe = { client: {}, server: {} }; compileDrops(t, r.drops, items, standardAlloc('emergency', 1), probe); need(probe.server.drops.normalUnits.length <= 3, 'REWARD_DROP', 'Edited drops support at most three distinct normal items. Reduce other drops or retain the template rewards.'); }
  } else {
    if (r.mapClear !== undefined) { need(isObj(r.mapClear), 'REWARD_FORMAT', 'mapClear must be an object keyed by the template’s map IDs.'); const own = ownMaps(t);
      for (const [m, rw] of Object.entries(r.mapClear)) { need(own.includes(m), 'REWARD_MAP', `Map ${m} isn't one of this Road's maps.`); checkReward(rw, items, `Map ${m} clear reward`); } }
    if (r.roadClear !== undefined) checkReward(r.roadClear, items, 'Road clear reward');
  }
}
export function validateBanner(def) {
  if (def.banner === undefined) return;
  onlyKeys(def.banner, ['file', 'sha256', 'width', 'height'], 'banner');
  need(typeof def.banner.file === 'string' && /^banners\/[A-Za-z0-9._-]{1,96}\.png$/.test(def.banner.file), 'BANNER_FORMAT', 'banner.file is banners/<name>.png.');
  need(typeof def.banner.sha256 === 'string' && /^[0-9a-f]{64}$/.test(def.banner.sha256), 'BANNER_FORMAT', 'banner.sha256 is the PNG’s lowercase SHA-256.');
  need(def.banner.width === LIMITS.bannerWidth && def.banner.height === LIMITS.bannerHeight, 'BANNER_SIZE', `Banners are exactly ${LIMITS.bannerWidth}×${LIMITS.bannerHeight}.`);
}
/** structural check of one installable definition with rewards/banner; layout fields are checked by the existing
    layout validator (stage-modes.mjs validate) on the schema-2 / schema-1 view of the same definition. */
export function validateDefinition(catalog, def, items) {
  need(isObj(def), 'REWARD_FORMAT', 'Not a definition.');
  if (def.format === 'ForgeStage') {
    need(def.schema === 3, 'REWARD_FORMAT', 'Rewards and banners need ForgeStage schema 3.'); const kind = kindOfProfile(def.profile);
    need(kind === 'emergency' && def.profile === STAGE_PROFILES.emergency || kind === 'road' && def.profile === STAGE_PROFILES.road, 'REWARD_FORMAT', `Profile is ${STAGE_PROFILES.emergency} or ${STAGE_PROFILES.road}.`);
    onlyKeys(def, [...STAGE_KEYS2, 'rewards', 'banner'], 'definition'); validateRewards(catalog, kind, def, items); validateBanner(def); return kind;
  }
  if (def.format === 'ForgeCastle') {
    need(def.schema === 2 && def.profile === CASTLE_PROFILE, 'REWARD_FORMAT', `Castle rewards need ForgeCastle schema 2, profile ${CASTLE_PROFILE}.`);
    onlyKeys(def, [...CASTLE_KEYS1, 'rewards'], 'definition'); validateRewards(catalog, 'castle', def, items); return 'castle';
  }
  fail('REWARD_FORMAT', 'Not a ForgeStage or ForgeCastle definition.');
}
/** the same definition in the layout-only format the existing validator and app 2.5 understand */
export function layoutView(def) {
  if (def.format === 'ForgeCastle') { const o = { ...def, schema: 1, profile: LAYOUT_PROFILES.castle }; delete o.rewards; return o; }
  const o = { ...def, schema: 2, profile: LAYOUT_PROFILES[kindOfProfile(def.profile)] }; delete o.rewards; delete o.banner; return o;
}
/** upgrade a layout-only definition (schema 2 / castle schema 1) to carry rewards and a banner */
export function withRewards(layoutDef, rewards, banner) {
  const kind = kindOfProfile(layoutDef.profile); if (!rewards && !banner) return layoutDef;
  const o = kind === 'castle' ? { ...layoutDef, schema: 2, profile: CASTLE_PROFILE } : { ...layoutDef, schema: 3, profile: STAGE_PROFILES[kind] };
  if (rewards && Object.keys(rewards).length) o.rewards = rewards; if (banner && kind !== 'castle') o.banner = banner; return o;
}

/* ---- pack manifest (schema 2). Lists every stage file and every banner; nothing else may be in the ZIP. */
export function packManifest(stageFiles, bannerFiles) {
  return { format: 'ForgeStagePack', schema: 2, stages: stageFiles.slice(), ...(bannerFiles.length ? { banners: bannerFiles.slice() } : {}) };
}
export function validatePack(names, manifest, defs) {
  need(isObj(manifest) && manifest.format === 'ForgeStagePack' && (manifest.schema === 1 || manifest.schema === 2), 'PACK_FORMAT', 'forge-mod.json is a ForgeStagePack manifest.');
  onlyKeys(manifest, manifest.schema === 2 ? ['format', 'schema', 'stages', 'banners'] : ['format', 'schema', 'stages'], 'forge-mod.json');
  const st = manifest.stages || [], bn = manifest.banners || [];
  need(Array.isArray(st) && st.length >= 1 && st.length <= 70 && new Set(st).size === st.length, 'PACK_FORMAT', 'List 1–70 unique stage files.');
  need(Array.isArray(bn) && new Set(bn).size === bn.length, 'PACK_FORMAT', 'Banner files are unique.');
  for (const f of st) need(/^stages\/[A-Za-z0-9._-]{1,96}\.json$/.test(f), 'PACK_FORMAT', `Bad stage path ${f}.`);
  for (const f of bn) need(/^banners\/[A-Za-z0-9._-]{1,96}\.png$/.test(f), 'PACK_FORMAT', `Bad banner path ${f}.`);
  const want = new Set(['forge-mod.json', ...st, ...bn]); for (const n of names) need(want.has(n), 'PACK_FORMAT', `Unexpected file ${n} in the pack.`);
  for (const f of want) need(names.includes(f), 'PACK_FORMAT', `${f} is listed but missing.`);
  const used = new Set(); for (const d of defs || []) if (d.banner) { need(bn.includes(d.banner.file), 'BANNER_MISSING', `${d.localId}: ${d.banner.file} isn't in the pack.`); used.add(d.banner.file); }
  for (const f of bn) need(used.has(f), 'PACK_FORMAT', `${f} isn't used by any definition.`);
}
/** a banner file: PNG signature, IHDR size and SHA-256 must match the definition */
export function pngSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v) || String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
export async function checkBannerBytes(def, bytes, sha256Hex) {
  const sz = pngSize(bytes); need(sz, 'BANNER_FORMAT', `${def.banner.file} isn't a PNG.`);
  need(sz.width === LIMITS.bannerWidth && sz.height === LIMITS.bannerHeight, 'BANNER_SIZE', `${def.banner.file} is ${sz.width}×${sz.height}; banners are ${LIMITS.bannerWidth}×${LIMITS.bannerHeight}.`);
  need(bytes.length <= LIMITS.bannerBytes, 'BANNER_SIZE', `${def.banner.file} is over 1 MB.`);
  need(await sha256Hex(bytes) === def.banner.sha256, 'BANNER_HASH', `${def.banner.file} doesn't match its SHA-256.`);
}

/* ---- website drafts <-> definitions. Draft parts: {key:'jewel'|'coin'|'fp'|'gemNormal'|'skip', qty} and
   {key:'item', unitId, qty, level?}. Draft rewards: forge-modes templateRewards() shape. */
export function rewardFromParts(parts, items) {
  const r = {}, its = [];
  for (const p of parts || []) {
    if (p.key === 'item') { const info = itemInfo(items, p.unitId); its.push({ id: String(p.unitId), quantity: p.qty, level: p.level || 1, plus: plusOf(p.plus ? [p.plus.s || 0, p.plus.a || 0, p.plus.d || 0, p.plus.sp || 0] : info ? info.bonus : [0, 0, 0, 0]) }); continue; }
    const c = CURRENCIES.find(x => x.draft === p.key); if (c && p.qty) r[c.key] = (r[c.key] || 0) + p.qty;
  }
  if (its.length) r.items = its; return r;
}
export function partsFromReward(r) {
  const out = []; for (const c of CURRENCIES) if (r && r[c.key]) out.push({ key: c.draft, qty: r[c.key] });
  for (const it of (r && r.items) || []) out.push({ key: 'item', unitId: it.id, qty: it.quantity, level: it.level || 1 });
  return out;
}
const dropItem = (id, level, items) => ({ id: String(id), level: level || 1, plus: plusOf((itemInfo(items, id) || { bonus: [0, 0, 0, 0] }).bonus) });
/** the rewards block for a draft: only the parts that differ from the template (null when nothing does) */
export function fromDraft(kind, base, r, items, t) {
  if (!r || same(r, base)) return null; const o = {};
  if (r.exp !== base.exp) o.playerExp = r.exp;
  if (r.unitExp !== base.unitExp) o.unitExp = r.unitExp;
  if (!same(r.coins, base.coins)) o.ryo = { min: r.coins[0], max: r.coins[1] };
  if (!same(r.challenges, base.challenges)) o.challenges = r.challenges.map((c, i) => { const k = challengeKind(c);
    return { state: c.state, sign: c.sign, value: c.value, limited: c.limited.slice(), text: k ? k.text(c.value, c.limited) : c.sourceText || (base.challenges[i] && base.challenges[i].sourceText) || `Challenge ${i + 1}`, reward: rewardFromParts(c.reward, items) }; });
  if (kind === 'emergency') {
    if (r.firstClear != null && r.firstClear !== base.firstClear) o.firstClearPearls = r.firstClear;
    if (r.lucky && !same(r.lucky, base.lucky)) o.lucky = { id: String(r.lucky.unitId), quantity: r.lucky.qty, level: 1, plus: plusOf((itemInfo(items, r.lucky.unitId) || { bonus: [0, 0, 0, 0] }).bonus) };
    const keys = new Set([...Object.keys(base.drops || {}), ...Object.keys(r.drops || {})]), lv = t ? dropItemsOf(t) : {}, dr = {};
    for (const k of keys) { const a = (r.drops || {})[k] || { item: null, chance: 0 }, b = (base.drops || {})[k] || { item: null, chance: 0 };
      if (a.item === b.item && a.chance === b.chance && !a.varies === !b.varies) continue;
      dr[k] = { item: a.item ? dropItem(a.item, a.item === (lv[k] && lv[k].item) ? lv[k].level : 1, items) : null, chancePerThousand: a.item ? a.chance : 0 }; }
    if (Object.keys(dr).length) o.drops = dr;
  } else {
    const keys = new Set([...Object.keys(base.mapClear || {}), ...Object.keys(r.mapClear || {})]), mc = {};
    for (const k of keys) if (!same((r.mapClear || {})[k] || [], (base.mapClear || {})[k] || [])) mc[k] = rewardFromParts((r.mapClear || {})[k] || [], items);
    if (Object.keys(mc).length) o.mapClear = mc;
    if (!same(r.roadClear || [], base.roadClear || [])) o.roadClear = rewardFromParts(r.roadClear || [], items);
  }
  return Object.keys(o).length ? o : null;
}
/** a definition's rewards block back into a full draft rewards object (base + overrides) */
const stripPlus = r => ({ ...r, ...(r.items ? { items: r.items.map(({ plus, ...x }) => x) } : {}) });
const partsLike = (baseParts, reward) => baseParts && same(stripPlus(rewardFromParts(baseParts, null)), stripPlus(reward)) ? clone(baseParts) : partsFromReward(reward);
export function toDraft(kind, base, rw) {
  const r = clone(base); if (!rw) return r;
  if (rw.playerExp !== undefined) r.exp = rw.playerExp; if (rw.unitExp !== undefined) r.unitExp = rw.unitExp; if (rw.ryo) r.coins = [rw.ryo.min, rw.ryo.max];
  if (rw.challenges) r.challenges = rw.challenges.map((c, i) => { const b = base.challenges[i], cond = b && b.state === c.state && b.sign === c.sign && b.value === c.value && same(b.limited, c.limited);
    return { state: c.state, sign: c.sign, value: c.value, limited: c.limited.slice(), reward: partsLike(b && b.reward, c.reward), langId: cond ? b.langId : null, sourceText: cond ? b.sourceText : challengeKind(c) ? null : c.text }; });
  if (kind === 'emergency') {
    if (rw.firstClearPearls !== undefined) r.firstClear = rw.firstClearPearls;
    if (rw.lucky) r.lucky = { unitId: rw.lucky.id, qty: rw.lucky.quantity };
    for (const [k, d] of Object.entries(rw.drops || {})) { r.drops = r.drops || {}; if (!d.item) delete r.drops[k]; else r.drops[k] = { item: d.item.id, chance: d.chancePerThousand, varies: false }; }
  } else {
    for (const [k, p] of Object.entries(rw.mapClear || {})) { r.mapClear = r.mapClear || {}; const parts = partsLike((base.mapClear || {})[k], p); if (parts.length) r.mapClear[k] = parts; else delete r.mapClear[k]; }
    if (rw.roadClear) r.roadClear = partsLike(base.roadClear, rw.roadClear);
  }
  return r;
}
/** castle: website overrides {floors:{floor:parts}, ranking:{index:parts}} <-> definition rewards */
export function castleFromDraft(catalog, spec, ov, items) {
  if (!ov) return null; const o = {}, bands = castleBands(catalog, spec);
  const fl = Object.entries(ov.floors || {}); if (fl.length) o.floors = Object.fromEntries(fl.map(([f, p]) => [String(f), rewardFromParts(p, items)]));
  const rk = Object.entries(ov.ranking || {}); if (rk.length) o.ranking = Object.fromEntries(rk.map(([i, p]) => [bands[+i], rewardFromParts(p, items)]));
  return Object.keys(o).length ? o : null;
}
export function castleToDraft(catalog, spec, rw) {
  if (!rw) return null; const bands = castleBands(catalog, spec), ov = { floors: {}, ranking: {} };
  for (const [f, r] of Object.entries(rw.floors || {})) ov.floors[f] = partsFromReward(r);
  for (const [b, r] of Object.entries(rw.ranking || {})) { const i = bands.indexOf(b); if (i >= 0) ov.ranking[i] = partsFromReward(r); }
  return ov;
}

/* ---- the app side: what each field writes. Inputs are the template's own rows (authoring catalog copies of the
   client and server tables) and the IDs the app already allocated for this localId:
     alloc = { ledgerSlot, stageId, missionId, mapId(i) -> destination map ID, setId(i, j) -> destination enemy-set ID,
               enemyId(donorEnemyId) -> new enemy ID for a cloned enemy definition (only asked when needed),
               stringKey(n) -> a new string key }
   The output lists every row the build writes for rewards and banners, with destination IDs. Layout (markers),
   map and enemy-set cloning stay as the existing importer does them. */
const EMPTY_UNIT = { unitId: 0, unitLv: 1, unitNum: 0, ability: 0, plus_s: 0, plus_a: 0, plus_d: 0, plus_sp: 0, luck: 0, grade: 1 };
/** write a reward into a game reward record (client subMissionReward, sroad rows, castle client rows, ...):
    currencies set (absent = 0), four unit rows rebuilt; every other field of the template's record is kept. */
export function recordFrom(template, reward, items) {
  const rec = clone(template || { ring: 0, name: '_', langId: '_', title: '_', langId2: '_', jewel: 0, coin: 0, fp: 0, gemNormal: 0, gemRare: 0, gemSpecial: 0, units: [], g_ticket_id: 0, g_ticket_num: 0, gem_limited_id: 0, gem_limited_num: 0, lottery_id: 0, lottery_num: 0, battleSkipBill: 0 });
  for (const c of CURRENCIES) if (c.field in rec || reward[c.key]) rec[c.field] = reward[c.key] || 0;
  const units = (reward.items || []).map(it => { const info = itemInfo(items, it.id), p = fullPlus(it, info);
    return { ...EMPTY_UNIT, unitId: Number(it.id), unitLv: it.level || 1, unitNum: it.quantity, plus_s: p.hp, plus_a: p.atk, plus_d: p.def, plus_sp: p.speed, luck: it.luck ?? 0 }; });
  while (units.length < 4) units.push({ ...EMPTY_UNIT }); rec.units = units; return rec;
}
/** write a reward as castle server events: currencies first ([code, amount]), then items
    [1, quantity, itemId, level, ability, luck, plusHp, plusAtk, plusDef, plusSpeed, grade]; luck defaults to 1 here (the
    stock events' value) and to 0 in reward records (theirs) */
export function eventsFrom(reward, items) {
  const ev = []; for (const c of [CURRENCIES[0], CURRENCIES[3], CURRENCIES[1], CURRENCIES[2], CURRENCIES[4]]) if (reward[c.key]) ev.push([c.code, reward[c.key]]);
  for (const it of reward.items || []) { const p = fullPlus(it, itemInfo(items, it.id)); ev.push([1, it.quantity, Number(it.id), it.level || 1, 0, it.luck ?? 1, p.hp, p.atk, p.def, p.speed, 1]); }
  return ev;
}
function challengeRows(t, rw, items, alloc, strings) {
  const src = t.mission.missionInfo.subMission;
  return rw.challenges.map((c, i) => { const b = src[i], sameCond = b && b.state === c.state && b.sign === c.sign && b.value === c.value && same(b.limited.flatMap((x, j) => x ? [j] : []), c.limited);
    const row = clone(b); row.id = i + 1; row.state = c.state; row.sign = c.sign; row.value = c.value;
    row.limited = Array.from({ length: (b && b.limited.length) || 300 }, (_, j) => c.limited.includes(j));
    if (!sameCond) { const key = alloc.stringKey(i + 1); strings[key] = c.text; row.langSubMissionNameId = key; row.name = c.text; }
    row.subMissionReward = recordFrom(b && b.subMissionReward, c.reward, items); return row; });
}
export function compileStage(catalog, def, items, alloc) {
  validateDefinition(catalog, def, items); const kind = kindOfProfile(def.profile), t = templateOf(catalog, kind, def.donorMissionId), rw = def.rewards || {};
  const out = { localId: def.localId, profile: def.profile, destination: { ledgerSlot: alloc.ledgerSlot, stageId: Number(alloc.stageId), missionId: Number(alloc.missionId) }, client: {}, server: {}, strings: {} };
  const mi = t.mission.missionInfo, cm = out.client.missionInfo = {}, sm = out.server.mission = {};
  if (rw.playerExp !== undefined) { cm.exp = rw.playerExp; sm.experience = rw.playerExp; }
  if (rw.unitExp !== undefined) { cm.charaExp = rw.unitExp; sm.characterExperience = rw.unitExp; }
  if (rw.ryo) { cm.minCoin = rw.ryo.min; cm.maxCoin = rw.ryo.max; sm.minimumCoin = rw.ryo.min; sm.maximumCoin = rw.ryo.max; }
  if (rw.challenges) { cm.subMission = challengeRows(t, rw, items, alloc, out.strings); out.server.objectives = clone(cm.subMission); }
  if (def.banner) { out.client.stage = { imageId: Number(alloc.stageId) }; out.server.stage = { imageId: Number(alloc.stageId) }; out.banner = { imageId: Number(alloc.stageId), file: def.banner.file, sha256: def.banner.sha256, width: def.banner.width, height: def.banner.height }; }
  if (kind === 'emergency') {
    if (rw.firstClearPearls !== undefined) { out.client.stage = { ...(out.client.stage || {}), rewardJewel: rw.firstClearPearls }; out.server.firstClearGroup = { missionIds: [Number(alloc.missionId)], reward: rw.firstClearPearls }; }
    if (rw.lucky) { const L = clone(luckyRow(t)), p = fullPlus(rw.lucky, itemInfo(items, rw.lucky.id)); Object.assign(L, { chara_id: Number(rw.lucky.id), num: rw.lucky.quantity, chara_level: rw.lucky.level || 1, plus_s: p.hp, plus_a: p.atk, plus_d: p.def, plus_sp: p.speed }); if (rw.lucky.luck !== undefined) L.luck = rw.lucky.luck;
      out.server.drops = { lucky: [L] }; const ld = clone(mi.missionDropComplete.luckDropRewards); ld[0].units[0] = { ...ld[0].units[0], unitId: L.chara_id, unitNum: L.num, unitLv: L.chara_level, plus_s: L.plus_s, plus_a: L.plus_a, plus_d: L.plus_d, plus_sp: L.plus_sp, luck: L.luck };
      cm.missionDropComplete = { luckDropRewards: ld }; }
    if (rw.drops) compileDrops(t, rw.drops, items, alloc, out);
  } else {
    if (rw.mapClear) { const rows = clone((t.clearRewards && t.clearRewards.rewardList) || []).filter(r => ownMaps(t).includes(String(r.mapId))), byMap = new Map(rows.map(r => [String(r.mapId), r]));
      const result = []; t.maps.forEach((m, i) => { const r = byMap.get(String(m.id)), edit = rw.mapClear[String(m.id)];
        if (edit !== undefined) { if (edit.items || CURRENCIES.some(c => edit[c.key])) result.push({ mapId: alloc.mapId(i), reward: [recordFrom(r && r.reward[0], edit, items)] }); }
        else if (r) result.push({ mapId: alloc.mapId(i), reward: r.reward }); });
      out.client.sroadMapClearRewards = result; out.server.sroadRewards = clone(result); }
    if (rw.roadClear) { const sm0 = (t.serverStage.missions || [])[0] || {}; cm.missionClearComplete = recordFrom(mi.missionClearComplete, rw.roadClear, items); out.server.missionClearComplete = recordFrom(sm0.missionClearComplete || mi.missionClearComplete, rw.roadClear, items); }
  }
  if (!Object.keys(out.client.missionInfo).length) delete out.client.missionInfo; if (!Object.keys(out.server.mission).length) delete out.server.mission;
  return out;
}
/* Emergency drops. Per listed template enemy E, in this mission's cloned enemy sets only:
   - every placement of E gets dropRate = chancePerThousand;
   - when the item (or its level/bonuses) differs from E's own definition, E is cloned to a new enemy ID (enemy
     definitions are shared with the stock missions, so the original row is never edited) with dropId,
     dropUnitLevelMin/Max and dropPlus_* set; this mission's placements and dependencies point at the clone;
   - item null: dropRate 0.
   Then the server candidates are rebuilt from the result, one row per placement with dropRate > 0 and a drop item
   (the template's rule), and normalUnits / client dropUnits list the distinct drop items in order. */
function compileDrops(t, drops, items, alloc, out) {
  const base = dropItemsOf(t), clones = {}, defs = {}; let deps = t.dependencies.enemyUnitIds.slice();
  for (const [e, d] of Object.entries(drops)) { const b = base[e];
    if (d.item) { const lv = d.item.level || 1, p = fullPlus(d.item, itemInfo(items, d.item.id)), bp = b ? { hp: b.row.plusS, atk: b.row.plusA, def: b.row.plusD, speed: b.row.plusSp } : null;
      const keep = b && b.item === d.item.id && b.level === lv && same(bp, p);
      const id = keep ? Number(e) : alloc.enemyId(Number(e));
      if (!keep) { clones[e] = id; out.client.enemyClones = out.client.enemyClones || []; out.client.enemyClones.push({ from: Number(e), to: id, set: { dropId: Number(d.item.id), dropUnitLevelMin: lv, dropUnitLevelMax: lv, dropPlus_s: p.hp, dropPlus_a: p.atk, dropPlus_d: p.def, dropPlus_sp: p.speed } }); deps = deps.map(x => x === Number(e) ? id : x); }
      defs[id] = { dropId: Number(d.item.id), level: lv, plus: p, row: b && b.row }; } }
  const sets = {}, cands = []; const bandRow = id => defs[id] || (base[String(id)] ? { dropId: Number(base[String(id)].item), level: base[String(id)].level, plus: { hp: base[String(id)].row.plusS, atk: base[String(id)].row.plusA, def: base[String(id)].row.plusD, speed: base[String(id)].row.plusSp }, row: base[String(id)].row } : null);
  t.maps.forEach((m, i) => m.sets.forEach((s, j) => { let touched = false; const entries = s.raw.enemySet.map(en => { const d = drops[String(en.id)]; if (!d) return en; touched = true;
      return { ...en, id: clones[String(en.id)] || en.id, dropRate: d.item ? d.chancePerThousand : 0 }; });
    if (touched) sets[alloc.setId(i, j)] = entries;
    for (const en of entries) { if (!(en.id > 0) || !(en.dropRate > 0)) continue; const src = Object.keys(clones).find(k => clones[k] === en.id), info = bandRow(en.id) || (src ? bandRow(Number(src)) : null); if (!info) continue;
      const r = info.row || {}; cands.push({ mapId: alloc.mapId(i), enemySetId: alloc.setId(i, j), enemyId: en.id, dropId: info.dropId, unitType3: (itemInfo(items, info.dropId) || { type3: r.unitType3 || 0 }).type3,
        chancePerThousand: en.dropRate, enemyCount: en.count, unitLevelMin: info.level, unitLevelMax: info.level, luck: r.luck || 0, skillLevel: r.skillLevel || 0, ability: r.ability || 0,
        plusS: info.plus.hp, plusA: info.plus.atk, plusD: info.plus.def, plusSp: info.plus.speed }); } }));
  out.client.enemySets = sets; out.client.dependencies = { enemyUnitIds: deps };
  const units = [...new Set(cands.map(c => c.dropId))];
  out.server.mission = { ...(out.server.mission || {}), dropCandidates: cands }; out.server.drops = { ...(out.server.drops || {}), normalUnits: units };
  out.client.missionInfo = { ...(out.client.missionInfo || {}), missionDropComplete: { ...((out.client.missionInfo || {}).missionDropComplete || {}), dropUnits: units } };
}
/* Castle. The season keeps the base season's points and opponents. Edited floors/bands are written into the
   slot season's own copies of the reward-preset tables (never into a stock PvPReward / PvPRankingReward table):
   server floor events and ranking events, plus the client arenaFloorRewards / arenaRankingRewards rows. */
export function compileCastle(catalog, def, items, alloc) {
  validateDefinition(catalog, def, items); const rw = def.rewards || {}, src = catalog.castleDonors[def.rewardPvpId || def.donorPvpId];
  const out = { localId: def.localId, profile: def.profile, destination: { ledgerSlot: alloc.ledgerSlot, pvpId: Number(alloc.pvpId) }, server: {}, client: {} };
  if (rw.floors) { const ev = clone(src.floorRewards), rows = clone(src.arena.arenaFloorRewards), byFloor = new Map(rows.map(r => [String(r.floor), r]));
    for (const [f, r] of Object.entries(rw.floors)) { const empty = !r.items && !CURRENCIES.some(c => r[c.key]);
      if (empty) { delete ev[f]; byFloor.delete(f); continue; }
      ev[f] = eventsFrom(r, items); const rec = recordFrom(byFloor.get(f) || { floor: +f, feature: false, name: '_', langId: '_', title: '_', langId2: '_', jewel: 0, coin: 0, fp: 0, gemNormal: 0, gemRare: 0, gemSpecial: 0, units: [] }, r, items); rec.floor = +f; byFloor.set(f, rec); }
    out.server.floorRewards = Object.fromEntries(Object.entries(ev).sort((a, b) => a[0] - b[0])); out.client.arenaFloorRewards = [...byFloor.values()].sort((a, b) => a.floor - b.floor); }
  if (rw.ranking) { const ev = clone(src.rankingRewards), rows = clone(src.arena.arenaRankingRewards);
    ev.forEach((band, i) => { const r = rw.ranking[`${band.start}-${band.end}`]; if (!r) return; band.events = eventsFrom(r, items); if (rows[i]) rows[i] = recordFrom(rows[i], r, items); });
    out.server.rankingRewards = ev; out.client.arenaRankingRewards = rows; }
  return out;
}
/* Standard destination IDs (README of the v2.5.0 handoff); the app's own allocation stays authoritative. */
export function standardAlloc(kind, slot, opts = {}) {
  const enemyBase = opts.enemyBase ?? 61000000; let n = 0, s = 0; const enemies = new Map();
  if (kind === 'castle') return { ledgerSlot: 60 + slot, pvpId: 9799 + slot };
  const stageId = kind === 'road' ? 8799 + slot : slot <= 20 ? 3799 + slot : 3802 + slot, missionId = kind === 'road' ? 88001 + (slot - 1) * 10 : stageId * 100 + 1;
  return { ledgerSlot: kind === 'road' ? 50 + slot : slot, stageId, missionId, mapId: i => kind === 'road' ? missionId * 100 + i + 1 : missionId * 10 + i + 1, setId: (i, j) => (kind === 'road' ? missionId * 100 + i + 1 : missionId * 10 + i + 1) * 100 + j + 1,
    enemyId: e => { if (!enemies.has(e)) enemies.set(e, enemyBase + (kind === 'road' ? 50 + slot : slot) * 1000 + (++n)); return enemies.get(e); },
    stringKey: i => `forge_stage_${missionId}_objective_${i}` + (s++, '') };
}
