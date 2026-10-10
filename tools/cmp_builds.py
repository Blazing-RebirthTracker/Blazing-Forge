"""Compare two Forge outputs (Python vs C): decoded tables, textures, configs."""
import sys, os, json, hashlib
sys.path.insert(0, "forge"); sys.path.insert(0, "forge/lib"); import forge, UnityPy, numpy as np
A, B = sys.argv[1], sys.argv[2]
ra, rb = os.path.join(A, "Blazing-Rebirth"), os.path.join(B, "Blazing-Rebirth")
def files(root):
    out = {}
    for r, _, fs in os.walk(root):
        for f in fs: p = os.path.join(r, f); out[os.path.relpath(p, root)] = p
    return out
fa, fb = files(ra), files(rb)
print("only in A:", sorted(set(fa) - set(fb))); print("only in B:", sorted(set(fb) - set(fa)))
bad = 0
for rel in sorted(set(fa) & set(fb)):
    da, db = open(fa[rel], "rb").read(), open(fb[rel], "rb").read()
    if da == db: continue
    if rel.endswith(".json"):
        ja, jb = json.loads(da), json.loads(db)
        skip = ("builtUtc", "sha256", "manifestSha256", "crc", "hash", "utc", "bytes", "rows")
        def strip(o):
            if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k not in skip}
            if isinstance(o, list): return [strip(x) for x in o]
            return o
        if strip(ja) != strip(jb): print("JSON DIFF", rel); bad += 1
        continue
    if rel.endswith(".png") and "images" in rel:
        from PIL import Image; import io
        ia, ib = np.asarray(Image.open(io.BytesIO(da)).convert("RGBA")).astype(int), np.asarray(Image.open(io.BytesIO(db)).convert("RGBA")).astype(int)
        print("png", rel, "max px diff", np.abs(ia - ib).max(), "mean", round(np.abs(ia - ib).mean(), 2)); continue
    ea, eb = UnityPy.load(da), UnityPy.load(db)
    ta = [o for o in ea.objects if o.type.name == "TextAsset"]
    if ta:
        sa = ta[0].read_typetree()["m_Script"]; sb = [o for o in eb.objects if o.type.name == "TextAsset"][0].read_typetree()["m_Script"]
        sa = sa.encode("utf-8", "surrogateescape") if isinstance(sa, str) else bytes(sa); sb = sb.encode("utf-8", "surrogateescape") if isinstance(sb, str) else bytes(sb)
        try: va, vb = json.loads(forge.obf.decode(sa)), json.loads(forge.obf.decode(sb))
        except Exception: va, vb = sa, sb
        def strip(o):
            if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k not in ("utc",)}
            if isinstance(o, list): return [strip(x) for x in o]
            return o
        same = strip(va) == strip(vb)
        if not same and isinstance(va, list) and isinstance(vb, list):
            # asset lists: compare by asset_path, ignoring hash/crc/size of bundles that differ in bytes
            ka = {x["asset_path"]: x for x in va}; kb = {x["asset_path"]: x for x in vb}
            same = set(ka) == set(kb)
        print(("ok   " if same else "DIFF ") + rel); bad += not same; continue
    texa = {o.read().m_Name: o.read() for o in ea.objects if o.type.name == "Texture2D"}
    texb = {o.read().m_Name: o.read() for o in eb.objects if o.type.name == "Texture2D"}
    if set(texa) != set(texb): print("TEX NAMES DIFF", rel, set(texa) ^ set(texb)); bad += 1; continue
    worst = 0
    for n in texa:
        a, b = texa[n], texb[n]
        if (a.m_Width, a.m_Height) != (b.m_Width, b.m_Height): print("size diff", rel, n); bad += 1; continue
        ia, ib = np.asarray(a.image).astype(int), np.asarray(b.image).astype(int)
        worst = max(worst, np.abs(ia - ib).max())
    abA = [o.read_typetree() for o in ea.objects if o.type.name == "AssetBundle"][0]; abB = [o.read_typetree() for o in eb.objects if o.type.name == "AssetBundle"][0]
    ca = sorted(k for k, _ in abA["m_Container"]); cb = sorted(k for k, _ in abB["m_Container"])
    print(f"tex  {rel}: {len(texa)} textures, worst pixel diff {worst}, container same {ca == cb}, name {abA['m_Name']==abB['m_Name']}")
    if ca != cb: bad += 1
print("PROBLEMS:", bad)
