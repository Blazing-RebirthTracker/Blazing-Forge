# Forge stages and native modes — v2.5.0

This is an incremental website handoff, plus three small game-import examples. Existing stage-builder backgrounds and animation-preview schema-2 assets remain compatible; their pixels are unchanged. The source catalog and enemy/geometry references are included. Extract every supplied ZIP into the same directory. Run `node tests/adapter.test.mjs` there.

## Slots and identity

| Mode | Count | Destination IDs |
| --- | ---: | --- |
| Emergency | 50 | Stage 3800–3819 and 3823–3852; mission = stage × 100 + 1 |
| Ninja Road | 10 | Stage 8800–8809; mission 88001, 88011, …, 88091 |
| Phantom Castle | 10 | PvP season 9800–9809 |
| Supplied Kirito | separate | Stage 3820–3822 / mission 382001, 382101, 382201 |

The app ledger slots are 1–50 Emergency, 51–60 Road, 61–70 Castle. Browser slot cards are project positions, not device allocations. The app assigns the first unused slot in the matching mode. IDs and donor identity remain reserved after disabling or deletion. Re-import the same localId to update/restore. A full phone ledger cannot accept a new localId, even when some imports are hidden.

Road map IDs = mission × 100 + 1-based map ordinal. Emergency retains mission × 10 + ordinal. Enemy-set IDs = destination map × 100 + 1-based choice ordinal. Never send destination IDs in a spec. Native allocation/collision checks remain authoritative.

## Installable schemas

`ForgeStage`, schema **2**, profile **emergency-layout/1** or **ninja-road-layout/1**:

```json
{"format":"ForgeStage","schema":2,"profile":"ninja-road-layout/1","localId":"myproject:road-a","name":"My Road","donorMissionId":"80043","enabled":true,"maps":[{"donorMapId":"8043010","markers":[]}]}
```

The maps above illustrate the structure; use create() or the complete example JSON to include **all** template maps in their exact order. Each marker is `{ "chip": 8, "grid": [2,6] }`. Chips 8–13 are player entries; 16–25 are enemy entries. Each moved chip must occur exactly once. Coordinates are integer 0–10; destinations must be distinct floor cells (chip 1), or cells vacated by another moved marker. At most 16 moves per map. Other fields are rejected. Native-mode donors must come from the matching catalog.

`ForgeCastle`, schema **1**, profile **phantom-castle/1**:

```json
{"format":"ForgeCastle","schema":1,"profile":"phantom-castle/1","localId":"myproject:castle-a","name":"My Castle","donorPvpId":"1","rewardPvpId":"2","pointScale":1.5,"enabled":true}
```

`rewardPvpId` is optional (inherits donor); its preset must have identical original points/floor progression. `pointScale` is optional (1), finite 0.1–10. Only cumulative thresholds are scaled and rounded to the nearest whole point; the native floor base value and final zero remain unchanged. Both client resolved arrays and server resource references are generated together. Opponents, floor count and other rules retain the base season. Use the actual example if a different preset fails compatibility.

Common: name 1–96 UTF-8 bytes with no controls; localId 1–96 ASCII letters/digits/`-_.:` and at least one colon. enabled is optional boolean, default true. Unknown fields, numeric donor IDs and malformed values fail immediately. One active custom Road/Castle per mode; selecting/importing another active definition turns the prior one off. Stock rows and saved progress remain intact.

`ForgeStagePack`, schema **1**, ZIP root `forge-mod.json`:

```json
{"format":"ForgeStagePack","schema":1,"stages":["stages/01.json"]}
```

1–70 unique listed JSON files under stages/, no additional ZIP members, no unsafe/duplicate paths, 2 MB compressed and expanded maximum. The app handles imports atomically. Missing entries leave existing imports alone. Disabled entries are explicit updates, not deletions. The existing ledger envelope keeps schema 1/profile emergency-layout/1 for backward compatibility; individual specs now carry their native mode. Do not build or replace the device ledger in the website.

## Data and display

- authoring-catalog.json.gz: complete templates, native field names and values, original client and server rows, maps/sets, points and rewards. IDs already normalized for import remain strings; original small numeric table fields remain numeric.
- stage-catalog.json: smaller validation catalog, capacities, slots and SHA-pinned template manifest. The app loads only the active mode’s full template during builds to limit memory.
- slot-ids.json: exact destinations and Kirito exclusions.
- reference/: enemy-to-existing-animation-donor mapping, geometry, original table source inventory, stock Castle teams, source routes/hashes, and the current supplied Kirito definitions. None of these files overrides an import format.
- examples/: one installable example per mode. The three-example ZIP adds test definitions to the app, consuming one permanent slot in each mode. Reuse these local IDs for repeat tests.

Use the existing full stage-builder and animation-preview asset libraries for backgrounds and character playback. This package does not duplicate their unchanged PNG/model/clip files. Unknown bindings stay unknown. Original server Road reward rows and original client display rows can differ; they are both retained and labeled by source. Do not merge them into a falsely verified payout promise.

## Limits and verification

There are 41 supported Road templates and 120 Castle seasons. Original Road mission 80014 is excluded because its mission-specific reward rows reference maps outside its own map list. Stock Road `mapClearRewards` also contains a cumulative lookup across other Roads: custom templates retain only entries for their own maps. Original source catalogs remain unchanged and available in the previous stage-builder export.

Host checks cover allocation, validation, output consistency, preserved stock rows, disable/re-enable, repeat builds and resource capacity. Native instructions, registry identities and crash diagnostics are retained. Phone acceptance is still required for new Road/Castle launch, map transitions, completion, floor/ranking rewards, retries and existing progress. The Emergency slot expansion uses the established event path. Logical grid coordinates are confirmed; exact phone camera, parallax and all scripted enemy spawn behavior are not fully modeled by a website preview.

Arbitrary per-enemy stats/rewards, new backgrounds, map reordering, new AI and Castle team replacement are **not** supported by these import profiles. Keep richer edits as website drafts/developer handoffs. The app’s own validation is the final authority; never bypass it or change template hashes.
