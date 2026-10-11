# v0.5.1 iOS Present Box loopback response diagnostic

## Evidence
- v0.5.0 engine boots. Present Box briefly displays Forge Engine v0.5.0: New Naruto, then an in-game communication error soft-locks; the iOS process stays open.
- engine.log shows the port 18080 listener and api/box/list.json requests but does not log HTTP statuses or responses.
- The playable ID list includes 480046, while the original 1456-record detailed native registry still lacks it. The exact rejection branch is unconfirmed.

## Changes
addon/fc_http_probe.c uses six POSIX socket I/O interposes and limits tracing to port 18080 when it sees /api/box/list.json or /api/box/get.json. It logs up to 24 chunks per socket, capped at 1100 printable bytes, into Documents/BlazingForge/box-http-v0.5.1.log. It does not modify any request, response, game data, save or unit record.

The v0.5.0 engine is unchanged (SHA-256 93eeea2a953de6ae3e652ace110dad771a2bd48b2a61e4630a789d56b527a727). This is instrumentation, not a registry fix.

## Build
GitHub Actions compiles ARM64 dylib on macOS. The output Mach-O contains a 96-byte __DATA,__interpose section with six entries. IPA ZIP integrity, unique file names, engine hash and loader replacement have been validated locally.

## Device test
1. Back up your test IPA, Documents folder and BlazingEngine/save.db. Sign and install the v0.5.1 diagnostic IPA.
2. Reuse BlazingForge-mod-v0.5.0.zip (only reimport if you have a new Documents folder).
3. Open Present Box once. If it errors, export Documents/BlazingForge/box-http-v0.5.1.log and BlazingEngine/logs/engine.log.
4. Network snippets may contain sensitive account or profile data; review before sharing.
5. If no trace file is created, note that DYLD interposition may not have engaged or the endpoint uses another transport.

Do not merge as a gameplay fix until HTTP status/response and server/client validation failure are identified.
