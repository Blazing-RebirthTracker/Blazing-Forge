# forgecore

Blazing Forge's patch builder in portable C, so mod packs build on the player's phone from their own game data.
Same mod format and same output as `forge/forge.py build` (slot mode), including the summon re-skin.

- `fc_util.c` buffers, files, SHA-256, MD5, CRC32
- `fc_json.c` ordered JSON that keeps number literals (prints like Python's json.dumps)
- `fc_obf.c` the game's ObfuscatedText table encoding
- `fc_ufs.c` UnityFS bundles (writes like UnityPy's "lz4" packer)
- `fc_sf.c` SerializedFile v17 + type-tree read/write
- `fc_img.c` PNG/JPEG in (stb_image), resize (stb_image_resize2), PNG out
- `fc_build.c` the build: units, skills, latents, abilities, field/buddy, art, icons, trims, gifts, banners, lists, routes
- `fc_summon.c` summon animation re-skin (SpriteStudio atlas cells)

Linux test: `gcc -O2 -o forgecore cli.c fc_*.c vendor/lz4.c vendor/lz4hc.c -lz -lm`, then
`forgecore build <base> <mod> <BlazingEngine.json> <out> [--summon off|on]`. Check with `forge.py verify` and
`tools/cmp_builds.py` against a Python build.

iOS: `addon/build.sh` links it into BlazingForge.dylib. A zip with `forge-mod.json` dropped into Documents is
unpacked to `BlazingForge/modpack`, built in the background (base files come from `BlazingForge/original` when a patch
replaced them), then installed like a patch. `{"summonSwitch": "on"|"off"}` rebuilds the last pack with that summon setting.

Vendored: lz4 1.9.4 (BSD-2), stb_image / stb_image_resize2 (public domain / MIT). The common type-tree string table comes from UnityPy (MIT).
