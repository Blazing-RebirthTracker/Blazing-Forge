"""Re-skin the summon animation (SpriteStudio puppet in uxsprite/gasha*): paint new part art into the
atlas cells the animation already uses, so every frame and timing stays the game's own."""
import UnityPy
from UnityPy.enums import TextureFormat
from PIL import Image


def _controller_cells(env, texture_name):
    """Cells (name -> cell dict) that the SSController maps to the given atlas texture."""
    objs = {o.path_id: o for o in env.objects}
    scripts = {o.path_id: o.read().m_ClassName for o in env.objects if o.type.name == "MonoScript"}
    for o in env.objects:
        if o.type.name != "MonoBehaviour":
            continue
        tt = o.read_typetree()
        if scripts.get(tt["m_Script"]["m_PathID"]) != "SSController":
            continue
        names = []
        for t in tt["cellTextures"]:
            x = objs.get(t["m_PathID"])
            names.append(x.read().m_Name if x is not None and x.type.name == "Texture2D" else None)
        if texture_name not in names:
            continue
        map_id = names.index(texture_name)
        return {c["name"]: c for c in tt["cellList"] if c["mapId"] == map_id}
    raise KeyError(f"no SpriteStudio controller uses {texture_name}")


def shift(img, dx, dy):
    """Move art inside its cell by a fraction of the cell size (right/down positive); what moves off is cut."""
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(img, (round(dx * img.width), round(dy * img.height)))
    return out


def fit(img, w, h, mode="stretch", rotate=0):
    img = img.convert("RGBA")
    if rotate:
        img = img.rotate(rotate, expand=True)
    a = img.getchannel("A").point(lambda v: 0 if v < 8 else v)   # drop near-invisible export fringe
    img.putalpha(a)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    if mode == "stretch":
        return img.resize((w, h), Image.LANCZOS)
    if mode == "width":
        # full cell width, top-aligned (use an offset to push it down and leave empty space above)
        s = w / img.width
        im = img.resize((w, max(1, round(img.height * s))), Image.LANCZOS)
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0)); out.alpha_composite(im.crop((0, 0, w, min(h, im.height))), (0, 0))
        return out
    if mode == "cover":
        # fill the cell without distortion, trimming the sides (or top/bottom) evenly
        s = max(w / img.width, h / img.height)
        im = img.resize((max(w, round(img.width * s)), max(h, round(img.height * s))), Image.LANCZOS)
        x0, y0 = (im.width - w) // 2, (im.height - h) // 2
        return im.crop((x0, y0, x0 + w, y0 + h))
    # contain, bottom-centred (joints usually meet at the bottom of a cell)
    s = min(w / img.width, h / img.height)
    im = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(im, ((w - im.width) // 2, h - im.height))
    return out


def tint(img, rgb, dark_only=True):
    """Recolour a part (e.g. headband tails) keeping its shading."""
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            lum = (r * 299 + g * 587 + b * 114) / 1000 / 255
            if dark_only and lum < 0.12:      # keep the black outline
                continue
            k = 0.45 + lum * 0.9
            px[x, y] = (min(255, int(rgb[0] * k)), min(255, int(rgb[1] * k)), min(255, int(rgb[2] * k)), a)
    return img


def match_bottom(new, orig):
    """Cut the new art off at the bottom the way the original cell art is cut (column by column), so a part
    that the animation tucks under another one ends where the original did."""
    import numpy as np
    a = np.array(new.convert("RGBA")); o = np.array(orig.convert("RGBA"))[:, :, 3] > 24
    h = a.shape[0]
    rows = np.where(o.any(axis=1))[0]
    if not len(rows): return new
    for x in range(a.shape[1]):
        col = np.where(o[:, x])[0]
        last = col.max() if len(col) else rows.max()
        a[last + 1:, x, 3] = 0
    return Image.fromarray(a)


def scale_cells(env, texture_name, scales):
    """Change how big parts are drawn: SpriteStudio sizes each part's quad from its cell size (around the
    cell pivot), so scaling the size scales the part around its joint without moving the art in the atlas."""
    objs = {o.path_id: o for o in env.objects}
    scripts = {o.path_id: o.read().m_ClassName for o in env.objects if o.type.name == "MonoScript"}
    n = 0
    for o in env.objects:
        if o.type.name != "MonoBehaviour": continue
        tt = o.read_typetree()
        if scripts.get(tt["m_Script"]["m_PathID"]) != "SSController": continue
        names = [objs[t["m_PathID"]].read().m_Name if t["m_PathID"] in objs else None for t in tt["cellTextures"]]
        if texture_name not in names: continue
        mid = names.index(texture_name)
        for c in tt["cellList"]:
            if c["mapId"] == mid and c["name"] in scales:
                # quad size comes from size; the runtime may recompute the UVs from pos/size/pixelSize
                # (SSCell.Calculate), so scale all three together: same UVs, bigger quad
                k = scales[c["name"]]
                if isinstance(k, dict):          # {"scale": k or [kx, ky], "pivot": [x, y]}
                    if "pivot" in k: c["pivot"]["x"], c["pivot"]["y"] = float(k["pivot"][0]), float(k["pivot"][1])
                    k = k.get("scale", 1)
                kx, ky = (float(k[0]), float(k[1])) if isinstance(k, (list, tuple)) else (float(k), float(k))
                for key in ("size", "pos", "pixelSize"):
                    c[key]["x"] *= kx; c[key]["y"] *= ky
                n += 1
        o.save_typetree(tt)
    return n


def recolor_grey(img, rgb):
    """Turn the grey cloth of a part into another colour, keeping skin, outlines and shading."""
    import colorsys
    img = img.convert("RGBA"); px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a: continue
            h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if sat < 0.22 and 0.25 < l < 0.92:          # greyish cloth, not skin / outline
                k = 0.35 + l * 0.8
                px[x, y] = (min(255, int(rgb[0] * k)), min(255, int(rgb[1] * k)), min(255, int(rgb[2] * k)), a)
    return img


_TRANSFORMS = [(r, f) for r in (0, 90, 180, 270) for f in (False, True)]


def _xf(img, t):
    r, f = t
    img = img.rotate(r, expand=True) if r else img
    return img.transpose(Image.FLIP_LEFT_RIGHT) if f else img


def make_shadow(orig_src, new_src, orig_shadow):
    """Rebuild a shadow/glow cell (a silhouette of another part) from that part's new art: find how the original
    silhouette was made from the original part (rotation/flip + scale + offset), apply the same to the new part,
    and keep the original shadow's colour and its soft fade."""
    import numpy as np
    from PIL import ImageFilter
    sh = np.array(orig_shadow.convert("RGBA")).astype(float)
    sa = sh[:, :, 3]
    sb = Image.fromarray((sa > 24).astype(np.uint8) * 255).getbbox()
    if not sb: return orig_shadow
    best = None
    for t in _TRANSFORMS:
        o = _xf(orig_src.convert("RGBA"), t).getchannel("A")
        ob = o.point(lambda v: 255 if v > 24 else 0).getbbox()
        if not ob: continue
        crop = o.crop(ob).resize((sb[2] - sb[0], sb[3] - sb[1]))
        A = np.array(crop) > 24; B = sa[sb[1]:sb[3], sb[0]:sb[2]] > 24
        iou = (A & B).sum() / max(1, (A | B).sum())
        if best is None or iou > best[0]: best = (iou, t, ob)
    _, t, ob = best
    sx = (sb[2] - sb[0]) / (ob[2] - ob[0]); sy = (sb[3] - sb[1]) / (ob[3] - ob[1])
    n = _xf(new_src.convert("RGBA"), t)
    n = n.resize((max(1, round(n.width * sx)), max(1, round(n.height * sy))), Image.LANCZOS)
    canvas = Image.new("L", orig_shadow.size, 0)
    canvas.paste(n.getchannel("A"), (round(sb[0] - ob[0] * sx), round(sb[1] - ob[1] * sy)))
    sil = np.array(canvas).astype(float) / 255
    # soft fade: the original's alpha, widened and blurred, so gradients (hand shadows/glows) carry over
    env = Image.fromarray(sa.astype(np.uint8)).filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(8))
    env = np.array(env).astype(float) / max(1.0, sa.max())
    w = sa > 24
    col = (sh[:, :, :3][w] * sa[w][:, None]).sum(0) / max(1, sa[w].sum())
    out = np.zeros(sh.shape, np.uint8)
    out[:, :, :3] = col.astype(np.uint8)
    out[:, :, 3] = np.clip(sil * np.clip(env, 0, 1) * sa.max(), 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def reskin(bundle_bytes, texture_name, parts, scales=None, painted=None):
    """parts: cell name -> (PIL image, mode, rotate) or callable(original_crop) -> image.
    Returns (new bundle bytes, before atlas, after atlas)."""
    env = UnityPy.load(bundle_bytes)
    cells = _controller_cells(env, texture_name)
    tex_obj = next(o for o in env.objects if o.type.name == "Texture2D" and o.read().m_Name == texture_name)
    tex = tex_obj.read()
    before = tex.image.convert("RGBA")
    atlas = before.copy()
    for name, spec in parts.items():
        c = cells[name]
        x, y, w, h = int(c["pos"]["x"]), int(c["pos"]["y"]), int(c["size"]["x"]), int(c["size"]["y"])
        orig = atlas.crop((x, y, x + w, y + h))
        if isinstance(spec, dict) and "shadowFrom" in spec:
            src = painted[tuple(spec["shadowFrom"])]
            new_src = src[1]
            if spec.get("silhouette") is not None:      # a cut-out of just the character, laid out like the part
                new_src = fit(spec["silhouette"], src[0].width, src[0].height, spec.get("fit", "stretch"), spec.get("rotate", 0))
            new = make_shadow(src[0], new_src, before.crop((x, y, x + w, y + h)))
            if spec.get("offset"): new = shift(new, *spec["offset"])
        elif callable(spec):
            new = spec(orig)
        else:
            img, mode, rot = spec[:3]
            new = fit(img, w, h, mode, rot)
            if len(spec) > 3 and spec[3]: new = match_bottom(new, orig)
            if len(spec) > 4 and spec[4]: new = shift(new, *spec[4])
        atlas.paste(Image.new("RGBA", (w, h), (0, 0, 0, 0)), (x, y))
        atlas.paste(new, (x, y))
        if painted is not None: painted[(texture_name, name)] = (before.crop((x, y, x + w, y + h)), new)
    tex.set_image(atlas, target_format=TextureFormat.RGBA32)
    tex.save()
    if scales: scale_cells(env, texture_name, scales)
    return env.file.save(packer="lz4"), before, atlas
