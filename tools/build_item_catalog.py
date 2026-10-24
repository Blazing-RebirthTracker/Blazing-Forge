"""Build tools/data/item-catalog.json (and stages/cat/items/*.png) from a stage package's catalogs/rewards.json.

usage: python3 tools/build_item_catalog.py <extracted stage package>

Keeps the game's own item list: English name and title, rarity, element, type and the stat bonuses an item carries
when it's given out (the HP / ATK / Speed pills only work through these). Items registered for one package only
("registered-custom") and reserved material slots are left out. Exact card textures the package ships are copied to
stages/cat/items/<id>.png so the reward pickers can show them.
"""
import json, os, shutil, sys

def shrink(path):  # a small copy is enough for a picker thumbnail
    from PIL import Image
    im = Image.open(path).convert('RGBA'); im.thumbnail((160, 160), Image.LANCZOS); im.save(path, optimize=True)

pkg = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = json.load(open(os.path.join(pkg, 'catalogs/rewards.json'), encoding='utf-8'))['items']
out, art = {}, 0
for i, v in sorted(src.items(), key=lambda kv: int(kv[0])):
    if v.get('availability') != 'original-client-catalog': continue
    b = v.get('defaultBonuses') or {}
    o = {'n': v['name'], 't': v.get('title') or '', 'r': v.get('rarity'), 'a': int(v['attributeId']) if v.get('attributeId') else None, 'k': v.get('type3', 0)}
    if any(b.get(k) for k in ('s', 'a', 'd', 'sp')): o['b'] = [b.get('s', 0), b.get('a', 0), b.get('d', 0), b.get('sp', 0)]
    if v.get('thumbnail'):
        dst = os.path.join(root, "stages/cat/items", i + ".png"); shutil.copyfile(os.path.join(pkg, v["thumbnail"]), dst); shrink(dst); o['i'] = 1; art += 1
    out[i] = {k: x for k, x in o.items() if x not in (None, '')}
with open(os.path.join(root, 'tools/data/item-catalog.json'), 'w', encoding='utf-8') as f:
    json.dump({'schema': 1, 'note': 'From the game client item list in the supplied stage package. Not a promise that the app pays out any item.', 'items': out}, f, ensure_ascii=False, separators=(',', ':'))
print('items', len(out), 'with bonuses', sum(1 for v in out.values() if 'b' in v), 'with card art', art)
