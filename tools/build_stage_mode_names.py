"""Build stages/cat/reward-names.json: readable names for the items Ninja Road and Phantom Castle templates give out.

usage: python3 tools/build_stage_mode_names.py stages/v250/authoring-catalog.json.gz stages/cat/reward-names.json

English names come from the Studio's unit list (docs/catalog.json), the Stages app list (stages/cat/app.json.gz)
and the sprite catalog (sprites/cat/index.json.gz). Items with no English name keep the name the season's own
reward row gives (field "s", in the game's source language) so the page can show something true instead of a guess.
"""
import gzip, json, os, sys

src, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(gzip.open(src))
english = {}
for u in json.load(open(os.path.join(root, 'docs/catalog.json'), encoding='utf-8'))['units']:
    english[str(u['id'])] = (u['n'] + (' (' + u['s'] + ')' if u.get('s') else ''), u.get('r'), u.get('a'))
for i, n in json.load(gzip.open(os.path.join(root, 'stages/cat/app.json.gz')))['units'].items():
    english.setdefault(i, (n, None, None))
for i, d in json.load(gzip.open(os.path.join(root, 'sprites/cat/index.json.gz')))['donors'].items():
    english.setdefault(i, (d['name'] + (' (' + d['title'] + ')' if d.get('title') else ''), d.get('rarity'), d.get('attribute')))

ids, source = set(), {}
def note(uid, name):
    uid = str(uid); ids.add(uid)
    if name and name not in ('_', 'test', '未指定'): source.setdefault(uid, name)
for d in cat['castleDonors'].values():
    raw = {r['floor']: r for r in d['arena']['arenaFloorRewards']}
    for fl, evs in d['floorRewards'].items():
        items = [e for e in evs if e[0] == 1]
        for e in items: note(e[2], raw.get(int(fl), {}).get('name') if len(items) == 1 and len(evs) == 1 else None)
    for r in d['rankingRewards']:
        for e in r['events']:
            if e[0] == 1: note(e[2], None)
for d in cat['roadDonors'].values():
    rows = [x for r in d['clearRewards']['rewardList'] for x in r['reward']]
    sm = (d.get('serverStage') or {}).get('missions') or [{}]
    rows += [r['mapClearRewards'] for r in sm[0].get('mapClearRewards') or []] + [r['mapClearRewards'] for r in d['mission']['missionInfo'].get('mapClearReward') or []]
    for r in rows + [sm[0].get('missionClearComplete') or {}, d['mission']['missionInfo'].get('missionClearComplete') or {}]:
        us = [u for u in r.get('units') or [] if u.get('unitId')]
        for u in us: note(u['unitId'], r.get('name') if len(us) == 1 else None)

res = {}
for i in sorted(ids, key=int):
    o = {}
    if i in english:
        n, r, a = english[i]; o['n'] = n
        if r: o['r'] = r
        if a: o['a'] = a
    if i in source: o['s'] = source[i]
    res[i] = o
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump({'schema': 1, 'items': res}, f, ensure_ascii=False, separators=(',', ':'))
print('items', len(res), 'english', sum(1 for v in res.values() if 'n' in v), 'source-only', sum(1 for v in res.values() if 'n' not in v and 's' in v), 'unnamed', sum(1 for v in res.values() if not v))
