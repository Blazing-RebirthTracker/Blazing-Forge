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
| [`tools/`](tools/) | `studio.py` (Studio data ⇄ mod folder), `export_catalog.py` (regenerate `docs/catalog.json`), `cmp_builds.py` (compare two builds), `build_sprite_catalog.py` (rebuild `sprites/cat/` from an animation export), `lock_sprites.py` (password-locked test sheets) |

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

No game binaries are stored in this repository. The only game data files are the sprite atlases, rig models and animation clips in `sprites/cat/`, used by the Sprites tab. `docs/catalog.json` holds unit, skill and ability names and descriptions for the Studio's pickers.
