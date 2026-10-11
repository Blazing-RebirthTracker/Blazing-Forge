# Blazing:Forge iOS engine playable-ID probe v0.5.0

**Experimental diagnostic. This is NOT a confirmed new-ID gameplay fix.**

## Reason
With the preserve-recovery-pack Forge builder, the IPA launches and original gift ID 13476 works, but new ID 480046 is missing from the gift box and owned box. The engine has a static UTF-8 JSON list of 1,089 playable IDs embedded in its `__TEXT,__const` Mach-O section. `480046` is absent. A separate detailed backend registry may still reject it.

## Exact scoped binary modification
`tools/patch_ios_engine_playables.py` takes the **unmodified** 98,615,184-byte engine from `Blazing-Rebirth-iOS-offline.ipa` (SHA-256 `d4527aed100120bde2566106d00630441a8eba74c7f925ef83affe54dd54540b`). It inserts `480046` into the 1,089-ID embedded playable list, reclaiming eight *optional whitespace* bytes from the same JSON string. It does not change file size, load commands, any original ID, any compiled instruction, or any byte outside that original JSON list.

Local validation: patched SHA-256 `93eeea2a953de6ae3e652ace110dad771a2bd48b2a61e4630a789d56b527a727`, file size 98,615,184, 1,090 distinct original + new IDs. Parsed Mach-O structure remains valid. Neither iOS launch nor Present Box ownership has been verified for the patched engine.

## Smoke test
1. Back up the original offline IPA and app Documents, particularly `BlazingEngine/save.db`. Use a test installation.
2. Replace `Payload/BNEI0249.app/Frameworks/BlazingEngine.dylib` in the test IPA with the patched engine (keep exactly the in-IPA name `BlazingEngine.dylib`). Re-sign the IPA. **Do not inject it as a second copy** or assume Forge uninstall restores the app binary.
3. Keep the known-working Forge add-on (`BlazingForge-v0.4.2.dylib`) installed. Use the standalone `BlazingForge-mod-v0.5.0.zip`, which keeps `preserveRecoveryPack=true`, contains just the new Naruto ID 480046 and one fresh gift version 500.
4. Fully close and restart. Check whether server startup succeeds, the Present Box shows the 480046 gift, claim, owned box, battle, and persistence; save `engine.log` and `forge.log`.
5. Restore original IPA and original app data if anything fails.

## Interpretation
- If existing offline server boots and Naruto 480046 can be claimed: playable-ID list was at least one gate. Still test roster, battle, and save; other registries remain.
- If the offline server boots but 480046 is still absent: a *different* backend registry or gift validator is filtering. Inspect server code/resources; do not keep blindly patching JSON.
- If the IPA won't launch: treat it as failed binary integration/re-signing, restore original; the binary was never confirmed on iOS.

No repository binaries are committed. Do not merge until verified.