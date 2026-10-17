"""Build stages/cat/ for the Stages tab from a stage-builder export.

usage: python3 tools/build_stage_catalog.py <export folder> stages/cat

The export folder holds data/, enemies/ and backgrounds/ (schema 1). This writes a compact,
gzipped catalog the browser can read: the mission list, one file per mission with its maps
(11x11 chip grid, player slots, enemy sets in their original order), an enemy table and
one WebP preview per battle background. Raw source rows stay in the export; this only keeps
the fields the editor shows and the fields a stage draft needs to carry through unchanged.
"""
import gzip, json, os, sys
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
ENTRY_FIELDS = ('enabled', 'type', 'id', 'level', 'count', 'enterId', 'aiType', 'enterType', 'param', 'dropRate', 'way', 'bossId', 'bossParts')


def load(p):
    with open(os.path.join(SRC, p), encoding='utf-8') as f:
        return json.load(f)


def save(rel, obj):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode()
    with open(path, 'wb') as f:
        f.write(gzip.compress(raw, 9, mtime=0))


def main():
    en = load('data/localization-en.json')
    stages = {s['stageId']: s for s in load('data/stages.json')}
    missions = load('data/missions.json')
    bg_index = {b['backgroundId']: b for b in load('backgrounds/index.json')}

    # backgrounds: one static picture each, saved as WebP previews (deduplicated by texture)
    bgs, done = {}, {}
    for bid, b in bg_index.items():
        d = load(b['file'])
        layer = next((L for L in d['layers'] if not (L.get('raw') or {}).get('isSpriteStudio') and L.get('textures')), None)
        if not layer:
            continue
        t = layer['textures'][0]; key = os.path.splitext(os.path.basename(t['file']))[0]
        if key not in done:
            out = os.path.join(OUT, 'bg', key + '.webp'); os.makedirs(os.path.dirname(out), exist_ok=True)
            if not os.path.exists(out):
                im = Image.open(os.path.join(SRC, t['file'])).convert('RGB')
                im.save(out, 'WEBP', quality=84, method=6)
                th = os.path.join(OUT, 'bg', 't', key + '.webp'); os.makedirs(os.path.dirname(th), exist_ok=True)
                im.resize((192, 192), Image.LANCZOS).save(th, 'WEBP', quality=78, method=6)
            done[key] = 1
        r = layer['raw']
        bgs[bid] = {'f': key, 'w': t['width'], 'h': t['height'], 'at': [r['x'], r['y']]}

    # enemies
    E = json.loads(gzip.open(os.path.join(SRC, 'enemies/index.json.gz')).read())
    enemies = {}
    for eid, e in E.items():
        raw = e.get('raw') or {}
        curve = [[p.get('startLevel'), p.get('endLevel'), p['hp']['s'], p['hp']['e'], p['atk']['s'], p['atk']['e'], p['def']['s'], p['def']['e']]
                 for p in raw.get('paramDatas') or [] if 'hp' in p]
        enemies[eid] = {'n': e.get('name') or ('Enemy ' + eid), 't': e.get('title') or '', 'd': e.get('catalogDonorId') if e.get('previewAvailable') else None,
                        'a': raw.get('attr'), 'r': raw.get('rare'), 'ml': raw.get('maxLevel'), 'p': curve}
    save('enemies.json.gz', enemies)

    # missions and their maps
    out_missions = []
    for m in missions:
        mid = m['missionId']; full = load(m['file'])
        sid = (m.get('stageIds') or [None])[0]; s = stages.get(sid) if sid else None
        maps = []
        for map_id in m.get('mapOrder') or []:
            p = os.path.join(SRC, 'data/maps', map_id + '.json')
            if not os.path.exists(p):
                continue
            mp = load('data/maps/' + map_id + '.json')
            chips = [[0] * mp['grid']['width'] for _ in range(mp['grid']['height'])]
            for c in mp['grid']['cells']:
                chips[c['y']][c['x']] = c['chip']
            encs = []
            for a in mp.get('encounterAlternatives') or []:
                entries = []
                for o in a.get('orderedEntries') or []:
                    r = o.get('raw') or {}
                    entries.append({k: r.get(k) for k in ENTRY_FIELDS if k in r})
                encs.append({'set': a.get('enemySetId'), 'rate': (a.get('rawSelection') or {}).get('rate'), 'entries': entries})
            maps.append({'id': map_id, 'bg': mp.get('backgroundId'), 'title': en.get((mp.get('raw') or {}).get('langMapTitleId') or '', ''),
                         'chips': chips, 'deployWays': mp.get('deployWays'), 'encounters': encs})
        objectives = [en.get(o.get('langSubMissionNameId') or '', o.get('name')) for o in full.get('objectives') or []]
        rec = {'id': mid, 'name': m.get('name') if m.get('name') not in (None, '-') else '', 'stageId': sid,
               'stage': (s or {}).get('name') or '', 'cat': ((s or {}).get('raw') or {}).get('category'),
               'stamina': full.get('stamina'), 'objectives': objectives, 'maps': maps}
        save('m/' + mid + '.json.gz', rec)
        if maps:
            out_missions.append({'id': mid, 'name': rec['name'], 'stageId': sid, 'stage': rec['stage'], 'cat': rec['cat'],
                                 'stamina': rec['stamina'], 'maps': len(maps)})
    out_missions.sort(key=lambda r: (r['stageId'] is None, int(r['stageId'] or 0), int(r['id'])))
    save('index.json.gz', {'schema': 1, 'missions': out_missions, 'backgrounds': bgs,
                           'counts': {'missions': len(out_missions), 'enemies': len(enemies), 'backgrounds': len(bgs)}})
    print('missions', len(out_missions), 'enemies', len(enemies), 'backgrounds', len(bgs), 'pictures', len(done))


if __name__ == '__main__':
    main()
