# Website rewards and stage images — Blazing:Forge v2.6.6

Merge this package into the existing Blazing Forge website. Do not replace it with a new site. The supplied stages/index.html already has reward and banner controls; preserve its other editors and existing assets. This is a merge package, not a standalone website. Existing sandbox/, v250 reference files and other site catalogs are still required.

The app now supports Rewards and banners imports with a one-time v2.6.6 IPA update. After that, changes use website export → Forge > Stages > Import stages → Build mod → fully close/reopen. Never promise compatibility with 2.6.5 or older, and do not tell users to delete saves or replace their installation. Do not export raw patches or native registry edits.

Keep ForgeStagePack schema 2, ForgeStage schema 3 (emergency/2 and ninja-road/2), ForgeCastle schema 2 (phantom-castle/2). Old layout formats remain supported. Keep localId and donor identity on reimport; the phone allocates IDs. Preserve the 50 Emergency, 10 Road and 10 Castle slots. Kirito's reserved 3820–3822 events remain a separate authoring workflow.

Use stage-rewards.mjs for validation. The v2.6.6 module adds a required guard: at most THREE DISTINCT normal-drop item IDs per Emergency mission, including unchanged enemies. This is the supported edited-drop profile: native fallback arrays have exactly three slots. Six original templates have wider candidate lists; their old layout-only imports remain unchanged, while reward edits must reduce the distinct normal items to three or fewer. The phone writes a zero-padded three-element server normalUnits array; the website compiler's unpadded list describes the real items only. Preserve all candidate rows. Do not confuse normal drops, lucky drops, challenges, first-clear, Road map/clear rewards or Castle floor/ranking rewards.

Speed pills 13683 must carry +2 Speed (13682 +1). Keep fixed item bonuses and validation. The app permits enabled original catalog items; reserved/custom materials are not advertised as supported by this import profile. Preserve the existing item images, search aliases and previews.

Banner controls apply to Emergency and Road: exactly 680×320 PNG, at most 1 MiB each, referenced by SHA-256 and listed in the manifest; 16 MiB expanded pack with banners, 2 MiB without. Castle seasons have no banner field. Reject extra/missing/unused files. Display the actual banner preview and make the 680×320 crop clear.

Omitted rewards restore the template on reimport; omitted individual reward keys retain that template section. Removing the banner restores the template image. Disabling/re-enabling preserves edits. Existing clear receipts and progress remain; changing a reward does not reset prior claims. Keep imported/edited data through undo, save/reopen and export/reimport. Export only stages the user enabled for game visibility, retaining disabled stages in the editable project.

Run node stages/rewards/tests/rewards.test.mjs and test the real website: speed-pill search and selection, enemy drop changes, challenge/lucky rewards, Road/Castle rewards, banner upload/crop, export, reimport, project save/reopen and disabled-stage filtering. Keep all existing website workflows. Module tests alone do not establish website integration or phone payouts.

The app's host evidence checks the three supplied golden examples, native zero-padding, fixed bonuses, cloned enemies, unchanged stock records, stable IDs, repeated builds and restoring template rewards. Phone acceptance remains separate: award/feed the pills, check payouts and first-clear once, retry/resume, and inspect banners in list/detail views.
