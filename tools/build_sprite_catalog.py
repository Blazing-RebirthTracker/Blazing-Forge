"""Rebuild sprites/cat/ for the Sprites tab from an animation-preview export.

usage: python3 tools/build_sprite_catalog.py <export folder> sprites/cat

The export folder holds index.json plus models/, clips/ and atlases/. Model and clip JSON is written
compactly and gzipped (the page decompresses it in the browser); atlases are losslessly optimized
with oxipng (pip install pyoxipng). Files that already exist in the output are skipped, so an
interrupted run can be resumed.
"""
import sys, os, json, gzip, glob, oxipng
from multiprocessing import Pool
SRC, OUT = sys.argv[1], sys.argv[2]
def gz(src, dst):
    data = open(src, 'rb').read()
    # re-serialize compactly so the files are as small as possible
    obj = json.loads(data); raw = json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode()
    with open(dst, 'wb') as f: f.write(gzip.compress(raw, 9, mtime=0))
def job(t):
    kind, src = t; name = os.path.basename(src)
    dst = os.path.join(OUT, kind, name + ('.gz' if kind != 'atlases' else ''))
    if os.path.exists(dst): return
    if kind == 'atlases': oxipng.optimize(src, dst, level=3, strip=oxipng.StripChunks.safe())
    else: gz(src, dst)
if __name__ == '__main__':
    for k in ('models', 'clips', 'atlases'): os.makedirs(os.path.join(OUT, k), exist_ok=True)
    ix = json.load(open(os.path.join(SRC, 'index.json'))); ix.pop('failed', None)
    raw = json.dumps(ix, separators=(',', ':'), ensure_ascii=False).encode()
    open(os.path.join(OUT, 'index.json.gz'), 'wb').write(gzip.compress(raw, 9, mtime=0))
    jobs = [(k, f) for k in ('models', 'clips') for f in sorted(glob.glob(os.path.join(SRC, k, '*.json')))]
    jobs += [('atlases', f) for f in sorted(glob.glob(os.path.join(SRC, 'atlases', '*.png')))]
    with Pool(os.cpu_count()) as p:
        for i, _ in enumerate(p.imap_unordered(job, jobs, chunksize=4)):
            if i % 500 == 0: print(i, len(jobs), flush=True)
    print('done', flush=True)
