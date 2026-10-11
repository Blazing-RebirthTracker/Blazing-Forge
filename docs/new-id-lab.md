# New-ID Lab (experimental, read-only)

The current Forge Studio and iOS add-on **replace known character slots**. The Python builder also contains a `--allow-new-ids` code path, but it **is not compatible with an unmodified, integrity-enforcing Rebirth server**. Do not install experimental new-ID builds on a working save.

`tools/new_id_lab.py` provides a safe first step: audit an existing mod and make a **proposal-only** mapping from replacement slots to prospective independent IDs. It does not change or generate a mod pack, game assets, saves, APK, IPA, or server.

## Try it with an existing pack

Save the JSON response from your **local test server** endpoint `/diagnostics/unit-preflight` as `preflight.json`. For example, with PowerShell:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/diagnostics/unit-preflight' |
  ConvertTo-Json -Depth 20 |
  Set-Content -Encoding UTF8 '.\preflight.json'
```

Run the planner from the repository root:

```sh
python tools/new_id_lab.py \
  --mod /path/to/BlazingForge-mod.zip \
  --id-map tools/examples/legacy38-new-id-map.json \
  --preflight preflight.json \
  --out new-id-plan.json
```

The example mapping was prepared for a specific six-character LEGACY38 pack; **it is not a generic allocation scheme**. Its twelve proposed IDs must be rechecked against the exact version of the server you plan to run. Without `--preflight`, the tool explicitly warns that collision checks are incomplete.

The report includes slot-to-ID records, preserved animation-donor references, suggested banner featured-ID updates, warnings, and collision errors. `installable` is always `false`.

## What remains before true additions work

1. Extend the Unity unit master, language/skill records, art lists, evolution/progression tables, and Android/iOS asset manifests without modifying original IDs.
2. Make a **test-only** server backend accept the extended playable/progression/character catalogs and asset fingerprints; validate saves across a restart.
3. Make summon pools accept the new base forms and their actual identities, then exercise Present Box, roster, battle, animations, and summoning.
4. Validate the same pack independently on iOS and Android.

A successful `/diagnostics/unit-preflight` result for the **original** data is a baseline, not proof that new IDs are supported. Keep the public site and default slot-builder unchanged until an end-to-end test passes.

Run the lab tests with `python -m unittest discover -s tools/tests -v`.
