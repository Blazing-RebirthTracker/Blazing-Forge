"""Blazing Forge Studio <-> Forge mod folder.

  python3 tools/studio.py seed   <moddir> <assetmap.json> <out.json>    mod folder -> Studio database documents
  python3 tools/studio.py build  <studio.json> <assetsdir> <outmoddir>   Studio documents (+ downloaded assets) -> mod folder

studio.json is {"characters": {id: doc}, "banners": {id: doc}, "summon": doc, "settings": {"gifts": doc}}, i.e. what the
Studio page keeps in its database (the same shape its "Save mod pack" export writes, minus the art files).
assetmap.json maps a file name in the mod folder to its Studio asset id (from the asset upload).
"""
import json, os, sys, glob, shutil, copy

SKILL_KEYS = ("jutsu", "ultimate", "latent")


def jl(p): return json.load(open(p, encoding="utf-8"))


def jd(o, p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(o, open(p, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


# ------------------------------------------------------------------ mod -> studio
def ability_doc(x):
    if isinstance(x, int): return {"id": x}
    return {k: x[k] for k in ("name", "description", "script", "secondScript", "iconType") if k in x}


def skill_doc(sk, vis, kind):
    if not sk: return None
    d = copy.deepcopy(sk)
    eff = (vis or {}).get(kind + "Effect")
    if eff: d["effectFrom"] = eff
    return d


def seed(moddir, assetmap):
    am = jl(assetmap)
    files = sorted(glob.glob(os.path.join(moddir, "units", "*.json")))
    specs = {jl(f)["slot"]: jl(f) for f in files}
    chars = {}
    for slot5, r5 in sorted(specs.items()):
        r6 = specs.get(slot5 + 1)
        if r6 is None or (slot5 - 1) in specs and specs[slot5 - 1].get("name") == r5.get("name") and slot5 % 10 == 6: continue
        if slot5 % 10 != 5: continue
        slot = r6["slot"]
        key = os.path.basename([f for f in files if jl(f)["slot"] == slot][0]).split("-")[1]
        vis = r6.get("visuals", {})
        doc = {"name": r6["name"], "subtitle": r6.get("subtitle", ""), "attribute": r6.get("attribute", 0),
               "slot5": r5["slot"], "slot6": r6["slot"], "donor": r6["donor"], "gift": r6.get("gift", True),
               "giftMessage": r6.get("giftMessage", ""), "cardImageId": r6.get("cardImageId", 0),
               "art": {"card": am.get(r6["art"].get("card"), ""), "icon": am.get(r6["art"].get("icon"), ""), "chakra": am.get(r6["art"].get("chakraIcon"), "")},
               "stats": {"from5": r5["stats"].get("from", 0), "from6": r6["stats"].get("from", 0),
                         "boost": round((r6["stats"].get("boost", 1) - 1) * 100, 2), "maxLimitBreak": r6["stats"].get("maxLimitBreak", True)},
               "abilities": [ability_doc(x) for x in r6.get("abilities", [])],
               "visuals": {"ultimateVideo": vis.get("ultimateVideo", 1) not in (0, "0", None, "none"),
                           **({"rig": vis["rig"]} if "rig" in vis else {}), **({"cutin": vis["cutin"]} if "cutin" in vis else {})},
               "notes": ""}
        a5 = [ability_doc(x) for x in r5.get("abilities", [])]
        if a5 != doc["abilities"][:4]: doc["abilities5"] = a5
        for kind in SKILL_KEYS:
            doc[kind] = skill_doc(r6.get(kind), vis, kind)
            if kind != "latent" and r5.get(kind) != r6.get(kind):
                base = r6.get(kind) or {}
                diff = {k: v for k, v in (r5.get(kind) or {}).items() if base.get(k) != v}
                if r5.get(kind) is None: diff = {"none": True}
                if doc[kind] is None and r5.get(kind): doc[kind] = {"r5only": True}
                if diff: doc[kind]["r5"] = diff
        fs = r6.get("fieldSkill")
        doc["fieldSkill"] = {"mode": "donor"} if fs is None else {"mode": "existing", "id": fs} if isinstance(fs, int) else {"mode": "custom", **fs}
        bs = r6.get("buddySkill")
        doc["buddySkill"] = {"mode": "donor"} if bs is None else {"mode": "existing", "id": bs}
        chars[key] = doc
    by_slot5 = {d["slot5"]: k for k, d in chars.items()}
    banners = {}
    for f in sorted(glob.glob(os.path.join(moddir, "banners", "*.json"))):
        b = jl(f)
        banners["b" + str(b["id"])] = {"bannerId": b["id"], "name": b["name"], "ticker": b.get("ticker", ""), "copyFrom": b.get("copyFrom"),
                                       "basePool": b.get("basePool", "festival"), "featured": [by_slot5.get(x, str(x)) for x in b.get("featured", [])],
                                       "featuredWeight": b.get("featuredWeight", 100), "enabled": True,
                                       "art": {"front": am.get(b["art"]["front"], "")}}
    summon = None
    sp = os.path.join(moddir, "summon", "summon.json")
    if os.path.exists(sp):
        cfg = jl(sp); parts = []
        for tex, tparts in cfg["textures"].items():
            for cell, pc in tparts.items():
                params = {k: v for k, v in pc.items() if k not in ("file", "silhouette")}
                mode = "shadow" if "shadowFrom" in pc else "cleared" if pc.get("clear") else "tinted" if ("tint" in pc or "recolorGrey" in pc) else None
                parts.append({"texture": tex, "cell": cell, "label": os.path.splitext(os.path.basename(pc.get("file", "")))[0] or cell,
                              "asset": am.get("summon/" + pc["file"], "") if "file" in pc else "",
                              "silhouette": am.get("summon/" + pc["silhouette"], "") if "silhouette" in pc else "",
                              "mode": mode, "params": params})
        summon = {"enabled": cfg.get("enabled", True), "bundle": cfg["bundle"], "parts": parts}
    gifts = jl(os.path.join(moddir, "gifts.json")) if os.path.exists(os.path.join(moddir, "gifts.json")) else []
    return {"characters": chars, "banners": banners, "summon": summon, "settings": {"gifts": {"items": gifts}}}


# ------------------------------------------------------------------ studio -> mod
def build(studio, assetsdir, out):
    if os.path.exists(out): shutil.rmtree(out)
    os.makedirs(os.path.join(out, "units"))
    def art(aid, name, sub="units"):
        if not aid: return None
        src = next((p for p in glob.glob(os.path.join(assetsdir, aid + "*"))), None)
        if not src: sys.exit(f"asset {aid} ({name}) was not downloaded into {assetsdir}")
        dst = os.path.join(out, sub, name); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy(src, dst)
        return name
    taken = {}
    # custom field skills rewrite an unused field-skill row ("reuse"); one row per distinct script
    cat = jl(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "catalog.json"))
    spare = [int(k) for k, v in sorted(cat["field"].items(), key=lambda kv: int(kv[0])) if v[3]]
    rows = {}
    for c in studio["characters"].values():
        fs = c.get("fieldSkill") or {}
        if fs.get("mode") == "custom" and fs.get("script") and fs.get("reuse"):
            rows.setdefault((fs["script"], fs.get("secondScript", "")), int(fs["reuse"]))
    used = set(rows.values())
    for c in studio["characters"].values():
        fs = c.get("fieldSkill") or {}
        if fs.get("mode") == "custom" and fs.get("script") and not fs.get("reuse"):
            key = (fs["script"], fs.get("secondScript", ""))
            if key not in rows:
                rows[key] = next(x for x in spare if x not in used); used.add(rows[key])
            fs["reuse"] = rows[key]
    for cid, c in sorted(studio["characters"].items()):
        if not (c.get("slot5") and c.get("slot6") and c.get("donor")): sys.exit(f"{c.get('name')}: slot and donor are required")
        for s in (c["slot5"], c["slot6"]):
            if s in taken: sys.exit(f"{c['name']} and {taken[s]} both use slot {s}")
            taken[s] = c["name"]
        a = c.get("art", {})
        files = {k: art(a.get(k), f"{cid}-{k}.png") for k in ("card", "icon", "chakra")}
        for star in (5, 6):
            u = {"donor": int(c["donor"]), "name": c["name"], "subtitle": c.get("subtitle", ""), "slot": int(c[f"slot{star}"])}
            if c.get("attribute"): u["attribute"] = int(c["attribute"])
            if files["card"]:
                u["art"] = {"card": files["card"], **({"icon": files["icon"]} if files["icon"] else {}), **({"chakraIcon": files["chakra"]} if files["chakra"] else {})}
                u["cardImageId"] = int(c.get("cardImageId") or 30000 + int(c["slot6"]) % 10000)
            u["gift"] = bool(c.get("gift", True)) if star == 6 else False
            if star == 6 and c.get("giftMessage"): u["giftMessage"] = c["giftMessage"]
            st = c.get("stats", {})
            src = st.get(f"from{star}") or st.get("from6") or st.get("from5")
            if src: u["stats"] = {"from": int(src), "maxLimitBreak": st.get("maxLimitBreak", True), "boost": round(1 + float(st.get("boost", 0)) / 100, 4)}
            abil = c.get("abilities5") if (star == 5 and c.get("abilities5") is not None) else (c.get("abilities", [])[:4] if star == 5 else c.get("abilities", []))
            if abil:
                u["abilities"] = [x["id"] if "id" in x else {k: x[k] for k in ("name", "description", "script", "secondScript", "iconType") if x.get(k) not in (None, "")} for x in abil]
            vis = {}
            v = c.get("visuals", {})
            if v.get("ultimateVideo") is False: vis["ultimateVideo"] = 0
            for k in ("rig", "cutin"):
                if v.get(k): vis[k] = int(v[k])
            for kind in SKILL_KEYS:
                sk = c.get(kind)
                if not sk or (kind == "latent" and star == 5): continue
                if sk.get("effectFrom") and kind != "latent": vis[kind + "Effect"] = int(sk["effectFrom"])
                base = {k: val for k, val in sk.items() if k not in ("r5", "effectFrom", "copiedFrom", "copiedText", "r5only") and val not in (None, "")}
                if star == 5 and sk.get("r5"):
                    if sk["r5"].get("none"): continue
                    base.update({k: val for k, val in sk["r5"].items() if val not in (None, "")})
                if sk.get("r5only") and star == 6: continue
                if kind != "latent" and not base.get("script"): continue      # nothing filled in: keep the donor's
                if kind == "latent" and not base.get("from"): base["from"] = int(c["donor"])
                u[kind] = base
            if vis: u["visuals"] = vis
            fs = c.get("fieldSkill") or {"mode": "donor"}
            if fs["mode"] == "existing" and fs.get("id"): u["fieldSkill"] = int(fs["id"])
            elif fs["mode"] == "custom" and fs.get("script"):
                u["fieldSkill"] = {k: fs[k] for k in ("reuse", "script", "secondScript") if fs.get(k) not in (None, "")}
            bs = c.get("buddySkill") or {"mode": "donor"}
            if bs["mode"] == "existing" and bs.get("id"): u["buddySkill"] = int(bs["id"])
            jd(u, os.path.join(out, "units", f"{u['slot']}-{cid}-r{star}.json"))
    by_id = {cid: c for cid, c in studio["characters"].items()}
    for bid, b in sorted(studio.get("banners", {}).items()):
        if b.get("enabled") is False: continue
        feats = [int(by_id[x]["slot5"]) if x in by_id else int(x) for x in b.get("featured", [])]
        spec = {"id": int(b["bannerId"]), "name": b["name"], "ticker": b.get("ticker") or b["name"], "copyFrom": b.get("copyFrom") or 60001,
                "basePool": b.get("basePool") or "festival", "featured": feats, "featuredWeight": int(b.get("featuredWeight") or 100), "art": {}}
        f = art(b.get("art", {}).get("front"), f"{bid}-front.png", "banners")
        if f: spec["art"]["front"] = f
        jd(spec, os.path.join(out, "banners", f"{bid}.json"))
    sm = studio.get("summon")
    if sm and sm.get("parts"):
        cfg = {"bundle": sm["bundle"], "enabled": sm.get("enabled", True) is not False, "textures": {}}
        for p in sm["parts"]:
            pc = dict(p.get("params", {}))
            if p.get("asset"): pc["file"] = art(p["asset"], f"{p['texture']}-{p['cell']}.png", "summon")
            if p.get("silhouette"): pc["silhouette"] = art(p["silhouette"], f"{p['texture']}-{p['cell']}-silhouette.png", "summon")
            cfg["textures"].setdefault(p["texture"], {})[p["cell"]] = pc
        jd(cfg, os.path.join(out, "summon", "summon.json"))
    gifts = (studio.get("settings", {}).get("gifts") or {}).get("items")
    if gifts: jd(gifts, os.path.join(out, "gifts.json"))
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "seed":
        jd(seed(sys.argv[2], sys.argv[3]), sys.argv[4]); print("wrote", sys.argv[4])
    elif cmd == "build":
        print("mod folder:", build(jl(sys.argv[2]), sys.argv[3], sys.argv[4]))
