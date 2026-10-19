"""Build stages/cat/app.json.gz: the templates the Forge app can install as stages.

usage: python3 tools/build_stage_app_catalog.py <stage-catalog.json> stages/cat [--names docs/catalog.json] [--export <stage-builder export>]

stage-catalog.json is the app's pinned, read-only template catalog (profile emergency-layout/1).
This keeps what the Stages tab needs to check a stage before export: each template's map IDs in
order, its 11x11 chip grids, and a summary of the rewards the template brings with it.
"""
import argparse, gzip, json, os

ap = argparse.ArgumentParser()
ap.add_argument('catalog'); ap.add_argument('out')
ap.add_argument('--names', help="the Studio's docs/catalog.json (unit names)")
ap.add_argument('--export', help='stage-builder export folder (English unit list for drops such as boost items)')
a = ap.parse_args()
src, out = a.catalog, a.out
cat = json.load(open(src, encoding='utf-8'))
assert cat.get('schema') == 1 and cat.get('profile') == 'emergency-layout/1', 'unexpected catalog'
unit_names = {}
if a.export:
    loc = json.load(open(os.path.join(a.export, 'data/localization-en.json'), encoding='utf-8'))
    t = json.loads(gzip.open(os.path.join(a.export, 'tables/language__en__unitdata__unitlist.bytes.json.gz')).read())
    for u in t['records'][0]['value']['datas']:
        n, s = loc.get(u.get('langId') or ''), loc.get(u.get('langId2') or '')
        if n:
            unit_names[str(u['id'])] = n + (' (' + s + ')' if s and s != n else '')
if a.names:
    for u in json.load(open(a.names, encoding='utf-8')).get('units', []):
        unit_names.setdefault(str(u['id']), u['n'])

donors, drop_ids = {}, set()
for mid, d in cat['donors'].items():
    mi = d['mission']['missionInfo']
    maps = [{'id': m['id'], 'chips': [l['chips'] for l in m['raw']['map']['lines']]} for m in d['maps']]
    assert all(len(m['chips']) == 11 and all(len(r) == 11 for r in m['chips']) for m in maps), mid
    drops = [u for u in (mi.get('missionDropComplete') or {}).get('dropUnits') or [] if u]
    drop_ids.update(map(str, drops))
    bg = (d['maps'][0]['raw'] or {}).get('mapBgId') if d['maps'] else None
    donors[mid] = {'maps': maps, 'bg': str(bg) if bg is not None else None, 'r': {
        'stamina': mi.get('stamina'), 'exp': mi.get('exp'), 'unitExp': mi.get('charaExp'),
        'coins': [mi.get('minCoin'), mi.get('maxCoin')],
        'firstClear': (d.get('firstClearGroup') or {}).get('reward'),
        'objectives': [((s.get('subMissionReward') or {}).get('jewel') or 0) for s in mi.get('subMission') or []],
        'drops': drops}}

res = {'schema': 1, 'profile': cat['profile'], 'slots': len(cat['slots']), 'donors': donors,
       'slotList': [{'slot': x['slot'], 'stageId': str(x['stageId']), 'missionId': str(x['missionId'])} for x in cat['slots']],
       'units': {i: unit_names[i] for i in sorted(drop_ids) if i in unit_names}}
os.makedirs(out, exist_ok=True)
raw = json.dumps(res, separators=(',', ':'), ensure_ascii=False).encode()
with open(os.path.join(out, 'app.json.gz'), 'wb') as f:
    f.write(gzip.compress(raw, 9, mtime=0))
print('templates', len(donors), 'slots', res['slots'], 'drop names', len(res['units']), 'of', len(drop_ids), 'bytes', len(gzip.compress(raw, 9)))
