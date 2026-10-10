"""Unity bundle surgery helpers built on UnityPy (Unity 2018.4.14f1 bundles)."""
import copy, random, hashlib
import UnityPy
from UnityPy.enums import TextureFormat
from PIL import Image

def _sf(env):
    bf = env.file
    for k, v in bf.files.items():
        if not k.endswith(".resS") and not k.endswith(".resource"):
            return k, v
    raise RuntimeError("no serialized file")

def save(env):
    return env.file.save(packer="lz4")

def replace_text(bundle_bytes, new_bytes):
    env = UnityPy.load(bundle_bytes)
    for o in env.objects:
        if o.type.name == "TextAsset":
            tt = o.read_typetree()
            tt["m_Script"] = new_bytes.decode("utf-8", "surrogateescape")
            o.save_typetree(tt)
            return save(env)
    raise RuntimeError("no TextAsset")

def read_text(bundle_bytes):
    env = UnityPy.load(bundle_bytes)
    for o in env.objects:
        if o.type.name == "TextAsset":
            s = o.read_typetree()["m_Script"]
            return s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)

def _new_cab(seed):
    return "CAB-" + hashlib.md5(seed.encode()).hexdigest()

def _set_texture(obj, img, name, fmt):
    tex = obj.read()
    tex.m_Name = name
    tex.set_image(img, target_format=fmt)
    tex.save()

def clone_card_bundle(donor_bytes, card_id, img: Image.Image):
    """New card/img_card_XXXXX.png bundle from a donor card bundle, RGBA32 inline texture."""
    name = f"img_card_{card_id:05d}"
    env = UnityPy.load(donor_bytes)
    cab_old, sf = _sf(env)
    cab_new = _new_cab(f"card-{card_id}")
    for o in env.objects:
        if o.type.name == "Texture2D":
            _set_texture(o, img.convert("RGBA"), name, TextureFormat.RGBA32)
    for o in env.objects:
        if o.type.name == "AssetBundle":
            tt = o.read_typetree()
            tt["m_Name"] = tt["m_AssetBundleName"] = f"card/{name}.png"
            tt["m_Container"] = [(f"assets/importassets/card/{name}.png", v) for _, v in tt["m_Container"]]
            o.save_typetree(tt)
    files = env.file.files
    files.pop(cab_old + ".resS", None)
    files[cab_new] = files.pop(cab_old)
    try: files[cab_new].name = cab_new
    except Exception: pass
    return save(env)

def add_icon(iconlist_bytes, icon_id, img: Image.Image, prefix="img_icon_"):
    """Add <prefix>XXXXX (128x128 RGBA4444) to an icon bundle: iconlist (img_icon_, box icons) or
    thumbnaillist (img_chakraicon_, the round face icons used in battle)."""
    name = f"{prefix}{icon_id:05d}"
    env = UnityPy.load(iconlist_bytes)
    _, sf = _sf(env)
    tex_objs = [o for o in env.objects if o.type.name == "Texture2D"]
    for o in tex_objs:
        if o.read().m_Name == name:
            _set_texture(o, img.convert("RGBA").resize((128, 128), Image.LANCZOS), name, TextureFormat.RGBA4444)
            return save(env)
    tmpl = tex_objs[0]
    new = copy.copy(tmpl)
    rnd = random.Random(icon_id)
    pid = rnd.randint(-2**62, 2**62)
    while pid in sf.objects: pid = rnd.randint(-2**62, 2**62)
    new.path_id = pid
    tt = tmpl.read_typetree()
    sf.objects[pid] = new
    new.save_typetree(tt)  # detach from template's raw data
    _set_texture(new, img.convert("RGBA").resize((128, 128), Image.LANCZOS), name, TextureFormat.RGBA4444)
    for o in env.objects:
        if o.type.name == "AssetBundle":
            tt = o.read_typetree()
            tt["m_PreloadTable"].append({"m_FileID": 0, "m_PathID": pid})
            idx = len(tt["m_PreloadTable"]) - 1
            key = f"assets/importassets/{tt['m_Name'].split('/')[0]}/{name}.png"
            sample = tt["m_Container"][0][0]
            if "/" in sample: key = sample.rsplit("/", 1)[0] + f"/{name}.png"
            tt["m_Container"].append((key, {"preloadIndex": idx, "preloadSize": 1, "asset": {"m_FileID": 0, "m_PathID": pid}}))
            o.save_typetree(tt)
    return save(env)

def list_textures(bundle_bytes):
    env = UnityPy.load(bundle_bytes)
    return {o.read().m_Name: o for o in env.objects if o.type.name == "Texture2D"}, env
