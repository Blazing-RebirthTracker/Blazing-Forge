# Blazing Forge

Custom characters, banners and summon animations for **Blazing:Rebirth** (the offline iOS revival of Naruto Shippuden: Ultimate Ninja Blazing).

You design a character in the **Studio**, save a **mod pack**, drop it into the game's folder, and the game builds it on your phone from your own game data. No computer is needed, and no game files are shared.

---

## For players

### 1. Add the Blazing Forge add-on (once)

1. Open the Studio, go to **Build**, and press **Save add-on (.zip)**. Unzip it to get `BlazingForge.dylib` (it's also in [`addon/`](addon/)).
2. In **Sideloadly**, open your Blazing:Rebirth IPA, go to **Advanced options**, and inject `BlazingForge.dylib`.
3. Install over your current app. Your saves and game data stay where they are.

### 2. Make a mod

1. Open the **Studio**: `docs/index.html` (or the GitHub Pages link for this repo).
2. Make characters: pick the free event or shop unit the character replaces, the art, the donor for battle animations, stats, abilities, Ninjutsu, Secret Technique, latent skill, and field and buddy skills.
3. Optionally make a banner and re-skin the summon animation.
4. On **Build**, press **Save mod pack**. You get `BlazingForge-mod.zip`.

Your work is saved in your browser. **Save mod pack** also works as a backup, and **Open a mod pack** loads one back in, so you can trade packs with friends.

### 3. Put it in the game

1. Put `BlazingForge-mod.zip` in **Files › On My iPhone › Blazing:Rebirth**.
2. Open the game. After a few seconds it says it's building your mod pack. Keep the game open.
3. About a minute later it says the mod is ready. Close the game completely and open it again.
4. New 6★ characters are waiting in the **Present Box**.

**Summon animation:** the Studio's Summon tab saves two small switch files (`BlazingForge-summon-custom.zip`, `BlazingForge-summon-classic.zip`). Drop one in and the game rebuilds your last mod pack with that animation.

**Undo everything:** drop in a file named `BlazingForge-uninstall.zip` (any zip with that name). The original game files come back.

**Something went wrong?** The add-on writes a log to **Files › On My iPhone › Blazing:Rebirth › BlazingForge › forge.log**.

### Things to know

- The offline server only accepts units it already knows, so every custom character **takes over** a free event or shop 5★→6★ unit. Copies of that unit you already own turn into your character.
- Banner names and ticker text can't contain `:` or `!`. The offline server won't start with them.
- Some donors' battle sprites are missing from the game data. The Studio flags those; your character would show white boxes in battle.

---

## For developers

| Folder | What it is |
| --- | --- |
| [`docs/`](docs/) | The Studio (single-page web app, works offline in a browser and on GitHub Pages) with its game catalog and example content |
| [`addon/`](addon/) | `BlazingForge.dylib`: installs patches and builds mod packs inside the game. `build.sh` needs clang, lld and an iPhoneOS SDK |
| [`forgecore/`](forgecore/) | The mod pack builder in portable C (bundles, type trees, tables, art, banners, summon re-skin). Builds and tests on Linux too |
| [`forge/`](forge/) | The original Python builder (`forge.py build/verify/donors/slots`) |
| [`sprites/`](sprites/) | The Sprites tab: battle-animation player and per-piece sheet editor. `sprites/cat/` holds the unit catalog: `index.json.gz`, gzipped rig models and animation clips, and the sprite atlases |
| [`stages/`](stages/) | The Stages tab: stage builder (beta). `stages/cat/` holds the mission list, one gzipped file per mission with its maps and enemy line-ups, the enemy table, background previews, `app.json.gz` and `reward-names.json`. `stages/v250/` holds the app 2.5.0 handoff: the import contract, the authoring catalog (all Emergency, Ninja Road and Phantom Castle templates), slot IDs, references, examples and tests |
| [`tools/`](tools/) | `studio.py` (Studio data ⇄ mod folder), `export_catalog.py` (regenerate `docs/catalog.json`), `cmp_builds.py` (compare two builds), `build_sprite_catalog.py` (rebuild `sprites/cat/` from an animation export), `lock_sprites.py` (password-locked test sheets), `build_stage_catalog.py` (rebuild `stages/cat/` from a stage-builder export), `build_stage_app_catalog.py` (rebuild `stages/cat/app.json.gz` from the app's stage template catalog), `build_stage_mode_names.py` (rebuild `stages/cat/reward-names.json`) |

### Stage files

The Stages tab has three modes, each with **In-game templates** and **My custom slots**: Emergency (50 slots), Ninja Road (10) and Phantom Castle (10). It writes the app 2.5.0 import formats exactly as [`stages/v250/README.md`](stages/v250/README.md) documents them, and every definition goes through the supplied contract in `stages/v250/stage-modes.mjs` (`validate`, `setEnabled`, `exportFiles`, `markerScene`), which stays byte-for-byte as supplied.

- **Emergency** and **Ninja Road**: `ForgeStage` schema 2, profiles `emergency-layout/1` and `ninja-road-layout/1`. A stage names its template (`donorMissionId`, a decimal string), keeps every template map in order and lists marker moves per map: start spots (chips 8–13) and enemy entry points (chips 16–25) to grid `[x, y]`. Enemies, stats, waves, abilities, backgrounds and rewards stay the template's.
- **Phantom Castle**: `ForgeCastle` schema 1, profile `phantom-castle/1`: a base season (`donorPvpId`), an optional reward preset with the same original floor progression (`rewardPvpId`) and a `pointScale` from 0.1 to 10. Opponents and battle rules stay the base season's.

`localId` is a definition's permanent identity on a phone; the page makes namespaced ones (`forge-stages:`, `forge-road:`, `forge-castle:`). Slot cards are positions in the project: the app allocates the real game IDs when it imports, and the supplied destination IDs only appear in Advanced details. Emergency slots 1–20 keep stage 3800–3819; 21–50 skip the reserved event quests 3820–3822, which are reference only and never exported. One imported Road and one imported Castle are active at a time (**Use this Road** / **Use this Castle**); Emergency imports can all be on.

Editing a game-ready template makes a custom copy; stock stages are never overwritten. Rewards and challenges (Emergency and Road: EXP, Ryo, first clear, challenges, lucky reward, drops, map/Road clear rewards; Castle: floor and ranking rewards) are editable as website-draft edits (`rewards` in the draft, `draft.rewards` on a castle); app 2.5.0 doesn't install them, so game packs keep the template's. The layout preview draws your team as characters No. 3, 5 and 9 and gives enemies without their own sprite a labeled stand-in from `stages/cat/standins.json` (`tools/build_stage_standins.py`). **Export enabled stages** writes a zip with only `forge-mod.json` (`{"format":"ForgeStagePack","schema":1,"stages":[...]}`) and its `stages/*.json`, built by `exportFiles` from configured, switched-on definitions (at most 70, 2 MB). **Export changes including disabled imports** also sends switched-off definitions as `enabled: false`, so a phone that has them switches them off; a pack never deletes anything. Richer edits (enemies, waves, rewards, backgrounds, extra maps, Castle notes) stay in website drafts. **Export draft file** keeps the editor's full draft (schema 1). **Save editable project** writes `Forge-stages-project.zip` (`forge-stages-workspace.json`, schema 2, with all three modes' slots, switched-off definitions, in-game drafts, localIds and the ledger, plus each stage project's files under `projects/`); projects saved before this version (schema 1, 20 slots) open with their stages in the same slots.

Tests: `cd stages/v250 && node tests/adapter.test.mjs && node tests/website.test.mjs`. `tools/build_stage_mode_names.py` rebuilds `stages/cat/reward-names.json` (names for Road and Castle reward items). Website checks don't replace phone testing of the new Road and Castle imports.

### Stage projects

The Stages tab also opens `ForgeStageSandbox` (schema 1) stage projects: a project JSON plus a package of catalogs and art, imported as one ZIP. Projects and their files are stored in the browser (IndexedDB). The page edits them through `ForgeStageSandbox` (the adapter in `stages/index.html`): marker moves, enemy drops, lucky rewards, challenge rewards and coins/EXP, rebuilding client and server mirrors together, with every edit undoable. **Save editable project** writes the project JSON; **Export developer handoff** writes a ZIP with the project, the package files unchanged and `handoff/CHANGES.json` (paths into the source catalog, before and after). These projects are authoring data, not game installs: the app's stage import only takes `ForgeStage` schema 2 layout stages, so game export stays disabled for them. Projects with the supplied event catalog (profile `kirito-events/1`) go through the supplied adapter, [`stages/sandbox/stage-sandbox.mjs`](stages/sandbox/) (unchanged), for everything it implements, and through `stages/sandbox/sandbox-edits.mjs` for the added controls (placements, stats with their `paramDatas` copy, difficulty value and a stat multiplier, drop/lucky details, challenge pearls/Ryo, coins/EXP), each keeping client and server copies together and validated on every edit. Their tab appears once such a project is in the browser (or with `?kirito`); saving keeps the file's own line endings, so a no-op save is byte-identical. When the package includes `catalogs/map-library.json`, the event workspace also edits maps through the supplied [`stages/sandbox/stage-map-authoring.mjs`](stages/sandbox/) (unchanged): `setMapBackground`, `replaceMapLayout` (plain 11×11 layouts; markers that would land in a wall must be placed by the user, passed as `placements`) and `reorderMaps` (the map ID keeps its enemies and rewards, the floor number is its position, boss flags never move). Floors can't be added or removed. `validateProject` and `validateMaps` run on every edit, import, save and export. Backgrounds with gimmicks or grid changes and special-tile layouts are shown as needing developer integration. The developer export adds `handoff/MAPS.json` and exactly the background definitions, textures, animation files and serialized bundles the edited maps use. Packages can be imported as a core ZIP plus asset part ZIPs in one pick; files are streamed from the ZIPs and checked against `checksums.json`.

Tests (need the package, which isn't in this repo): `node stages/sandbox/tests/edits.test.mjs <extracted package>`, `node stages/sandbox/tests/browser.test.mjs <package.zip> <extracted package>` and `node stages/sandbox/tests/maps.browser.test.mjs <folder with the core and part ZIPs> <extracted package>` (import, background change, layout replacement with a hand-placed marker, reorder, undo/redo, save/reopen, developer export and reimport).

### Mod pack format

A zip with `forge-mod.json` at its root plus:

- `units/*.json`: one file per slot (`slot`, `donor`, `name`, `subtitle`, `attribute`, `art`, `stats`, `abilities`, `jutsu`, `ultimate`, `latent`, `fieldSkill`, `buddySkill`, `visuals`, `gift`, …)
- `banners/*.json`: `id`, `name`, `ticker`, `copyFrom`, `basePool`, `featured`, `featuredWeight`, `art.front`
- `summon/summon.json`: atlas cells to repaint (`file`, `fit`, `rotate`, `offset`, `scale`, `pivot`, `shadowFrom`, `clear`, `recolorGrey`, …)
- `gifts.json`: extra Present Box items
- the art files these name

`forge-mod.json` containing `{"summonSwitch": "on" | "off"}` rebuilds the last pack with that summon setting.

### Building and testing on Linux

```sh
cd forgecore
gcc -O2 -o forgecore cli.c fc_*.c vendor/lz4.c vendor/lz4hc.c -lz -lm
./forgecore build <base> <mod> <BlazingEngine.json> <out>
python3 ../forge/forge.py verify --base <base> --out <out>
```

`<base>` holds a clean `BlazingData` folder (`python3 forge/forge.py fetch --base base/` pulls just the files Forge needs from the Blazing:Rebirth data release).

No game binaries are stored in this repository. The only game data files are the sprite atlases, rig models and animation clips in `sprites/cat/`, used by the Sprites tab, and the mission, map, enemy and background data in `stages/cat/`, used by the Stages tab. `docs/catalog.json` holds unit, skill and ability names and descriptions for the Studio's pickers.
