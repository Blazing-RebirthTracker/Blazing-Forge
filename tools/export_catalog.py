"""Compact game catalog for Blazing Forge Studio (names, kits, slots), from the clean base data.
Run from the repo root: python3 tools/export_catalog.py  (needs base/BlazingData, see forge/forge.py fetch)."""
import sys, json, re, collections
sys.path.insert(0, "forge"); sys.path.insert(0, "forge/lib"); import forge  # run from the repo root
b = forge.Base("base")
U = forge.Text(b.route_bytes(forge.ROUTE_UNIT)).json()["datas"]
S = {e["id"]: e for e in forge.Text(b.route_bytes(forge.ROUTE_SKILL)).json()["datas"]}
A = forge.Text(b.route_bytes(forge.ROUTE_ABIL)).json()["datas"]
F = forge.Text(b.route_bytes(forge.R + "unitdatabin/fieldskilllist.bytes")).json()["datas"]
B = forge.Text(b.route_bytes(forge.R + "unitdatabin/buddyskilllist.bytes")).json()["datas"]
L = {e["id"]: e["languageString"] for e in forge.Text(b.route_bytes(forge.ROUTE_LANG)).json()["dataLsd"]["lss"]}
C = forge.catalog(b)
pool = json.load(open("tools/data/pool_classified.json"))

def fill(tmpl, second):
    vals = [v for v in str(second).split(",")]
    def rep(m):
        i = int(m.group(1)); return vals[i] if i < len(vals) else m.group(0)
    return re.sub(r"\{(\d+)\}", rep, tmpl or "").replace("\\n", " ").replace("\n", " ").strip()

skills_used = set(); abil_used = set()
units = []
for u in U:
    name = L.get(u["langId"], ""); sub = L.get(u["langId2"], "")
    if not name or u["rare"] < 1: continue
    c = C.get(u["id"]); cov = (c or {}).get("sourceCoverage", {})
    rig = bool(c and forge.part_ok(c, "rig"))
    row = {"id": u["id"], "n": name, "s": sub, "r": u["rare"], "a": u["attr"], "e": u.get("evoId", 0),
           "j": u.get("skillId", 0), "u": u.get("sSkillId", 0), "l": u.get("sSkillId_2", 0),
           "ab": [x for x in u.get("abilityID", []) if x], "f": u.get("fieldSkillId", 0), "b": u.get("buddySkillId", 0),
           "ch": [u.get("start_chakura", 0), u.get("chakuraMax", 0)],
           "ok": [int(rig), int(bool(c and forge.part_ok(c, "cutin"))), int(bool(c and forge.part_ok(c, "jutsu"))), int(bool(c and forge.part_ok(c, "ultimate")))],
           "st": [u["paramDatas"][-1]["hp"]["e"], u["paramDatas"][-1]["atk"]["e"]] if u.get("paramDatas") else [0, 0]}
    if u["rare"] >= 5 or rig:
        units.append(row)
        for k in ("j", "u", "l"):
            if row[k]: skills_used.add(row[k])
        abil_used.update(row["ab"])
skills = {}
for sid in sorted(skills_used):
    s = S.get(sid)
    if not s: continue
    skills[sid] = [L.get(s["langNameID"], ""), s["script"], s["secondScript"], s["type"], s["turn"], fill(L.get(s["langInfoID"], ""), s["secondScript"])]
abil = {}
for a in A:
    abil[a["id"]] = [L.get(a["nameLangId"], ""), fill(L.get(a["explanationLangId"], ""), a["secondScript"]), a["script"]]
used_f = collections.Counter(u.get("fieldSkillId") for u in U)
field = {f["id"]: [L.get(f["nameLangId"], ""), f["script"], f["secondScript"], int(used_f[f["id"]] == 0)] for f in F}
buddy = {x["id"]: [fill(L.get(x["explanationLangId"], ""), x["secondScript"]), x["script"]] for x in B}
# summonable 5*->6* pairs that are normally free (events, shops): safe to take over
slots = []
for e in pool:
    if e["rarity"] == 5 and len(e["chain"]) == 2 and e["cat"].startswith("free"):
        slots.append({"r5": e["chain"][0], "r6": e["chain"][1], "n": e["name"], "s": e["subtitle"],
                      "how": "; ".join(e.get("obtain", []))[:120], "impact": any("Impact" in o for o in e.get("obtain", []))})
out = {"attrs": {"1": "Heart", "2": "Skill", "3": "Body", "4": "Bravery", "5": "Wisdom"},
       "units": units, "skills": skills, "abilities": abil, "field": field, "buddy": buddy, "slots": slots}
s = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
open("docs/catalog.json", "w").write(s)
print(len(units), "units", len(skills), "skills", len(abil), "abilities", len(field), "field", len(buddy), "buddy", len(slots), "slots", len(s) // 1024, "KB")
