> v2.6.6 app integration: one-time IPA update required; later reward/banner edits use imports. The app pads server normalUnits to exactly three entries and rejects more than three distinct normal drop items. See APP_PROMPT.md for the current integration notes. The original reference compiler below lists only nonzero items. Host checks are separate from phone acceptance.

# Stage rewards and banners — app import contract

Custom **Emergency**, **Ninja Road** and **Phantom Castle** slots. The website (Stages tab › Export › **Rewards and banners**)
writes these files. Apps through 2.6.5 install layouts only and reject the new formats. This
document describes the app update that installs the rewards and banners.

The supplied event quests (stage 3820–3822) aren't part of this contract.

Everything here is additive:

- `ForgeStage` schema 2, `ForgeCastle` schema 1 and `ForgeStagePack` schema 1 stay valid, and their meaning doesn't change.
- A pack may mix old and new definitions.
- The website only writes the new format for definitions that carry reward edits or a banner.

| File | What it is |
| --- | --- |
| `stage-rewards.mjs` | The shared module. The website validates and writes definitions with it. `compileStage` / `compileCastle` are the **reference** for the rows the app writes. |
| `examples/*.json` | One definition per mode, using every field. |
| `examples/pack/`, `examples/Forge-stage-rewards-example.zip` | The same three as a pack with an example 680×320 banner, as a folder and as the ZIP to import. |
| `tests/rewards.test.mjs` | Host tests: validation codes, golden output, the drop-rule check against all 195 Emergency templates, and draft round trips. |
| `tests/golden/*.compiled.json` | What the three examples compile to with the standard IDs. A port must produce the same rows. |
| `tests/browser.test.mjs` | Website flow (speed pills, banner, export, reimport, project save). |

Run them with `node stages/rewards/tests/rewards.test.mjs`. It needs `stages/v250/authoring-catalog.json.gz` and
`tools/data/item-catalog.json` from this repo.

## Pack

```
forge-mod.json        {"format":"ForgeStagePack","schema":2,"stages":["stages/01.json",…],"banners":["banners/<name>.png",…]}
stages/<name>.json    1–70 definitions (old or new formats)
banners/<name>.png    one per definition that has a banner; every listed banner is used by a definition
```

Pack rules:

- No other files are allowed.
- Paths:
  - `stages/[A-Za-z0-9._-]{1,96}.json`
  - `banners/[A-Za-z0-9._-]{1,96}.png`
- The ZIP may be up to **16 MiB** expanded when it carries banners (2 MiB otherwise, as before).
- Validate the whole pack before allocating anything, as the 2.5 importer does.

## Definitions

### Emergency / Ninja Road — `ForgeStage` schema 3

These carry the same fields as schema 2: `format`, `schema`, `profile`, `localId`, `name`, `donorMissionId`, `enabled`
and `maps`, with the same layout rules. Only these change or are added:

| Field | Value |
| --- | --- |
| `schema` | `3` |
| `profile` | `emergency/2` or `ninja-road/2` (the same template catalogs as `emergency-layout/1` / `ninja-road-layout/1`) |
| `rewards` | optional, see below |
| `banner` | optional: `{"file":"banners/x.png","sha256":"<64 lowercase hex>","width":680,"height":320}` |

Validate the layout part by turning the definition back into schema 2: drop `rewards` and `banner`, use `schema 2` and
the `-layout/1` profile, then run your existing validator. `layoutView()` in the module does exactly this.

### Phantom Castle — `ForgeCastle` schema 2

The schema-1 fields stay as they are, with `"schema":2`, `"profile":"phantom-castle/2"` and an optional `rewards` block.
Castle has no banner (season rows have no image field).

### `rewards`

Every key is optional:

- A key that's **present replaces that whole part** of the template's rewards.
- A key that's **absent keeps the template's**.
- Re-importing the same `localId` without `rewards` (or as schema 2) restores the template's rewards.
- Removing the banner restores the default image.

| Key | Modes | Value |
| --- | --- | --- |
| `playerExp`, `unitExp` | E, R | 0–99,999,999 |
| `ryo` | E, R | `{ "min": 0–99,999,999, "max": ≥ min }` |
| `firstClearPearls` | E | 1–9,999. Only for templates with a first-clear group (all 195 have one). |
| `challenges` | E, R | Exactly **3**: `{ state, sign, value, limited, text, reward }` (see below) |
| `lucky` | E | Item (below). Only for templates with exactly one lucky row and `luckySupported` (187 of 195). |
| `drops` | E | `{ "<template enemy ID>": { "item": DropItem \| null, "chancePerThousand": 0–1000 } }`. Only enemies that appear in the template; `item: null` requires chance 0. |
| `mapClear` | R | `{ "<template map ID>": Reward }`. Only the Road's own maps; `{}` removes that map's reward. |
| `roadClear` | R | Reward |
| `floors` | C | `{ "<floor 1..floorMax>": Reward }`; `{}` removes that floor's reward |
| `ranking` | C | `{ "<start>-<end>": Reward }`. The band must exist in the season's reward preset (`rewardPvpId`, else `donorPvpId`). |

**Reward** = `{ pearls?, ryo?, friendPoints?, catGrannyCoins?, skipTickets?, items? }`:

- Each currency is 1–99,999,999.
- `items` holds up to 4 Items (a game reward record has four unit rows).

**Item** = `{ id, quantity, level?, luck?, plus? }`:

- `id` is a decimal string of an item in the unit master.
- `quantity` is 1–999. `level` is 1–999 (default 1). `luck` is 0–99.
- `plus` = `{ hp, atk, def, speed }`, each 0–999.

**DropItem** is an Item without `quantity`.

**Stat pills.** The HP, ATK and Speed pills (Health / Attack / Speed Boost: items 11812, 11813, 11822, 11823, 13682 and
13683) do their job only through their bonus (for example, 13683 is +2 Speed).

- When `plus` is omitted, use the item's own default bonuses from the unit master.
- For an item whose defaults are non-zero, a `plus` that differs is an error (`REWARD_BONUS`).
- The website always sends `plus`.

Writing 13683 with `plus_sp = 0` would pay out a pill that does nothing.

**Challenges.**

- `state` / `sign` must be one of the condition kinds the game's own missions use (`CHALLENGES` in the module).
- `value` and `limited` follow that kind:
  - turns 1–999
  - cost 1–999
  - combo 2–6
  - one element: `limited: [0..4]`
  - one affiliation: `limited: [0|1|13]`
  - others: `value 0` (`1` for "finish the boss with Ninjutsu") and `limited: []`
- `text` is the English line to show: 1–160 UTF-8 bytes, no control characters.

**Luck defaults** (when `luck` is absent):

- 0 in reward records (the stock records' value)
- 1 in castle events (the stock events' value)
- the template's value in the lucky row

## What each field writes

All rows are written with the **destination** IDs the importer already allocated. Unchanged parts are written as the
2.5 importer writes them today.

**Never edit a stock row.** Enemy definitions are shared between stock missions, so the drop rules below clone instead.
Castle edits go into the slot season's own table copies.

`compileStage` / `compileCastle` return exactly these rows. The golden files show them for the examples.

### Emergency and Road

| Rewards key | Client | Server |
| --- | --- | --- |
| `playerExp` | mission `missionInfo.exp` | EventMissionCatalog `experience` |
| `unitExp` | `missionInfo.charaExp` | `characterExperience` |
| `ryo` | `missionInfo.minCoin` / `maxCoin` | `minimumCoin` / `maximumCoin` |
| `challenges` | `missionInfo.subMission[0..2]`, rebuilt from the template row at the same index (see below) | the mission's objective rows: an identical copy of the three client rows |
| `firstClearPearls` (E) | stage `rewardJewel` | the slot's own first-clear group `reward` (the group the 2.5 importer already creates for this mission) |
| `lucky` (E) | `missionInfo.missionDropComplete.luckDropRewards[0].units[0]`: `unitId`, `unitNum`, `unitLv`, `plus_*`, `luck` | MissionDrops `lucky[0]`: `chara_id`, `num`, `chara_level`, `plus_s/a/d/sp` (other fields kept) |
| `drops` (E) | enemy-set entries, enemy clones and dependencies, then the drop lists (see below) | `dropCandidates` and `normalUnits` (see below) |
| `mapClear` (R) | `sroadmapclearreward` rows for this mission: `{ mapId, reward:[record] }`, in map order | `sroadRewards`: identical to the client rows |
| `roadClear` (R) | `missionInfo.missionClearComplete` | stage mission `missionClearComplete` |
| `banner` | stage `imageId` = destination **stageId**, with the PNG installed as that image | server stage `imageId` = the same |

Notes on these rows:

- **Challenge rows.** Each new row:
  - takes `id` = 1–3 and `state` / `sign` / `value`;
  - gets `limited` as a 300-long boolean array with `true` at the listed indexes;
  - has its `subMissionReward` written as a record (below).
- **Challenge text.**
  - If the condition equals the template's row at that index, keep its `langSubMissionNameId` / `name`.
  - Otherwise add a string `forge_stage_<missionId>_objective_<n>` = `text` and point the row at it. Use the same
    mechanism as the built-in `forge_collab_objective_*` strings.
- **Drop lists.** Client `missionInfo.missionDropComplete.dropUnits` = server `normalUnits` = the distinct `dropId`s of
  the rebuilt candidates, in order.
  - **At most 3 distinct items.** When `drops` is present, the whole mission (unchanged enemies included) may drop at
    most three different normal items, because the native fallback arrays have exactly three slots. Otherwise reject
    with `REWARD_DROP`. Six stock templates drop more than three; they still import layout-only, and edits that keep
    `drops` out of `rewards` are fine.
  - The app writes server `normalUnits` zero-padded to exactly three entries. The reference compiler lists only the
    real items.
- **Banner image.** Install the PNG as the image with `imageId` = destination stageId. Use the same path the built-in
  event banners use (stages 3820–3822 have `imageId` = their stage ID and a 680×320 banner). Without a banner,
  `imageId` stays the template's (99999, the game default).
- **Road maps.** Maps whose `mapClear` key is absent keep their template row. The importer keeps handling the old
  cumulative `mapClearRewards` lookup as it does today.

**Reward record.**

- Start from the template's record at that place (keep `ring`, `name`, `langId`, `title`, `langId2`, `gemRare`,
  `gemSpecial` and the ticket/lottery fields).
- Set `jewel`, `coin`, `fp` and `gemNormal` (absent = 0), and `battleSkipBill` when the record has it or
  `skipTickets` is given.
- Rebuild the four `units` rows:

```
{unitId, unitLv:level, unitNum:quantity, ability:0, plus_s:hp, plus_a:atk, plus_d:def, plus_sp:speed, luck, grade:1}
```

  Fill the remaining rows with `{unitId:0, unitLv:1, unitNum:0, ability:0, plus_*:0, luck:0, grade:1}`.

**Emergency drops** (`compileDrops`). For each listed template enemy **E**, working only in this mission's cloned enemy
sets:

1. Every placement of E gets `dropRate = chancePerThousand`, or 0 when `item` is null.
2. **Clone when the item changes.** If the item, its level or its bonuses differ from what E drops in the template,
   clone E's whole enemy definition to a new enemy ID E′.
   - Copy every client and server row keyed by that enemy/unit ID.
   - Set `dropId`, `dropUnitLevelMin` = `dropUnitLevelMax` = level, and `dropPlus_s/a/d/sp`.
   - Point this mission's placements and `dependencies.enemyUnitIds` at E′.
   - A chance-only edit, or `item: null`, needs no clone.
3. **Rebuild `dropCandidates`** from the result: one row per placement with `dropRate > 0` whose enemy has a drop item.
   The row fields are:

   ```
   {mapId, enemySetId, enemyId, dropId, unitType3 (the item's), chancePerThousand, enemyCount (the placement's count),
    unitLevelMin, unitLevelMax, luck, skillLevel, ability (the template's row for that enemy; 0 if it had none), plusS, plusA, plusD, plusSp}
   ```

   This is the template's own rule: rebuilding with unchanged values reproduces the stock rows of all 195 templates
   exactly (host test).

When a template enemy's chance differed between its placements, a listed entry sets all of them. The website says so
next to such enemies.

### Phantom Castle

The season keeps the base season's points, opponents and floor count, and the point scale is applied as in 2.5. Edits
work on copies of the reward preset's tables for the slot's season (9800–9809):

| Rewards key | Server | Client |
| --- | --- | --- |
| `floors` | the season's floor reward table (copy of `PvPReward_*`). `{ "<floor>": events }` with events `[code, amount]` for currencies, then `[1, quantity, itemId, level, ability 0, luck, plusHp, plusAtk, plusDef, plusSpeed, grade 1]`. Codes: 2 pearls, 3 Cat Granny coins, 6 Ryo, 7 friend points, 11 skip tickets. `{}` deletes the floor's entry. | `arenaFloorRewards` row for that floor: the record rules above, from the template row (or a new row with `feature:false`); `{}` deletes it |
| `ranking` | the season's ranking table (copy of `PvPRankingReward_*`): that band's `events` | `arenaRankingRewards` row at the same index |

## IDs the app allocates

These are suggestions; the importer's allocation and collision checks stay authoritative.

- **Enemy clones.** Suggested ID: `61000000 + ledgerSlot × 1000 + n`, with n = 1–999 in first-use order. Ledger slot
  1–50 is Emergency, 51–60 is Road.
  - Check collisions against the whole unit master.
  - Record E → E′ in the slot ledger, so a re-import reuses the same IDs and a disable or delete never recycles them.
  - The built-in event quests already use custom enemy IDs (600xxxxx), so the engine accepts IDs in this range. Phone
    acceptance still applies.
- **Strings.** `forge_stage_<destination missionId>_objective_<1..3>`.
- **Banner image.** `imageId` = destination stageId (3800–3819, 3823–3852 for Emergency; 8800–8809 for Road).

## Errors (shown immediately, with detail)

| Code | Cause |
| --- | --- |
| `PACK_FORMAT` | The manifest, paths or file list are wrong (extra, missing, unused or duplicate files) |
| `REWARD_FORMAT` | Wrong schema or profile, or a block isn't an object |
| `REWARD_FIELD` | An unknown key, anywhere (unknown fields are rejected, never ignored) |
| `REWARD_NUMBER` | A number is out of range, or Ryo min is above max |
| `REWARD_ITEM` | The item isn't in the unit master, or isn't awardable (reserved or disabled) |
| `REWARD_BONUS` | A stat pill's `plus` differs from its fixed bonus |
| `REWARD_TOO_MANY` | More than 4 items in one reward |
| `REWARD_CHALLENGE` | Not exactly 3 challenges, an unknown condition, or a bad value, limited list or text |
| `REWARD_DROP` | The enemy isn't in the template, an item is missing, there's a chance without an item, or edited drops leave more than three distinct normal items in the mission |
| `REWARD_LUCKY` | The template has no single lucky row |
| `REWARD_FIRST_CLEAR` | The template has no first-clear group |
| `REWARD_MAP` | The map isn't one of the Road's own maps |
| `REWARD_FLOOR` | The floor is outside 1–floorMax |
| `REWARD_RANKING` | The band isn't in the season's preset |
| `BANNER_FORMAT` | Bad path or hash format, or not a PNG |
| `BANNER_SIZE` | The PNG isn't exactly 680×320, or is over 1 MiB |
| `BANNER_HASH` | The SHA-256 doesn't match |
| `BANNER_MISSING` | A definition names a banner the pack lacks |

The existing `STAGE_*` codes still apply to the layout part.

## Host tests to add on the app side

1. Port or compile against the module's rules, then build the three examples with the standard IDs
   (`standardAlloc(kind, 1)`). The rows must equal `tests/golden/*.compiled.json`.
2. Every rejection in the table above, with nothing allocated after a failed batch.
3. Re-import:
   - The same `localId` without `rewards` restores the template's rewards.
   - Removing the banner restores `imageId` 99999.
   - Enemy clones keep their IDs.
4. Disable and re-enable keep rewards and banner. Stock missions and stock castle tables stay byte-identical.
5. Old packs (schema 1 manifest, schema 2 / castle schema 1 definitions) build exactly as in 2.5.

## Phone acceptance (not covered by any host test)

- **Speed pills.** Award 13683 as a challenge reward, lucky reward, enemy drop, Road map reward and castle floor reward.
  The unit's Speed must rise by 2 when it's used.
- **Emergency.**
  - Clear with each challenge condition (turns, element, cost).
  - New challenge text shows.
  - First-clear pearls arrive once.
  - EXP and Ryo match.
  - The lucky reward appears with luck.
  - Edited drops fall at roughly the set rate; a cloned enemy looks and fights like the original.
- **Road.** Map rewards on the right maps, a removed map pays nothing, and the Road clear reward arrives.
- **Castle.** Edited floor rewards at those floors, and ranking rewards for the edited band.
- **Banner.** It shows in the Emergency and Road quest lists. Removing it brings the default back.
- **Saves.**
  - Existing saves and progress survive the update.
  - Retry and resume work.
  - Rebuilding after a pack update doesn't duplicate rewards or first-clear payouts.

## Known unknowns

- Whether the client honors `battleSkipBill` in challenge and Road records. It is supported in castle events; the stock
  data has it on records.
- Where the offline engine keeps Emergency/Road objective rows. They must mirror the client rows: the built-in event
  catalog keeps them identical.
- The camera, and how the banner crops on different devices.
