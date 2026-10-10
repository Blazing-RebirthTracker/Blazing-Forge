#!/usr/bin/env python3
"""Blazing Forge: add custom units to Blazing:Rebirth (iOS offline, game data v1 / 2.28.0).

  python forge.py fetch  --base base/                 # pull only the files Forge needs (~150 MB) from the data release
  python forge.py donors --base base/                 # list units that are safe to use as a donor
  python forge.py build  --base base/ --mod mymod/ --engine BlazingEngine.json --out out/
  python forge.py verify --base base/ --out out/

A mod folder holds units/*.json plus the art they reference. See README.md.
"""
import argparse, copy, glob, hashlib, json, os, re, shutil, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import obf, unityfs, bundles  # noqa: E402
from PIL import Image  # noqa: E402

R = "/assets/iOS/"
ROUTE_UNIT = R + "language/en/unitdata/unitlist.bytes"
ROUTE_SKILL = R + "unitdatabin/skilllist.bytes"
ROUTE_LANG = R + "language/en/stringbin/languagedata.bytes"
ROUTE_TRIM = R + "idlist/trimmingcarddata.bytes"
ROUTE_CARDLIST = R + "idlist/cardimagelist.txt"
ROUTE_ICONLIST_TXT = R + "idlist/iconimagelist.txt"
ROUTE_ICONS = R + "iconlist/iconlist"
ROUTE_ABIL = R + "unitdatabin/abilityskilllist.bytes"
ROUTE_THUMBS_TXT = R + "idlist/thumbnailimagelist.txt"   # battle face icons ("chakra icons"), keyed by iconImageId
ROUTE_THUMBS = R + "thumbnaillist/thumbnaillist"
LIST_MAIN = "content-ios/iOS/assetbundlelistbin/assetbundlelist_en.bytes"
LIST_FIRST = "content-ios/iOS/assetbundlelistbin/assetbundlelist_first_en.bytes"
PARAM = "content-ios/iOS/assetbundlelist_param.json"
CHARS = "content/config/core/characters/cache-valid-characters-2.28.0.json"
UEXP = "content/config/core/characters/unit-experience-2.28.0.json"
PRESENTS = "content/config/catalogs/presents.json"
MODS_DIR = "mods"  # new files go to content-ios/mods/<asset path>
ATTR_NAMES = {}  # left numeric on purpose: copy the code from a donor of the element you want

def jload(p): return json.load(open(p, encoding="utf-8"))
def jdump(o, p, indent=1):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f: json.dump(o, f, indent=indent, ensure_ascii=False)
def sha(b): return hashlib.sha256(b).hexdigest()

# ---------------------------------------------------------------- base data
class Base:
    def __init__(self, root):
        self.root = root
        self.routes = jload(self.p("content-ios/ios-routes.json"))
        self.pack = jload(self.p("pack/manifest.json"))
    def p(self, rel): return os.path.join(self.root, "BlazingData", rel)
    def read(self, rel):
        if not os.path.exists(self.p(rel)):
            import rzip  # fetch a missing game file on demand from the data release
            rzip_get(rzip, self.root, [rel])
        return open(self.p(rel), "rb").read()
    def route_rel(self, route): return "content-ios/" + self.routes[route]["file"]
    def route_bytes(self, route): return self.read(self.route_rel(route))
    def pack_asset(self, route_android):
        for f in self.pack["files"]:
            if f["route"] == route_android: return f
        raise KeyError(route_android)

def needed_files(base_root):
    rel = ["blazing-data.json", "content-ios/ios-content.json", "content-ios/ios-routes.json", PARAM, LIST_MAIN, LIST_FIRST,
           "pack/manifest.json", "pack/playableunits.json", "pack/progressionunits.json", CHARS, UEXP, PRESENTS]
    return rel

def cmd_fetch(a):
    import rzip
    root = a.base
    first = needed_files(root)
    rzip_get(rzip, root, first)
    b = Base(root)
    more = [b.route_rel(r) for r in (ROUTE_UNIT, ROUTE_SKILL, ROUTE_LANG, ROUTE_TRIM, ROUTE_CARDLIST, ROUTE_ICONLIST_TXT, ROUTE_ICONS, ROUTE_THUMBS_TXT, ROUTE_THUMBS)]
    more += ["pack/" + b.pack_asset(r.replace("/iOS/", "/Android/"))["asset"] for r in (ROUTE_UNIT, ROUTE_SKILL)]
    rzip_get(rzip, root, more)
    units = json.loads(obf.decode(bundles.read_text(b.route_bytes(ROUTE_UNIT))))["datas"]
    cards = sorted({u["cardImageId"] for u in units if u["id"] in safe_donor_ids(b)})
    rzip_get(rzip, root, [b.route_rel(R + f"card/img_card_{c:05d}.png") for c in cards if (R + f"card/img_card_{c:05d}.png") in b.routes])
    print("base ready:", root)

def rzip_get(rzip, root, rels):
    rels = [r for r in rels if not os.path.exists(os.path.join(root, "BlazingData", r))]
    if not rels: return
    ents = rzip.load_index()
    want = {"BlazingData/" + r for r in rels}
    for e in ents:
        if e[0] in want:
            dst = os.path.join(root, e[0]); os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, "wb").write(rzip.fetch(e)); print("  fetched", e[0][12:], e[3])

_client_units = {}
def client_units(b):
    if not _client_units:
        _client_units.update({u["id"]: u for u in json.loads(obf.decode(bundles.read_text(b.route_bytes(ROUTE_UNIT))))["datas"]})
    return _client_units

def catalog(b):
    return {u["unitId"]: u for u in json.loads(b.read(CHARS))["units"]}

def part_ok(c, part):
    """part: rig | cutin | jutsu | ultimate. Uses the Rebirth asset audit in the character catalog."""
    if c is None: return False
    cov = c["sourceCoverage"]
    if part == "rig": return bool(c["capabilities"].get("spriteAnimationReady"))
    key = {"cutin": "cutIn", "jutsu": "primaryEffect", "ultimate": "ultimateEffect"}[part]
    return cov.get(key) not in ("missing", None)

def cri_has_audio(b, cri):
    """True if an ultimate video (crimovie/<cri>.bytes, a USM) carries an embedded audio stream (@SFA chunks).
    Every video that plays fine in this build is video-only; one with audio crashed Kakashi's ultimate."""
    route = R + f"crimovie/{cri}.bytes"
    if route not in b.routes: return False
    return b"@SFA" in bundles.read_text(b.route_bytes(route))

def safe_donor_ids(b):
    """Units whose battle rig exists in this build (checked against the Rebirth asset audit; a rig that is
    missing draws as white boxes in battle)."""
    return {uid for uid, c in catalog(b).items() if part_ok(c, "rig")}

def cmd_donors(a):
    b = Base(a.base)
    C = catalog(b)
    mark = lambda c, p: "ok" if part_ok(c, p) else ("n/a" if c["sourceCoverage"].get({"cutin": "cutIn", "jutsu": "primaryEffect", "ultimate": "ultimateEffect"}[p]) == "not-applicable" else "--")
    print("  id    rar  rig  cutin jutsu ult   name")
    for uid in sorted(safe_donor_ids(b)):
        c = C[uid]; i = c["identity"]
        print(f"{uid:6d}  {c['rare']}*   ok   {mark(c,'cutin'):5} {mark(c,'jutsu'):5} {mark(c,'ultimate'):5} {i['name']} - {i['subtitle']}")
    print("rig = battle body/animations. Missing cut-ins or effects can be borrowed per unit with \"visuals\" (see README).")

def cmd_slots(a):
    """Spare slots: duplicate entries the server already knows (same name, subtitle and rarity as another unit)."""
    b = Base(a.base)
    import collections
    C = jload(b.p(CHARS))["units"]; by = collections.defaultdict(list)
    for u in C:
        i = u["identity"]; by[(i["name"], i["subtitle"], u["rare"])].append(u["unitId"])
    print("slot   rarity  duplicate of (keep the original, use the slot)")
    for (name, sub, rare), ids in sorted(by.items(), key=lambda kv: -max(kv[1])):
        if len(ids) < 2: continue
        ids = sorted(ids)
        for spare in ids[1:]:
            print(f"{spare:6d}  {rare}*     {ids[0]}  {name} - {sub}")

# ---------------------------------------------------------------- build
class Text:
    """A decoded ObfuscatedText TextAsset inside a bundle."""
    def __init__(self, bundle):
        self.bundle = bundle
        self.raw_enc = bundles.read_text(bundle)
        self.seed = int.from_bytes(self.raw_enc[:4], "little")
        self.data = obf.decode(self.raw_enc)
    def json(self): return json.loads(self.data)
    def rebuild(self, obj):
        data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return bundles.replace_text(self.bundle, obf.encode(data, self.seed))

def lang_add(lss_index, lss, prefix, start, text):
    n = start
    while f"{prefix}{n}" in lss_index: n += 1
    key = f"{prefix}{n}"
    e = {"id": key, "lines": 1, "languageString": text}
    lss.append(e); lss_index[key] = e
    return key

def fit_card(img):
    img = img.convert("RGBA")
    m = max(img.size)
    if m > 1024:
        s = 1024 / m; img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    return img

def icon_from(img):
    img = img.convert("RGBA"); w, h = img.size; s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 4, (w - s) // 2 + s, (h - s) // 4 + s)).resize((128, 128), Image.LANCZOS)

def chakra_from(icon):
    """Round 128x128 battle face icon (the game's img_chakraicon_ style) from a box icon."""
    from PIL import ImageDraw, ImageChops
    icon = icon.convert("RGBA").resize((128, 128), Image.LANCZOS)
    m = Image.new("L", (512, 512), 0); ImageDraw.Draw(m).ellipse((8, 8, 503, 503), fill=255)
    m = m.resize((128, 128), Image.LANCZOS)
    icon.putalpha(ImageChops.multiply(icon.getchannel("A"), m))
    return icon

def apply_overlay(icon, overlay):
    """Composite an effect layer (e.g. one film-grain frame) onto a 128x128 icon at 1:1 pixel scale,
    centre-cropped, and only where the icon art itself is drawn."""
    icon = icon.convert("RGBA").resize((128, 128), Image.LANCZOS) if icon.size != (128, 128) else icon.convert("RGBA")
    o = overlay.convert("RGBA")
    if o.width < 128 or o.height < 128: o = o.resize((128, 128), Image.LANCZOS)
    cx, cy = (o.width - 128) // 2, (o.height - 128) // 2
    o = o.crop((cx, cy, cx + 128, cy + 128))
    from PIL import ImageChops
    o.putalpha(ImageChops.multiply(o.getchannel("A"), icon.getchannel("A")))
    out = icon.copy(); out.alpha_composite(o)
    return out

def scale_curve(c, k):
    return {"s": max(1, round(c["s"] * k)) if c["s"] else 0, "e": max(1, round(c["e"] * k)) if c["e"] else 0, "p": c["p"]}

def cmd_build(a):
    b = Base(a.base)
    out_root = os.path.join(a.out, "Blazing-Rebirth")
    if os.path.exists(a.out): shutil.rmtree(a.out)
    D = lambda rel: os.path.join(out_root, "BlazingData", rel)
    specs = []
    for p in sorted(glob.glob(os.path.join(a.mod, "units", "*.json"))):
        s = jload(p); s["_dir"] = os.path.dirname(os.path.abspath(p)); specs.append(s)
    if not specs: sys.exit("no units/*.json in mod folder")

    unit_t = Text(b.route_bytes(ROUTE_UNIT)); U = unit_t.json(); units = {u["id"]: u for u in U["datas"]}
    skill_t = Text(b.route_bytes(ROUTE_SKILL)); S = skill_t.json(); skills = {s["id"]: s for s in S["datas"]}
    lang_t = Text(b.route_bytes(ROUTE_LANG)); L = lang_t.json(); lss = L["dataLsd"]["lss"]; lidx = {e["id"]: e for e in lss}
    trim_t = Text(b.route_bytes(ROUTE_TRIM)); T = trim_t.json(); trims = {t["id"]: t for t in T["trimmingList"]["trimmingDatas"]}
    cardlist = bundles.read_text(b.route_bytes(ROUTE_CARDLIST)).decode("utf-8")
    iconlist_txt = bundles.read_text(b.route_bytes(ROUTE_ICONLIST_TXT)).decode("utf-8")
    icons_bundle = b.route_bytes(ROUTE_ICONS)
    thumbs_txt = bundles.read_text(b.route_bytes(ROUTE_THUMBS_TXT)).decode("utf-8")
    thumbs_bundle = None
    chars = jload(b.p(CHARS)); cidx = {u["unitId"]: u for u in chars["units"]}
    uexp = jload(b.p(UEXP)); presents = jload(b.p(PRESENTS))
    playable = jload(b.p("pack/playableunits.json")); progression = jload(b.p("pack/progressionunits.json"))
    donors_ok = safe_donor_ids(b)

    new_bundles = {}   # asset_path -> bytes   (new or changed iOS bundles)
    abil_t = None; abil = {}; abil_made = {}
    fb_tables = {"field": {"t": None, "rows": {}, "changed": False}, "buddy": {"t": None, "rows": {}, "changed": False}}
    icons_changed = False
    report = []
    any_new_ids = False
    used_slots = set()
    for s in specs:
        slot_mode = "slot" in s
        if not slot_mode:
            if not a.allow_new_ids:
                sys.exit(f"{s.get('id')}: set \"slot\" in the unit file. This Rebirth build's offline server is locked to its own "
                         "unit list, so brand-new unit IDs stop it from starting (see README, 'Slots'). "
                         "Use --allow-new-ids only with a server whose lock is patched.")
            any_new_ids = True
        uid = int(s["slot"] if slot_mode else s["id"]); donor_id = int(s["donor"])
        s["id"] = uid
        if donor_id not in units: sys.exit(f"{uid}: donor {donor_id} not found")
        if donor_id not in donors_ok and "rig" not in s.get("visuals", {}):
            print(f"warning: donor {donor_id} has no battle rig in this build (white boxes); set visuals.rig to a unit from 'donors'")
        if not (0 < uid <= 499999): sys.exit(f"{uid}: id must be 1..499999")
        if slot_mode:
            if uid not in units or uid not in cidx: sys.exit(f"{uid}: slot must be a unit the offline server already knows")
            if uid == donor_id: sys.exit(f"{uid}: slot and donor must be different units")
            if uid in used_slots: sys.exit(f"{uid}: two unit files use the same slot")
            used_slots.add(uid)
        elif uid in units and not units[uid].get("_forge"): sys.exit(f"{uid}: id already used by the game")
        d = units[donor_id]; u = copy.deepcopy(d); u["_forge"] = True
        u["id"] = uid
        if slot_mode:
            # the server still treats the slot as its original unit: keep what it checks or computes itself
            sl = units[uid]
            for k in ("sameId", "rare", "cost", "maxLevel", "exp", "price", "mixExp", "albumId", "charaNameId", "exLimitMax"):
                if k in sl: u[k] = copy.deepcopy(sl[k])
            stat_keys = ("hp", "atk", "def", "defPvP", "l_hp", "l_atk", "l_def", "l_spe")
            dp = d["paramDatas"][0] if d.get("paramDatas") else {}
            u["paramDatas"] = copy.deepcopy(sl["paramDatas"])
            for blk in u["paramDatas"]:
                for k in stat_keys:
                    if k in dp: blk[k] = copy.deepcopy(dp[k])
            if "rarity" in s or "cost" in s: print(f"note: {uid}: rarity and cost come from the slot in slot mode")
            if "displayRarity" in s:
                # client-only: the game draws stars and plays the 7-star shine from this value; the server keeps the slot's
                u["rare"] = int(s["displayRarity"])
        else:
            u["sameId"] = int(s.get("sameId", uid // 10))
            u["rare"] = int(s.get("rarity", d["rare"]))
            u["cost"] = int(s.get("cost", d["cost"]))
        u["attr"] = int(s.get("attribute", d["attr"]))
        if "jutsuChakra" in s: u["start_chakura"] = int(s["jutsuChakra"])
        if "ultimateChakra" in s: u["chakuraMax"] = int(s["ultimateChakra"])
        if "abilities" in s:
            # each entry: an existing ability id, or {"name", "description", "script", "iconType"} for a new one
            # (a new ability copies the first existing ability using the same script command, for its icon and flags)
            ab = []
            for x in s["abilities"][:10]:
                if isinstance(x, dict):
                    if abil_t is None: abil_t = Text(b.route_bytes(ROUTE_ABIL)); abil = {e["id"]: e for e in abil_t.json()["datas"]}
                    key = json.dumps({k: x.get(k) for k in ("name", "description", "script", "secondScript", "iconType")}, sort_keys=True)
                    if key not in abil_made:
                        cmd = x["script"].split(":")[0]
                        tmpl = next((e for e in abil.values() if e["script"].split(":")[0] == cmd), next(iter(abil.values())))
                        e = copy.deepcopy(tmpl); aid = 90001
                        while aid in abil: aid += 1
                        e.update(id=aid, script=x["script"], secondScript=str(x.get("secondScript", "0")))
                        if "iconType" in x: e["iconType"] = int(x["iconType"])
                        e["nameLangId"] = lang_add(lidx, lss, "ability_name_", 5000, x["name"])
                        e["explanationLangId"] = lang_add(lidx, lss, "ability_detail_", 5000, x.get("description", ""))
                        abil[aid] = e; abil_made[key] = aid
                    ab.append(abil_made[key])
                else: ab.append(int(x))
            u["abilityID"] = ab + [0] * (10 - len(ab))
        st = s.get("stats", {})
        k_hp, k_atk, k_spd = float(st.get("hp", 1)), float(st.get("atk", 1)), float(st.get("speed", 1))
        for blk in [u] + u["paramDatas"]:
            if "hp" in blk: blk["hp"] = scale_curve(blk["hp"], k_hp)
            if "atk" in blk: blk["atk"] = scale_curve(blk["atk"], k_atk)
            if "l_hp" in blk: blk["l_hp"] = scale_curve(blk["l_hp"], k_hp)
            if "l_atk" in blk: blk["l_atk"] = scale_curve(blk["l_atk"], k_atk)
            if "l_spe" in blk: blk["l_spe"] = scale_curve(blk["l_spe"], k_spd)
        if "from" in st:
            # stats taken from another unit (e.g. the original it remakes), at its max limit break, times "boost":
            # each curve keeps its shape and is scaled so its top value = the source's top value x boost
            src_u = units[int(st["from"])]; blocks = src_u["paramDatas"]
            top = blocks[-1] if st.get("maxLimitBreak", True) else blocks[0]
            boost = float(st.get("boost", 1))
            for k in ("hp", "atk", "l_hp", "l_atk", "l_spe", "def", "l_def"):
                if k not in blocks[0] or not top[k]["e"]: continue
                f = top[k]["e"] * boost / blocks[0][k]["e"]
                curve = {"s": max(1, round(blocks[0][k]["s"] * f)), "e": max(1, round(top[k]["e"] * boost)), "p": blocks[0][k]["p"]}
                for blk in [u] + u["paramDatas"]:
                    if k in blk: blk[k] = copy.deepcopy(curve)
        u["langId"] = lang_add(lidx, lss, "ch_name_", 5000, s["name"])
        u["langId2"] = lang_add(lidx, lss, "ch_code_", 9000, s.get("subtitle", ""))
        for k in list(u):
            if k in ("evoId", "evo2Id") or re.match(r"sozai\d?Id\d$", k):
                # slots keep their own evolution chain (the server's progression follows it); new IDs have none
                u[k] = units[uid].get(k, 0) if slot_mode else 0
        # skills
        for kind, field, pvp, base_prefix in (("jutsu", "skillId", "skillIdPvP", 100000), ("ultimate", "sSkillId", "sSkillIdPvP", 200000)):
            spec = s.get(kind)
            if not spec: continue
            src = skills[d[field]]
            sk = copy.deepcopy(src)
            sid = int(spec.get("id", base_prefix + uid if uid < 100000 else base_prefix * 10 + uid))
            while sid in skills and not skills[sid].get("_forge"): sid += 1
            sk["id"] = sid; sk["_forge"] = True
            if "name" in spec: sk["langNameID"] = lang_add(lidx, lss, "skill_name_", 5000, spec["name"])
            if "description" in spec:
                sk["langInfoID"] = sk["langEffectInfo1ID"] = lang_add(lidx, lss, "skill_detail_", 5000, spec["description"])
            for key in ("script", "secondScript", "turn", "rangeType", "range1", "range2", "push", "circleId", "type"):
                if key in spec: sk[key] = spec[key]
            skills[sid] = sk; u[field] = sid; u[pvp] = sid
        # field and buddy skills: an existing id, or {"from": id, "script", "secondScript", "name", "description"}
        for kind, fields, tbl_name in (("fieldSkill", ("fieldSkillId", "fieldSkillIdPvP"), "field"), ("buddySkill", ("buddySkillId",), "buddy")):
            fs = s.get(kind)
            if fs is None: continue
            tbl = fb_tables[tbl_name]
            if tbl["t"] is None:
                tbl["t"] = Text(b.route_bytes(R + f"unitdatabin/{tbl_name}skilllist.bytes")); tbl["rows"] = {e["id"]: e for e in tbl["t"].json()["datas"]}
            rows = tbl["rows"]
            if isinstance(fs, dict) and "reuse" in fs:
                # rewrite a spare row in place (one no unit uses) instead of adding a row: a brand-new field skill
                # row crashed the game on the home screen
                fid = int(fs["reuse"]); e = rows[fid]
                if any(x.get(f_) == fid for x in units.values() if not x.get("_forge") for f_ in fields):
                    sys.exit(f"{uid}: {kind} {fid} is used by another unit; pick a spare one")
                for key in ("script", "secondScript", "state", "stateParam"):
                    if key in fs: e[key] = fs[key]
                tbl["changed"] = True
                for f_ in fields: u[f_] = fid
                continue
            if isinstance(fs, dict):
                e = copy.deepcopy(rows[int(fs["from"])]); nid = (310000 if tbl_name == "field" else 410000) + 90000 + uid % 10000
                while nid in rows and not rows[nid].get("_forge"): nid += 1
                e.update(id=nid, _forge=True)
                for key in ("script", "secondScript", "state", "stateParam"):
                    if key in fs: e[key] = fs[key]
                if "name" in fs: e["nameLangId"] = lang_add(lidx, lss, "ability_name_", 5000, fs["name"])
                if "description" in fs: e["explanationLangId"] = lang_add(lidx, lss, "bskill_detail_", 5000, fs["description"])
                rows[nid] = e; fid = nid; tbl["changed"] = True
            else:
                fid = int(fs)
                if fid not in rows: sys.exit(f"{uid}: {kind} {fid} not found")
            for f_ in fields: u[f_] = fid
        # Latent Skill (the 7-star third special move): the client offers it whenever sSkillId_2 is set
        # (Unit.IsUseSSkillId_2 only checks that field). "from" names a unit whose latent, or ultimate if it has
        # none, supplies the animation (skillBoneId), the video (criId) and the voice; any skill key overrides.
        lat = s.get("latent")
        if lat:
            fu = units[int(lat["from"])]
            src_id = int(lat.get("fromSkill", fu.get("sSkillId_2") or fu["sSkillId"]))
            if src_id not in skills: sys.exit(f"{uid}: latent: skill {src_id} not found")
            from_latent = src_id == fu.get("sSkillId_2")
            sk = copy.deepcopy(skills[src_id])
            sid = int(lat.get("id", 800000 + uid if uid < 100000 else 8000000 + uid))
            while sid in skills and not skills[sid].get("_forge"): sid += 1
            sk["id"] = sid; sk["_forge"] = True
            if "name" in lat: sk["langNameID"] = lang_add(lidx, lss, "skill_name_", 5000, lat["name"])
            if "description" in lat:
                sk["langInfoID"] = sk["langEffectInfo1ID"] = lang_add(lidx, lss, "skill_detail_", 5000, lat["description"])
            for key in ("script", "secondScript", "turn", "rangeType", "range1", "range2", "push", "circleId", "type"):
                if key in lat: sk[key] = lat[key]
            skills[sid] = sk
            u["sSkillId_2"] = u["sSkillIdPvP_2"] = sid
            u["boostSSkillId_2"] = u["boostSSkillIdPvP_2"] = 0
            u["criId_2"] = lat.get("video", fu["criId_2"] if from_latent else fu["criId"])
            u["sSkillVoice_2"] = lat.get("voice", fu["sSkillVoice_2"] if from_latent else fu["sSkillVoice"])
            u["standbySSkillId_2"] = int(fu.get("standbySSkillId_2") or 30001)
            crimap = {re.search(r"cri_(\d+)", k).group(1) for k in b.routes if "/crimovie/" in k}
            for c in re.findall(r"cri_(\d+)", u["criId_2"]):
                if c not in crimap: print(f"warning: {uid}: latent video cri_{c} is missing in this build")
            eff = R + f"sprite/effect/{sk['skillBoneId']}_effect"
            if eff not in b.routes: print(f"warning: {uid}: latent animation {sk['skillBoneId']} is missing in this build")
        # battle visuals: rig / cut-in / jutsu & ultimate effects may come from other units
        vis = s.get("visuals", {})
        C_ = catalog(b)
        rig_id = int(vis.get("rig", donor_id))
        if rig_id != donor_id:
            r = units[rig_id]
            for k in ("boneId", "standBoneId", "attackBoneId", "imageId", "charaMoveType"):
                if k in r: u[k] = r[k]
        if not part_ok(C_.get(rig_id), "rig"):
            print(f"warning: {uid}: battle rig from {rig_id} is missing in this build -> white boxes in battle. Set visuals.rig (see 'donors').")
        cut_id = int(vis.get("cutin", rig_id if "rig" in vis else donor_id))
        u["cutInImageId"] = units[cut_id]["cutInImageId"]
        if not part_ok(C_.get(cut_id), "cutin"): print(f"warning: {uid}: cut-in from {cut_id} is missing in this build")
        for kind, field, pvp, base_prefix in (("jutsu", "skillId", "skillIdPvP", 100000), ("ultimate", "sSkillId", "sSkillIdPvP", 200000)):
            fx_id = int(vis.get(kind + "Effect", donor_id))
            if not u.get(field): continue
            if fx_id != donor_id:
                src_fx = skills[units[fx_id][field]] if units[fx_id].get(field) else None
                if src_fx is None: sys.exit(f"{uid}: {fx_id} has no {kind} to borrow an effect from")
                cur = skills[u[field]]
                if not cur.get("_forge"):   # clone so the donor's own skill stays untouched
                    cur = copy.deepcopy(cur)
                    sid = base_prefix + uid if uid < 100000 else base_prefix * 10 + uid
                    while sid in skills and not skills[sid].get("_forge"): sid += 1
                    cur["id"] = sid; cur["_forge"] = True; skills[sid] = cur; u[field] = sid; u[pvp] = sid
                cur["skillBoneId"] = src_fx["skillBoneId"]
                if kind == "ultimate": u["criId"] = units[fx_id]["criId"]   # criId is the ultimate's video
            if not part_ok(C_.get(fx_id), kind):
                print(f"warning: {uid}: {kind} effect from {fx_id} is missing in this build")
        # ultimate video (CRI movie): 0 = none (straight to the animation), or a unit id to borrow its video
        if "ultimateVideo" in vis:
            v = vis["ultimateVideo"]
            u["criId"] = "0" if v in (0, "0", None, "none") else units[int(v)]["criId"]
        for c in re.findall(r"cri_\w+", str(u.get("criId", "")) + " " + str(u.get("criId_2", ""))):
            if cri_has_audio(b, c):
                print(f"warning: {uid}: ultimate video {c} has its own audio track; videos like that have crashed the ultimate "
                      f"on device. Set visuals.ultimateVideo to 0 (no video) or another unit's id.")
        # art
        art = s.get("art", {})
        card_id = int(s.get("cardImageId", 30000 + (uid % 10000)))
        if art.get("card"):
            used = {int(l.split(",")[0]) for l in bundles.read_text(b.route_bytes(ROUTE_CARDLIST)).decode().splitlines() if l.strip()}
            if card_id in used or any(x["cardImageId"] == card_id for x in units.values() if not x.get("_forge")):
                sys.exit(f"{uid}: cardImageId {card_id} is already used by the game; set another in the unit file")
            img = fit_card(Image.open(os.path.join(s["_dir"], art["card"])))
            donor_card = b.route_bytes(R + f"card/img_card_{d['cardImageId']:05d}.png")
            new_bundles[f"card/img_card_{card_id:05d}.png"] = bundles.clone_card_bundle(donor_card, card_id, img)
            line = f"{card_id},img_card_{card_id:05d}"
            if line not in cardlist.splitlines(): cardlist = cardlist.rstrip("\n") + "\n" + line + "\n"
            u["cardImageId"] = card_id
            icon_img = Image.open(os.path.join(s["_dir"], art["icon"])) if art.get("icon") else icon_from(img)
            if art.get("iconOverlay"):
                icon_img = apply_overlay(icon_img, Image.open(os.path.join(s["_dir"], art["iconOverlay"])))
            icons_bundle = bundles.add_icon(icons_bundle, card_id, icon_img); icons_changed = True
            line = f"{card_id},img_icon_{card_id:05d}"
            if line not in iconlist_txt.splitlines(): iconlist_txt = iconlist_txt.rstrip("\n") + "\n" + line + "\n"
            u["iconImageId"] = card_id
            # battle face icon: the client loads img_chakraicon_<iconImageId> in battle (HUD, ultimate start).
            # Without one the HUD draws a white box and an ultimate can crash.
            if thumbs_bundle is None: thumbs_bundle = b.route_bytes(ROUTE_THUMBS)
            ch = Image.open(os.path.join(s["_dir"], art["chakraIcon"])).convert("RGBA").resize((128, 128), Image.LANCZOS) \
                if art.get("chakraIcon") else chakra_from(icon_img)
            thumbs_bundle = bundles.add_icon(thumbs_bundle, card_id, ch, prefix="img_chakraicon_")
            line = f"{card_id},img_chakraicon_{card_id:05d}"
            if line not in thumbs_txt.splitlines(): thumbs_txt = thumbs_txt.rstrip("\n") + "\n" + line + "\n"
        units[uid] = u
        t = copy.deepcopy(trims.get(donor_id) or next(iter(trims.values()))); t["id"] = uid
        for view in ("home", "gasha", "panel"):
            if view in s.get("trimming", {}): t[view].update(s["trimming"][view])
        trims[uid] = t
        # engine catalogs (new IDs only; slots leave the server's locked files alone)
        c = copy.deepcopy(cidx[donor_id]) if (donor_id in cidx and not slot_mode) else None
        if c:
            c["unitId"] = uid; c["rare"] = u["rare"]; c["sameId"] = u["sameId"]
            c["cardImageId"] = u["cardImageId"]; c["iconImageId"] = u["iconImageId"]
            c["primarySkillId"] = u["skillId"]; c["ultimateSkillId"] = u["sSkillId"]
            c["skills"]["primary"]["id"] = u["skillId"]; c["skills"]["ultimate"]["id"] = u["sSkillId"]
            c["identity"].update({"name": s["name"], "subtitle": s.get("subtitle", ""), "langId": u["langId"],
                                  "subtitleLangId": u["langId2"], "rarity": u["rare"], "attribute": u["attr"], "cost": u["cost"]})
            c["progression"] = {"blazingEvolution": {"materials": [], "targetUnitId": 0}, "evolution": {"materials": [], "targetUnitId": 0}, "reversion": {"materials": [], "targetUnitId": 0}}
            c["managementAssets"]["cardTrimming"]["id"] = uid
            c["defaultTeamEligible"] = False
            cidx[uid] = c
        if not slot_mode:
            if str(donor_id) in uexp["units"]: uexp["units"][str(uid)] = copy.deepcopy(uexp["units"][str(donor_id)])
            if isinstance(playable, list) and uid not in playable: playable.append(uid)
            if isinstance(progression, dict): progression[str(uid)] = progression.get(str(donor_id), 0)
        if s.get("gift", True):
            key = f"forge-unit-{uid}-v1"
            presents["grants"] = [g for g in presents["grants"] if g.get("sourceKey") != key]
            presents["grants"].append({"sourceKey": key, "messageTitle": f"New ally: {s['name']}",
                "messageDetail": s.get("giftMessage", f"{s['name']} ({s.get('subtitle','')}) has joined you."),
                "type": 1, "num": 1, "charaId": uid, "charaLevel": 1, "skillLevel": 1, "abilityCount": 0, "luck": 1,
                "plusS": 0, "plusA": 0, "plusD": 0, "plusSp": 0, "exlimitCount": 0, "grade": 1, "pflag": 0, "gTicketId": 0,
                "id": 0, "sortNo": 200, "expiresAt": "2099-12-31T23:59:59Z"})
        report.append(("slot " if slot_mode else "") + f"{uid}  {s['name']} - {s.get('subtitle','')}  (donor {donor_id}, card {u['cardImageId']}, jutsu {u['skillId']}, ultimate {u['sSkillId']}" + (f", latent {u['sSkillId_2']}" if u.get("sSkillId_2") else "") + ")")

    # extra Present Box gifts (e.g. awakening scrolls): mod/gifts.json = [{"charaId", "count", "title", "detail"}]
    gp = os.path.join(a.mod, "gifts.json")
    if os.path.exists(gp):
        for gi, g in enumerate(jload(gp)):
            cid = int(g["charaId"])
            if cid not in units: sys.exit(f"gifts.json: {cid} is not a unit or material in the game")
            for n in range(int(g.get("count", 1))):
                key = f"forge-gift-{cid}-{n + 1}-v{int(g.get('version', 1))}"
                presents["grants"] = [x for x in presents["grants"] if x.get("sourceKey") != key]
                presents["grants"].append({"sourceKey": key, "messageTitle": g.get("title", "Gift"),
                    "messageDetail": g.get("detail", ""), "type": 1, "num": 1, "charaId": cid, "charaLevel": 1, "skillLevel": 1,
                    "abilityCount": 0, "luck": 1, "plusS": 0, "plusA": 0, "plusD": 0, "plusSp": 0, "exlimitCount": 0, "grade": 1,
                    "pflag": 0, "gTicketId": 0, "id": 0, "sortNo": 150, "expiresAt": "2099-12-31T23:59:59Z"})
            report.append(f"gift {g.get('count', 1)}x {cid} ({g.get('title', '')})")

    def strip(o):
        return {k: v for k, v in o.items() if k != "_forge"}
    def keep_order(orig, rows):
        """The game's own row order, with changed rows in place and new rows appended (sorted). Some tables
        are not sorted by id, and reordering a whole table is a change the client never sees in real data."""
        seen = [r["id"] for r in orig]; ss = set(seen)
        return [strip(rows[i]) for i in seen if i in rows] + [strip(rows[i]) for i in sorted(rows) if i not in ss]
    U["datas"] = keep_order(U["datas"], units)
    S["datas"] = keep_order(S["datas"], skills)
    T["trimmingList"]["trimmingDatas"] = keep_order(T["trimmingList"]["trimmingDatas"], trims)
    chars["units"] = sorted(cidx.values(), key=lambda x: x["unitId"])
    cnt = chars.get("counts", {})
    if "unitRecords" in cnt: cnt["unitRecords"] = len(U["datas"])
    if "playerForms" in cnt: cnt["playerForms"] = len(chars["units"])

    unit_bundle = unit_t.rebuild(U)
    new_bundles["language/en/unitdata/unitlist.bytes"] = unit_bundle
    new_bundles["unitdatabin/skilllist.bytes"] = skill_t.rebuild(S)
    for tbl_name, tbl in fb_tables.items():
        if tbl["changed"]:
            FB = tbl["t"].json(); FB["datas"] = keep_order(FB["datas"], tbl["rows"])
            new_bundles[f"unitdatabin/{tbl_name}skilllist.bytes"] = tbl["t"].rebuild(FB)
    if abil_t is not None:
        AB = abil_t.json(); AB["datas"] = keep_order(AB["datas"], abil)
        new_bundles["unitdatabin/abilityskilllist.bytes"] = abil_t.rebuild(AB)
    new_bundles["language/en/stringbin/languagedata.bytes"] = lang_t.rebuild(L)
    new_bundles["idlist/trimmingcarddata.bytes"] = trim_t.rebuild(T)
    new_bundles["idlist/cardimagelist.txt"] = bundles.replace_text(b.route_bytes(ROUTE_CARDLIST), cardlist.encode("utf-8"))
    new_bundles["idlist/iconimagelist.txt"] = bundles.replace_text(b.route_bytes(ROUTE_ICONLIST_TXT), iconlist_txt.encode("utf-8"))
    if icons_changed: new_bundles["iconlist/iconlist"] = icons_bundle
    if thumbs_bundle is not None:
        new_bundles["idlist/thumbnailimagelist.txt"] = bundles.replace_text(b.route_bytes(ROUTE_THUMBS_TXT), thumbs_txt.encode("utf-8"))
        new_bundles["thumbnaillist/thumbnaillist"] = thumbs_bundle

    # ---- summon animation re-skin: mod/summon/summon.json paints new part art into the atlas cells
    sp = os.path.join(a.mod, "summon", "summon.json")
    summon_on = summon_is_on(a, sp)
    if summon_on:
        import summon
        cfg = jload(sp)
        textures = cfg.get("textures") or {cfg["texture"]: cfg["parts"]}
        data = b.route_bytes(R + cfg["bundle"]); previews = []; nparts = 0; painted = {}
        for tex_name, tparts in textures.items():
            parts = {}
            for cell, pc in tparts.items():
                if "shadowFrom" in pc:
                    parts[cell] = {"shadowFrom": pc["shadowFrom"], "fit": pc.get("fit", "stretch"), "rotate": pc.get("rotate", 0), "offset": pc.get("offset"),
                                   "silhouette": Image.open(os.path.join(os.path.dirname(sp), pc["silhouette"])) if pc.get("silhouette") else None}
                elif pc.get("clear"): parts[cell] = lambda crop: Image.new("RGBA", crop.size, (0, 0, 0, 0))
                elif "tint" in pc: parts[cell] = (lambda rgb: (lambda crop: summon.tint(crop, rgb)))(tuple(pc["tint"]))
                elif "recolorGrey" in pc: parts[cell] = (lambda rgb: (lambda crop: summon.recolor_grey(crop, rgb)))(tuple(pc["recolorGrey"]))
                else:
                    src = Image.open(os.path.join(os.path.dirname(sp), pc["file"]))
                    if "crop" in pc: src = src.crop(tuple(pc["crop"]))   # [left, top, right, bottom] in source pixels
                    parts[cell] = (src, pc.get("fit", "stretch"), pc.get("rotate", 0), pc.get("matchBottom", False), pc.get("offset"))
            scales = {cell: {"scale": pc.get("scale", 1), **({"pivot": pc["pivot"]} if "pivot" in pc else {})}
                      for cell, pc in tparts.items() if "scale" in pc or "pivot" in pc}
            data, before, after = summon.reskin(data, tex_name, parts, scales, painted); nparts += len(parts)
            prev = Image.new("RGBA", (before.width * 2 + 20, before.height), (70, 70, 90, 255))
            prev.alpha_composite(before, (0, 0)); prev.alpha_composite(after, (before.width + 20, 0))
            os.makedirs(a.out, exist_ok=True); prev.save(os.path.join(a.out, f"summon-{tex_name}-before-after.png"))
        new_bundles[cfg["bundle"]] = data
        report.append(f"summon animation: {nparts} part(s) re-skinned in {', '.join(textures)}")

    # ---- iOS routes + asset lists
    routes = copy.deepcopy(b.routes)
    now = int(time.time())
    meta = {}
    for path, data in new_bundles.items():
        rel = f"{MODS_DIR}/{path}"
        os.makedirs(os.path.dirname(D("content-ios/" + rel)), exist_ok=True)
        open(D("content-ios/" + rel), "wb").write(data)
        crc = unityfs.unity_crc(data)
        routes[R + path] = {"file": rel, "bytes": len(data), "sha256": sha(data), "crc": f"{crc:08X}"}
        meta[path] = dict(size=len(data), crc=crc, hash=hashlib.md5(data).hexdigest())
    list_rows = {}
    for lrel in (LIST_MAIN, LIST_FIRST):
        t = Text(b.read(lrel)); rows = t.json(); seen = set()
        for e in rows:
            if e["asset_path"] in meta:
                m = meta[e["asset_path"]]; e.update(hash=m["hash"], crc=m["crc"], size=m["size"], utc=now); seen.add(e["asset_path"])
        if lrel == LIST_MAIN:
            for path, m in meta.items():
                if path not in seen:
                    rows.append({"asset_path": path, "asset_name": path.rsplit("/", 1)[-1], "hash": m["hash"], "version": 0,
                                 "crc": m["crc"], "utc": now, "size": m["size"], "auto_retry": 1})
        data = t.rebuild(rows); list_rows[lrel] = len(rows)
        os.makedirs(os.path.dirname(D(lrel)), exist_ok=True); open(D(lrel), "wb").write(data)
        route = R + lrel.split("content-ios/iOS/", 1)[1]
        routes[route] = {"file": lrel.split("content-ios/", 1)[1], "bytes": len(data), "sha256": sha(data), "crc": f"{unityfs.unity_crc(data):08X}"}
    param = jload(b.p(PARAM)); pidx = {e["url"]: e for e in param["assetBundleCache"]}
    for path, m in meta.items():
        e = pidx.get(path)
        if e: e.update(hash=m["hash"], crc=f"{m['crc']:08X}")
        else: param["assetBundleCache"].append({"url": path, "hash": m["hash"], "crc": f"{m['crc']:08X}"})
    for lrel in (LIST_MAIN, LIST_FIRST):
        path = lrel.split("content-ios/iOS/", 1)[1]
        rt = routes[R + path]
        if path in pidx: pidx[path].update(hash=hashlib.md5(open(D(lrel), "rb").read()).hexdigest(), crc=rt["crc"])
    param_bytes = json.dumps(param, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    open(D(PARAM), "wb").write(param_bytes)
    routes[R + "assetbundlelist_param.json"] = {"file": "iOS/assetbundlelist_param.json", "bytes": len(param_bytes),
                                                "sha256": sha(param_bytes), "crc": None}
    routes_bytes = json.dumps(routes, ensure_ascii=False, indent=0).encode("utf-8")
    open(D("content-ios/ios-routes.json"), "wb").write(routes_bytes)
    ic = jload(b.p("content-ios/ios-content.json"))
    ic["routes"].update(sha256=sha(routes_bytes), count=len(routes))
    for lrel in (LIST_MAIN, LIST_FIRST, PARAM):
        k = lrel.split("content-ios/", 1)[1]
        if k in ic.get("files", {}):
            data = open(D(lrel), "rb").read(); ic["files"][k].update(sha256=sha(data), bytes=len(data))
            if "rows" in ic["files"][k]:
                ic["files"][k]["rows"] = list_rows.get(lrel, len(param["assetBundleCache"]))
    ic.setdefault("forge", {})["units"] = [int(s["id"]) for s in specs]
    jdump(ic, D("content-ios/ios-content.json"))

    # ---- engine side
    if not any_new_ids:
        # slots only: the server's locked files ship as the untouched originals. That also undoes any
        # earlier new-ID patch on the phone, and keeps the server's fingerprints matching.
        # slots only: the server's locked files are left alone entirely (not shipped), so they stay original
        jdump(presents, D(PRESENTS))
    else:
        write_engine_side(b, D, new_bundles, playable, progression, chars, uexp, presents)

    unit_names = {int(x["id"]): (x["name"], x.get("subtitle", "")) for x in specs}
    report += apply_banners(b, a.mod, D, unit_names)

    bd = jload(b.p("blazing-data.json"))
    bd["iosContent"]["manifestSha256"] = sha(open(D("content-ios/ios-content.json"), "rb").read())
    bd["iosContent"]["routes"] = len(routes)
    pm = D("pack/manifest.json")
    bd["pack"]["manifestSha256"] = sha(open(pm, "rb").read() if os.path.exists(pm) else b.read("pack/manifest.json"))
    bd["what"] = bd.get("what", "") + " + Blazing Forge mod"
    bd["forge"] = {"units": [int(s["id"]) for s in specs], "builtUtc": now, "mode": "new-ids" if any_new_ids else "slots"}
    jdump(bd, D("blazing-data.json"))
    eng = jload(a.engine)
    eng["expect"]["sha256"] = sha(open(D("blazing-data.json"), "rb").read())
    # the launcher checks any BlazingData.zip left in Documents against `expect`; point it at an empty folder
    eng.setdefault("install", {})["zips"] = "{home}/Documents/BlazingForge/zips"
    eng["forge"] = {"units": [int(s["id"]) for s in specs], "builtUtc": now}
    jdump(eng, os.path.join(out_root, "BlazingEngine", "BlazingEngine.json"))
    finish_build(a, b, out_root, specs, now, report)

SUMMON_DIR = "content/config/summons"
ART_CFG = "content/config/banners/artwork-2.28.0.json"
ART_DATA = "content/data/banners/artwork-2.28.0.json"
IMG_DIR = "content/images/summons"

def SUMMON_FILES():
    """Summon config Forge may edit; always shipped (original when unchanged) so removing a banner reverts cleanly."""
    return [SUMMON_DIR + "/rotation.json", SUMMON_DIR + "/summons.json", ART_CFG, ART_DATA]

def banner_top_from_front(img):
    """367x118 top strip: the lower-middle band of the front art (where the title usually sits)."""
    w, h = img.size; bw = int(w * 0.68); bh = int(bw / (367 / 118))
    x0 = (w - bw) // 2; y0 = max(0, int(h * 0.93) - bh)   # stop above a bottom info bar
    return img.crop((x0, y0, x0 + bw, y0 + bh)).resize((367, 118), Image.LANCZOS)

def bjson(b, rel):
    return json.loads(b.read(rel))

def apply_banners(b, moddir, D, unit_names):
    """unit_names: slot -> (name, subtitle). Writes pools, banners, rotation/projection, artwork and images."""
    import zlib
    rot = bjson(b, (SUMMON_DIR + "/rotation.json")); proj = bjson(b, (SUMMON_DIR + "/summons.json"))
    art = bjson(b, (ART_CFG))
    used_art = {x["bannerId"] for x in art["banners"]}
    chars = {u["unitId"]: u for u in bjson(b, (CHARS))["units"]}
    report = []
    for path in sorted(glob.glob(os.path.join(moddir, "banners", "*.json"))):
        spec = jload(path); sdir = os.path.dirname(os.path.abspath(path))
        bid = int(spec["id"])
        if str(bid) in rot["rareBanners"]: sys.exit(f"banner {bid}: id already used")
        for fld in ("name", "ticker"):
            txt = spec.get(fld, "")
            if any(c in txt for c in ":!"):
                sys.exit(f"banner {bid}: {fld} {txt!r} contains ':' or '!'. The offline server refused to start with a banner "
                         "named 'Legacy Awaken: Round 1' and ticker 'Back and better than ever! ...', and accepted the same banner without them.")
        src = bjson(b, (SUMMON_DIR + "/" + rot["rareBanners"][str(spec.get("copyFrom", 60001))]))
        base_pool_id = spec.get("basePool", src["poolId"])
        base_pool = bjson(b, (SUMMON_DIR + "/" + rot["pools"][base_pool_id]))
        pool_id = spec.get("poolId", f"forge-{bid}")
        entries = copy.deepcopy(base_pool["entries"]); idx = {e["unitId"]: e for e in entries}
        featured = [int(x) for x in spec.get("featured", [])]
        for fid in featured:
            if fid not in idx:
                sys.exit(f"banner {bid}: featured unit {fid} is not in the '{base_pool_id}' pool. The offline server only "
                         "summons eligible 3-5 star base forms; use a slot that is already in the pool (see README, Banners).")
            # only the weight changes: the server checks each entry's name/subtitle against its own catalog,
            # so a slot's entry must keep the slot's real identity (renaming it stopped the server)
            e = idx[fid]; e["weight"] = int(spec.get("featuredWeight", 100))
        tiers = {t["rarity"] for t in src["rateTiers"]}
        bad = sorted({e["rarity"] for e in entries} - tiers)
        if bad: sys.exit(f"banner {bid}: pool has rarities {bad} with no rate tier")
        open_w(D(f"{SUMMON_DIR}/pools/{pool_id}.json"), json.dumps({"schemaVersion": 1, "poolId": pool_id,
               "policyAuthority": "private-server-generated", "entries": entries}, indent=2, ensure_ascii=False).encode())
        # artwork
        front = Image.open(os.path.join(sdir, spec["art"]["front"])).convert("RGBA")
        top = Image.open(os.path.join(sdir, spec["art"]["top"])).convert("RGBA") if spec["art"].get("top") else banner_top_from_front(front)
        front = front.resize((750, 400), Image.LANCZOS)
        top = top.convert("RGB").resize((367, 118), Image.LANCZOS)
        ids = []
        for img, div, suffix in ((front, 8, "front"), (top, 9, "top")):
            aid = int(spec.get(f"{suffix}BannerId", 0)) or next(i for i in range(1900, 1999) if i not in used_art)
            used_art.add(aid)
            fname = f"forge-{bid}-{suffix}.png"
            import io
            buf = io.BytesIO(); img.save(buf, "PNG", optimize=True); data = buf.getvalue()
            open_w(D(f"{IMG_DIR}/{fname}"), data)
            entry = {"bannerDivision": div, "bannerId": aid, "bannerImage": fname, "crc": f"{zlib.crc32(data) & 0xffffffff:08X}",
                     "endsAt": src["endsAt"], "missionStageOpenId": 0, "popup": "", "scene": "",
                     "sortNo": aid, "startsAt": src["startsAt"], "summary": spec["name"]}
            art["banners"].append(entry); proj["banners"].append(entry); ids.append(aid)
        # Match the shape every genuine private-server banner has; the server rejected a banner that didn't
        # ("Rare summon metadata is invalid"): sortNo == id, 5 featured pool members, guarantees only on step-ups,
        # the shared end date.
        if "sortNo" in spec and int(spec["sortNo"]) != bid: print(f"note: banner {bid}: sortNo forced to {bid}")
        if src.get("gashaRareType") != 5 and int(spec.get("guaranteedRarity", 0)):
            print(f"note: banner {bid}: guaranteedRarity is only used on step-up banners; ignored")
        feat5 = list(dict.fromkeys(featured + [int(x) for x in src["bannerCharaIds"].split(",") if x]))[:5]
        for fid in feat5:
            if fid not in idx: sys.exit(f"banner {bid}: featured {fid} not in pool")
        banner = copy.deepcopy(src)
        banner.update({"gashaRareId": bid, "name": spec["name"], "ticker": spec.get("ticker", spec["name"]),
                       "bannerCharaIds": ",".join(str(x) for x in feat5),
                       "poolId": pool_id, "sortNo": bid, "frontBannerId": ids[0], "topBannerId": ids[1],
                       "guaranteedRarity": src.get("guaranteedRarity", 0) if src.get("gashaRareType") != 5 else int(spec.get("guaranteedRarity", src.get("guaranteedRarity", 0))),
                       "startsAt": src["startsAt"], "endsAt": src["endsAt"]})
        if "endsAt" in spec and spec["endsAt"] != src["endsAt"]: print(f"note: banner {bid}: end date kept at {src['endsAt']} (shown dates come from your art)")
        for k in ("onceConsumeNum", "continuityConsumeNum", "confirmMessage"):
            if k in spec: banner[k] = spec[k]
        open_w(D(f"{SUMMON_DIR}/banners/{bid}.json"), json.dumps(banner, indent=2, ensure_ascii=False).encode())
        rot["rareBanners"][str(bid)] = f"banners/{bid}.json"; rot["pools"][pool_id] = f"pools/{pool_id}.json"
        pb = {k: v for k, v in banner.items() if k != "poolId"}; pb["pool"] = [dict(sorted(e.items())) for e in entries]
        proj["rareBanners"].append(dict(sorted(pb.items())))
        fw = sum(e["weight"] for e in entries if e["unitId"] in featured)
        top_tier = max(src["rateTiers"], key=lambda t: t["rarity"])
        tier_total = sum(t["weight"] for t in src["rateTiers"])
        same_r = [e for e in entries if e["rarity"] == top_tier["rarity"]]
        for fid in featured:
            e = idx[fid]
            pr = next(t["weight"] for t in src["rateTiers"] if t["rarity"] == e["rarity"]) / tier_total * e["weight"] / sum(x["weight"] for x in entries if x["rarity"] == e["rarity"])
            report.append(f"banner {bid} '{spec['name']}': featured {fid} ({e['rarity']}*) at {pr*100:.1f}% per pull")
    if not report:
        # no banners: ship the summon config byte-for-byte original (also reverts any earlier banner patch)
        for rel in SUMMON_FILES(): open_w(D(rel), b.read(rel))
        return report
    jdump(rot, D(SUMMON_DIR + "/rotation.json"), indent=2)
    jdump(proj, D(SUMMON_DIR + "/summons.json"))
    jdump(art, D(ART_CFG)); jdump(art, D(ART_DATA))
    return report

def LOCKED_FILES(b):
    """Files the offline server pins by fingerprint (directly or via pack/manifest.json)."""
    rels = [CHARS, UEXP, "pack/manifest.json", "pack/playableunits.json", "pack/progressionunits.json"]
    for r in ("/assets/Android/language/en/unitdata/unitlist.bytes", "/assets/Android/unitdatabin/skilllist.bytes"):
        rels.append("pack/" + b.pack_asset(r)["asset"])
    return rels

def write_engine_side(b, D, new_bundles, playable, progression, chars, uexp, presents):
    """New-ID mode: only for a server whose fingerprint lock has been patched."""
    pack = copy.deepcopy(b.pack); pidx2 = {f["route"]: f for f in pack["files"]}
    for ios_path, android_route in (("language/en/unitdata/unitlist.bytes", "/assets/Android/language/en/unitdata/unitlist.bytes"),
                                    ("unitdatabin/skilllist.bytes", "/assets/Android/unitdatabin/skilllist.bytes")):
        f = pidx2[android_route]
        src = b.read("pack/" + f["asset"])
        t = Text(src)
        data = t.rebuild(json.loads(obf.decode(bundles.read_text(new_bundles[ios_path]))))
        open_w(D("pack/" + f["asset"]), data); f.update(bytes=len(data), sha256=sha(data))
    for name, obj in (("playableunits.json", playable), ("progressionunits.json", progression)):
        data = json.dumps(obj, separators=(", ", ": ")).encode("utf-8")
        open_w(D("pack/" + name), data)
        for f in pack["files"]:
            if f["asset"] == name: f.update(bytes=len(data), sha256=sha(data))
    jdump(pack, D("pack/manifest.json"), indent=2)
    jdump(chars, D(CHARS)); jdump(uexp, D(UEXP)); jdump(presents, D(PRESENTS))

def finish_build(a, b, out_root, specs, now, report):
    # restore set = the original copies of every file we replaced
    rest = os.path.join(a.out, "Blazing-Rebirth-restore")
    for root, _, fs in os.walk(os.path.join(out_root, "BlazingData")):
        for fn in fs:
            rel = os.path.relpath(os.path.join(root, fn), os.path.join(out_root, "BlazingData")).replace(os.sep, "/")
            if rel.startswith("content-ios/" + MODS_DIR + "/"): continue
            if os.path.exists(b.p(rel)):
                os.makedirs(os.path.dirname(os.path.join(rest, "BlazingData", rel)), exist_ok=True)
                shutil.copy2(b.p(rel), os.path.join(rest, "BlazingData", rel))
    make_patch_zips(a.out, out_root, rest, b, specs, now)
    make_summon_toggles(a, out_root, b, specs, now)
    print("built", len(specs), "unit(s):"); [print("  " + r) for r in report]
    print("output:", out_root)
    print("install zip(s):", ", ".join(sorted(os.path.basename(p) for p in glob.glob(os.path.join(a.out, "BlazingForge-patch*.zip")))))

def make_patch_zips(out, out_root, rest, b, specs, now):
    """BlazingForge-patch.zip for the in-app installer (BlazingForge.dylib), plus BlazingForge-uninstall.zip."""
    import zipfile
    files = {}
    for root, _, fs in os.walk(out_root):
        for fn in fs:
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, out_root).replace(os.sep, "/")
            files[rel] = p
    originals = {}
    for root, _, fs in os.walk(rest):
        for fn in fs:
            p = os.path.join(root, fn)
            originals[os.path.relpath(p, rest).replace(os.sep, "/")] = p
    units = []
    for s in specs:
        units.append({"id": int(s["id"]), "name": s["name"], "subtitle": s.get("subtitle", "")})
    # The patch is sent as a file, so keep each zip well under 30 MB: the big image bundles are spread over
    # several parts, and every part also carries all the small files (data chain, lists, configs) so that
    # each part is consistent on its own and the last one installed leaves a complete installed.json.
    BIG = ("BlazingData/content-ios/mods/card/", "BlazingData/content-ios/mods/iconlist/", "BlazingData/content-ios/mods/thumbnaillist/",
           "BlazingData/content-ios/mods/language/en/uxsprite/", "BlazingData/content-ios/mods/uxsprite/")
    big = sorted((r for r in files if r.startswith(BIG)), key=lambda r: -os.path.getsize(files[r]))
    small = [r for r in files if r not in big]
    cap = 23 * 2**20; parts = []
    for r in big:
        sz = os.path.getsize(files[r])
        for pt in parts:
            if pt[0] + sz <= cap: pt[0] += sz; pt[1].append(r); break
        else: parts.append([sz, [r]])
    groups = [small + pt[1] for pt in parts] or [small]
    for old in glob.glob(os.path.join(out, "BlazingForge-patch*.zip")): os.remove(old)
    for i, grp in enumerate(groups, 1):
        manifest = {"format": 1, "patchId": f"forge-{now}", "part": f"{i} of {len(groups)}", "gameVersion": "2.28.0",
                    "baseDataSha256": sha(b.read("blazing-data.json")),
                    "units": units, "files": {rel: sha(open(files[rel], "rb").read()) for rel in sorted(grp)}}
        name = "BlazingForge-patch.zip" if len(groups) == 1 else f"BlazingForge-patch-{i}.zip"
        with zipfile.ZipFile(os.path.join(out, name), "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            z.writestr("forge-patch.json", json.dumps(manifest, indent=1, ensure_ascii=False))
            for rel in sorted(grp): z.write(files[rel], "install/" + rel)
            for rel, p in sorted(originals.items()): z.write(p, "original/" + rel)
        print(f"{name}: {os.path.getsize(os.path.join(out, name)) / 2**20:.1f} MB, {len(grp)} files")
    with zipfile.ZipFile(os.path.join(out, "BlazingForge-uninstall.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.txt", "Put this file in Files > On My iPhone > Blazing:Rebirth and open the game: "
                                 "Blazing Forge restores the original game files and removes custom units.\n")

def summon_is_on(a, sp):
    mode = getattr(a, "summon", "auto")
    return os.path.exists(sp) and (mode == "on" or (mode == "auto" and jload(sp).get("enabled", True)))

def make_summon_toggles(a, out_root, b, specs, now):
    """Two small switch patches next to the main patch: BlazingForge-summon-custom.zip (your summon animation) and
    BlazingForge-summon-classic.zip (the game's own). Each carries every small file of its build (data tables, asset
    lists, routes) plus, for custom, the re-skinned summon bundle, so dropping either one in flips the animation
    without reinstalling the big card/icon parts. They belong to this build: rebuild them with every new patch."""
    sp = os.path.join(a.mod, "summon", "summon.json")
    if getattr(a, "_toggle_pass", False) or not os.path.exists(sp): return
    import zipfile, types, tempfile
    cfg = jload(sp); bundle_rel = "BlazingData/content-ios/" + MODS_DIR + "/" + cfg["bundle"]
    main_on = summon_is_on(a, sp)
    tmp = tempfile.mkdtemp(prefix="forge-toggle-")
    b2 = types.SimpleNamespace(**vars(a)); b2.out = tmp; b2.summon = "off" if main_on else "on"; b2._toggle_pass = True
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()): cmd_build(b2)
    BIG = ("BlazingData/content-ios/mods/card/", "BlazingData/content-ios/mods/iconlist/", "BlazingData/content-ios/mods/thumbnaillist/",
           "BlazingData/content-ios/mods/language/en/uxsprite/", "BlazingData/content-ios/mods/uxsprite/")
    def collect(root, keep=()):
        out = {}
        for r_, _, fs in os.walk(root):
            for fn in fs:
                p = os.path.join(r_, fn); rel = os.path.relpath(p, root).replace(os.sep, "/")
                if not rel.startswith(BIG) or rel in keep: out[rel] = p
        return out
    units = [{"id": int(s["id"]), "name": s["name"], "subtitle": s.get("subtitle", "")} for s in specs]
    other = os.path.join(tmp, "Blazing-Rebirth")
    roots = {"custom": out_root if main_on else other, "classic": other if main_on else out_root}
    for label, keep in (("custom", (bundle_rel,)), ("classic", ())):
        root = roots[label]
        files = collect(root, keep)
        if label == "custom" and bundle_rel not in files: return
        mf = {"format": 1, "patchId": f"forge-{now}-summon-{label}", "part": "summon switch", "gameVersion": "2.28.0",
              "baseDataSha256": sha(b.read("blazing-data.json")), "units": units,
              "files": {rel: sha(open(p, "rb").read()) for rel, p in sorted(files.items())}}
        name = f"BlazingForge-summon-{label}.zip"
        with zipfile.ZipFile(os.path.join(a.out, name), "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            z.writestr("forge-patch.json", json.dumps(mf, indent=1, ensure_ascii=False))
            for rel, p in sorted(files.items()): z.write(p, "install/" + rel)
        print(f"{name}: {os.path.getsize(os.path.join(a.out, name)) / 2**20:.1f} MB, {len(files)} files")
    shutil.rmtree(tmp, ignore_errors=True)

def open_w(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "wb").write(data)

# ---------------------------------------------------------------- verify
def cmd_verify(a):
    b = Base(a.base); O = os.path.join(a.out, "Blazing-Rebirth", "BlazingData")
    ok = True
    def check(cond, msg):
        nonlocal ok; print(("ok   " if cond else "FAIL ") + msg); ok &= bool(cond)
    eng = jload(os.path.join(a.out, "Blazing-Rebirth", "BlazingEngine", "BlazingEngine.json"))
    bd_bytes = open(os.path.join(O, "blazing-data.json"), "rb").read(); bd = json.loads(bd_bytes)
    check(eng["expect"]["sha256"] == sha(bd_bytes), "BlazingEngine.json expects this blazing-data.json")
    ic_bytes = open(os.path.join(O, "content-ios/ios-content.json"), "rb").read(); ic = json.loads(ic_bytes)
    check(bd["iosContent"]["manifestSha256"] == sha(ic_bytes), "blazing-data.json -> ios-content.json")
    rt_bytes = open(os.path.join(O, "content-ios/ios-routes.json"), "rb").read(); routes = json.loads(rt_bytes)
    check(ic["routes"]["sha256"] == sha(rt_bytes) and ic["routes"]["count"] == len(routes), "ios-content.json -> ios-routes.json")
    pmp = os.path.join(O, "pack/manifest.json")
    pk_bytes = open(pmp, "rb").read() if os.path.exists(pmp) else b.read("pack/manifest.json"); pk = json.loads(pk_bytes)
    check(bd["pack"]["manifestSha256"] == sha(pk_bytes), "blazing-data.json -> pack/manifest.json")
    for k, f in ic.get("files", {}).items():
        p = os.path.join(O, "content-ios", k)
        if os.path.exists(p): check(sha(open(p, "rb").read()) == f["sha256"], f"ios-content files[{k}]")
    for route, v in routes.items():
        p = os.path.join(O, "content-ios", v["file"])
        if not os.path.exists(p):
            if v != b.routes.get(route): check(False, f"route {route} points to a missing file")
            continue
        data = open(p, "rb").read()
        crc_ok = v["crc"] is None or f"{unityfs.unity_crc(data):08X}" == v["crc"]
        check(sha(data) == v["sha256"] and len(data) == v["bytes"] and crc_ok, f"route {route[12:]} (sha, size, crc)")
    for f in pk["files"]:
        p = os.path.join(O, "pack", f["asset"])
        if os.path.exists(p): check(sha(open(p, "rb").read()) == f["sha256"], f"pack {f['asset']}")
    def route_file(route):
        p = os.path.join(O, "content-ios", routes[route]["file"])
        return open(p, "rb").read() if os.path.exists(p) else b.route_bytes(route)
    units = json.loads(obf.decode(bundles.read_text(open(os.path.join(O, "content-ios", routes[ROUTE_UNIT]["file"]), "rb").read())))["datas"]
    skills = {s["id"] for s in json.loads(obf.decode(bundles.read_text(open(os.path.join(O, "content-ios", routes[ROUTE_SKILL]["file"]), "rb").read())))["datas"]}
    lang = {e["id"]: e["languageString"] for e in json.loads(obf.decode(bundles.read_text(open(os.path.join(O, "content-ios", routes[ROUTE_LANG]["file"]), "rb").read())))["dataLsd"]["lss"]}
    lst = json.loads(obf.decode(bundles.read_text(open(os.path.join(O, LIST_MAIN), "rb").read())))
    lpaths = {e["asset_path"]: e for e in lst}
    cp_ = os.path.join(O, CHARS)
    chars = {u["unitId"] for u in (jload(cp_) if os.path.exists(cp_) else json.loads(b.read(CHARS)))["units"]}
    for uid in bd["forge"]["units"]:
        u = next((x for x in units if x["id"] == uid), None)
        check(u is not None, f"unit {uid} in client unit list")
        if not u: continue
        check(u["langId"] in lang and u["langId2"] in lang, f"unit {uid} name '{lang.get(u['langId'])}' / '{lang.get(u['langId2'])}'")
        check(u["skillId"] in skills and (u["sSkillId"] == 0 or u["sSkillId"] in skills), f"unit {uid} skills {u['skillId']}, {u['sSkillId'] or 'no ultimate'} exist")
        if u.get("sSkillId_2"):
            check(u["sSkillId_2"] in skills and u["sSkillIdPvP_2"] in skills, f"unit {uid} latent skill {u['sSkillId_2']} exists")
            cris = {re.search(r"cri_(\d+)", k).group(1) for k in routes if "/crimovie/" in k}
            check(all(c in cris for c in re.findall(r"cri_(\d+)", u["criId_2"])), f"unit {uid} latent video {u['criId_2']} routed")
        ab_ids = {a["id"] for a in json.loads(obf.decode(bundles.read_text(route_file(ROUTE_ABIL))))["datas"]}
        check(all(a in ab_ids for a in u["abilityID"] if a), f"unit {uid} abilities {[a for a in u['abilityID'] if a]} exist")
        cp = f"card/img_card_{u['cardImageId']:05d}.png"
        check(cp in lpaths and (R + cp) in routes, f"unit {uid} card {cp} listed and routed")
        check(uid in chars, f"unit {uid} in engine character catalog")
    arel = "pack/" + next(f["asset"] for f in pk["files"] if f["route"].endswith("/unitdata/unitlist.bytes"))
    ap = os.path.join(O, arel)
    android = json.loads(obf.decode(bundles.read_text(open(ap, "rb").read() if os.path.exists(ap) else b.read(arel))))["datas"]
    check({x["id"] for x in android} == {x["id"] for x in units}, "engine (Android) unit list has the same unit IDs as the client")
    # battle assets: every custom unit's rig, cut-in and effects must exist in this build (else white boxes)
    C_ = catalog(b); base_units = client_units(b)
    base_S = {x["id"]: x for x in json.loads(obf.decode(bundles.read_text(b.route_bytes(ROUTE_SKILL))))["datas"]}
    S_ = {x["id"]: x for x in json.loads(obf.decode(bundles.read_text(open(os.path.join(O, "content-ios", routes[ROUTE_SKILL]["file"]), "rb").read())))["datas"]}
    Ub = {x["id"]: x for x in units}
    def has(pred): return any(uid in C_ and pred(uid, x) for uid, x in base_units.items())
    for uid in bd["forge"]["units"]:
        u = Ub[uid]
        rig = has(lambda i, x: x["boneId"] == u["boneId"] and part_ok(C_[i], "rig"))
        cut = has(lambda i, x: x["cutInImageId"] == u["cutInImageId"] and part_ok(C_[i], "cutin"))
        jb = S_[u["skillId"]]["skillBoneId"]
        jfx = has(lambda i, x: x.get("skillId") in base_S and base_S[x["skillId"]]["skillBoneId"] == jb and part_ok(C_[i], "jutsu"))
        ufx = True
        if u.get("sSkillId"):
            ub = S_[u["sSkillId"]]["skillBoneId"]
            ufx = has(lambda i, x: x.get("sSkillId") in base_S and base_S[x["sSkillId"]]["skillBoneId"] == ub and part_ok(C_[i], "ultimate"))
        # Rebirth's asset audit is only a hint (it has flagged rigs that work), so this is a note, not a failure
        print(("ok   " if rig and cut and jfx and ufx else "note ") + f"unit {uid} battle assets per Rebirth's audit (rig {rig}, cut-in {cut}, jutsu fx {jfx}, ultimate fx {ufx})")
    # battle face icons: img_chakraicon_<iconImageId> must exist, or the HUD shows a white box and ultimates can crash
    def route_data(route):
        v = routes[route]; p = os.path.join(O, "content-ios", v["file"])
        return open(p, "rb").read() if os.path.exists(p) else b.route_bytes(route)
    th_ids = {int(l.split(",")[0]) for l in bundles.read_text(route_data(ROUTE_THUMBS_TXT)).decode().splitlines() if l.strip()}
    th_names = set(bundles.list_textures(route_data(ROUTE_THUMBS))[0])
    for uid in bd["forge"]["units"]:
        ii = Ub[uid]["iconImageId"]
        check(ii in th_ids and f"img_chakraicon_{ii:05d}" in th_names, f"unit {uid} battle face icon img_chakraicon_{ii:05d} listed and present")
    rp = os.path.join(O, SUMMON_DIR, "rotation.json")
    if os.path.exists(rp):
        rot = jload(rp); rot0 = json.loads(b.read(SUMMON_DIR + "/rotation.json"))
        known = {}
        for pid, rel in rot0["pools"].items():
            for e in json.loads(b.read(SUMMON_DIR + "/" + rel))["entries"]: known[e["unitId"]] = (e["name"], e["subtitle"], e["rarity"])
        for pid, rel in rot["pools"].items():
            if pid in rot0["pools"]: continue
            ents = jload(os.path.join(O, SUMMON_DIR, rel))["entries"]
            bad = [e["unitId"] for e in ents if known.get(e["unitId"]) != (e["name"], e["subtitle"], e["rarity"])]
            check(not bad, f"banner pool {pid}: every entry keeps the server's own identity" + (f" (bad: {bad[:5]})" if bad else ""))
        for bid, rel in rot["rareBanners"].items():
            if bid in rot0["rareBanners"]: continue
            bn = jload(os.path.join(O, SUMMON_DIR, rel))
            check(not any(c in bn["name"] + bn["ticker"] for c in ":!") and bn["sortNo"] == bn["gashaRareId"], f"banner {bid}: name/ticker/sortNo follow the tested rules")
    if bd["forge"].get("mode") == "slots":
        for rel in LOCKED_FILES(b):
            p = os.path.join(O, rel)
            check(not os.path.exists(p) or open(p, "rb").read() == b.read(rel), f"locked server file untouched: {rel}")
        print("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"); sys.exit(0 if ok else 1)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    for name in ("fetch", "donors", "slots", "build", "verify"):
        p = sp.add_parser(name); p.add_argument("--base", required=True)
        if name == "build":
            p.add_argument("--mod", required=True); p.add_argument("--engine", required=True); p.add_argument("--out", required=True)
            p.add_argument("--summon", choices=("auto", "on", "off"), default="auto",
                           help="summon animation: auto = summon.json's \"enabled\" (default on), off = the game's own, on = yours")
            p.add_argument("--allow-new-ids", action="store_true", help="brand-new unit IDs (needs a server with its fingerprint lock patched)")
        if name == "verify": p.add_argument("--out", required=True)
    a = ap.parse_args()
    {"fetch": cmd_fetch, "donors": cmd_donors, "slots": cmd_slots, "build": cmd_build, "verify": cmd_verify}[a.cmd](a)
