"""Read single files out of the Blazing:Rebirth iOS data release (two zip parts on GitHub) with HTTP range requests."""
import json, os, struct, subprocess, time, zlib, urllib.request

BASE = "https://github.com/notgate/blazing-rebirth-cache/releases/download/ios-data-v1/Blazing-Rebirth-iOS-Data-v1.zip.part0"
PART = 1748562375
TOTAL = 3497124750
INDEX = os.path.join(os.path.expanduser("~"), ".blazing-forge-index.json")
_urls = {}

def _resolve(i):
    u = _urls.get(i)
    if u and time.time() - u[1] < 1200: return u[0]
    req = urllib.request.Request(BASE + str(i), headers={"Range": "bytes=0-0"})
    with urllib.request.urlopen(req) as r: url = r.geturl()
    _urls[i] = (url, time.time()); return url

def _rng(i, a, b):
    for _ in range(4):
        try:
            req = urllib.request.Request(_resolve(i), headers={"Range": f"bytes={a}-{b}"})
            with urllib.request.urlopen(req) as r: data = r.read()
            if len(data) == b - a + 1: return data
        except Exception:
            pass
        _urls.pop(i, None)
    raise RuntimeError(f"download failed (part {i}, {a}-{b})")

def read(off, n):
    out = b""
    while n > 0:
        i = 1 if off < PART else 2
        lo = off if i == 1 else off - PART
        take = min(n, PART - lo)
        out += _rng(i, lo, lo + take - 1); off += take; n -= take
    return out

def _entries():
    tail = read(TOTAL - 65600, 65600)
    p = tail.rfind(b"PK\x05\x06")
    _, _, _, _, cnt, cdsize, cdoff, _ = struct.unpack("<IHHHHIIH", tail[p:p+22])
    z = tail.rfind(b"PK\x06\x06")
    if z != -1: cnt, cdsize, cdoff = struct.unpack("<QQQ", tail[z+32:z+56])
    cd = read(cdoff, cdsize); res = []; q = 0
    while q < len(cd) and cd[q:q+4] == b"PK\x01\x02":
        meth = struct.unpack("<H", cd[q+10:q+12])[0]
        csize, usize = struct.unpack("<II", cd[q+20:q+28])
        nl, el, cl = struct.unpack("<HHH", cd[q+28:q+34])
        lho = struct.unpack("<I", cd[q+42:q+46])[0]
        name = cd[q+46:q+46+nl].decode("utf-8", "replace")
        extra = cd[q+46+nl:q+46+nl+el]; e = 0
        while e + 4 <= len(extra):
            hid, hl = struct.unpack("<HH", extra[e:e+4])
            if hid == 1:
                vals = extra[e+4:e+4+hl]; k = 0
                if usize == 0xFFFFFFFF: usize = struct.unpack("<Q", vals[k:k+8])[0]; k += 8
                if csize == 0xFFFFFFFF: csize = struct.unpack("<Q", vals[k:k+8])[0]; k += 8
                if lho == 0xFFFFFFFF: lho = struct.unpack("<Q", vals[k:k+8])[0]; k += 8
            e += 4 + hl
        res.append((name, meth, csize, usize, lho)); q += 46 + nl + el + cl
    return res

def load_index():
    if os.path.exists(INDEX): return [tuple(x) for x in json.load(open(INDEX))]
    ents = _entries(); json.dump(ents, open(INDEX, "w")); return ents

def fetch(ent):
    name, meth, csize, usize, lho = ent
    h = read(lho, 30); nl, el = struct.unpack("<HH", h[26:30])
    data = read(lho + 30 + nl + el, csize) if csize else b""
    if meth == 8: data = zlib.decompress(data, -15)
    elif meth != 0: raise RuntimeError(f"zip method {meth}")
    return data
