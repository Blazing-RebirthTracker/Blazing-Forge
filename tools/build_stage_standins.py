"""Build stages/cat/standins.json: a stand-in idle sprite for every enemy that has no exact preview in the sprite catalog.

usage: python3 tools/build_stage_standins.py stages/v250/reference/enemies.json.gz sprites/cat/index.json.gz stages/cat/standins.json

Exact bindings (same rig AND image) stay in stages/cat/enemies.json.gz and are used first. For the rest, in order:
  name    a playable unit with the same name (same rig preferred, then the closest rarity)
  rig     a unit on the same body rig (different art, same animation)
  element a 3-star unit of the same element (nothing in common but the element; never one of the team sprites)
The Stages page labels every stand-in as one; none of them is the enemy's own art.
"""
import gzip, json, sys

enemies = json.load(gzip.open(sys.argv[1]))
spr = json.load(gzip.open(sys.argv[2]))['donors']
idle = {k: d for k, d in spr.items() if (d.get('moves') or {}).get('idle', {}).get('layers')}
by_name = {}
for k, d in idle.items():
    by_name.setdefault(d['name'].lower(), []).append(k)
TEAM = {'naruto uzumaki', 'sasuke uchiha', 'kakashi hatake'}  # the layout preview draws your team with these, so enemies never borrow them
by_attr = {}
for k in sorted(idle, key=int):
    d = idle[k]
    if d.get('rarity') == 3 and d['name'].lower() not in TEAM:
        by_attr.setdefault(d.get('attribute'), k)
fallback = min((k for k in idle if idle[k].get('rarity') == 3 and idle[k]['name'].lower() not in TEAM), key=int)

out, counts = {}, {'name': 0, 'rig': 0, 'element': 0}
for eid, e in enemies.items():
    if e.get('previewAvailable') and e.get('catalogDonorId') in idle:
        continue
    raw = e.get('raw') or {}
    rig, rare, attr = str(e.get('boneId')), raw.get('rare') or 0, raw.get('attr')
    pick = None
    cands = by_name.get((e.get('name') or '').lower(), [])
    if cands:
        cands.sort(key=lambda k: (str(idle[k].get('rig')) != rig, abs((idle[k].get('rarity') or 0) - rare), int(k)))
        pick = (cands[0], 'name')
    if not pick:
        same = [k for k in e.get('sameRigOnlyDonors') or [] if k in idle]
        if same:
            pick = (sorted(same, key=int)[0], 'rig')
    if not pick:
        pick = (by_attr.get(attr) or fallback, 'element')
    out[eid] = pick
    counts[pick[1]] += 1

with open(sys.argv[3], 'w', encoding='utf-8') as f:
    json.dump({'schema': 1, 'note': 'Stand-in sprites: [unit id, basis]. Not the enemy\'s own art.', 'standins': out}, f, separators=(',', ':'))
print('stand-ins', len(out), counts)
