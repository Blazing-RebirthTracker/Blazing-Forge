"""Minimal UnityFS (format 6, Unity 2018.4) reader/writer for single-file bundles."""
import struct, zlib, lz4.block

def _cstr(b, o):
    e = b.index(b"\0", o); return b[o:e].decode(), e + 1

def parse(buf):
    o = 0
    sig, o = _cstr(buf, o)
    assert sig == "UnityFS", sig
    fmt = struct.unpack(">I", buf[o:o+4])[0]; o += 4
    ver, o = _cstr(buf, o); rev, o = _cstr(buf, o)
    size, csz, usz, flags = struct.unpack(">qIII", buf[o:o+20]); o += 20
    hdr_end = o
    if flags & 0x80:  # blocks info at end
        bi = buf[len(buf) - csz:]
        data_start = hdr_end
    else:
        bi = buf[o:o+csz]; data_start = o + csz
    comp = flags & 0x3f
    if comp == 0: info = bi
    elif comp in (2, 3): info = lz4.block.decompress(bi, uncompressed_size=usz)
    else: raise ValueError(f"blocksinfo compression {comp}")
    p = 16  # hash
    nb = struct.unpack(">i", info[p:p+4])[0]; p += 4
    blocks = []
    for _ in range(nb):
        u, c, f = struct.unpack(">IIH", info[p:p+10]); p += 10; blocks.append((u, c, f))
    nn = struct.unpack(">i", info[p:p+4])[0]; p += 4
    nodes = []
    for _ in range(nn):
        off, sz, fl = struct.unpack(">qqI", info[p:p+20]); p += 20
        name, p = _cstr(info, p); nodes.append((off, sz, fl, name))
    raw = bytearray(); q = data_start
    for u, c, f in blocks:
        chunk = buf[q:q+c]; q += c
        m = f & 0x3f
        if m == 0: raw += chunk
        elif m in (2, 3): raw += lz4.block.decompress(chunk, uncompressed_size=u)
        else: raise ValueError(f"block compression {m}")
    files = {n[3]: bytes(raw[n[0]:n[0]+n[1]]) for n in nodes}
    return dict(fmt=fmt, ver=ver, rev=rev, nodes=nodes, files=files, raw=bytes(raw), flags=flags)

def build(meta, files_in_order, compress=True):
    """files_in_order: list of (name, bytes, node_flags). LZ4HC-ish (lz4 high compression) blocks of 128KB."""
    raw = b"".join(d for _, d, _ in files_in_order)
    nodes = []; off = 0
    for name, d, fl in files_in_order:
        nodes.append((off, len(d), fl, name)); off += len(d)
    blocks = []; data = bytearray()
    for i in range(0, len(raw), 0x20000):
        chunk = raw[i:i+0x20000]
        if compress:
            c = lz4.block.compress(chunk, mode="high_compression", compression=9, store_size=False)
            blocks.append((len(chunk), len(c), 3)); data += c
        else:
            blocks.append((len(chunk), len(chunk), 0)); data += chunk
    info = bytearray(b"\0" * 16) + struct.pack(">i", len(blocks))
    for u, c, f in blocks: info += struct.pack(">IIH", u, c, f)
    info += struct.pack(">i", len(nodes))
    for o, s, fl, name in nodes: info += struct.pack(">qqI", o, s, fl) + name.encode() + b"\0"
    cinfo = lz4.block.compress(bytes(info), store_size=False)
    head = b"UnityFS\0" + struct.pack(">I", meta["fmt"]) + meta["ver"].encode() + b"\0" + meta["rev"].encode() + b"\0"
    total = len(head) + 20 + len(cinfo) + len(data)
    head += struct.pack(">qIII", total, len(cinfo), len(info), 0x42)  # lz4hc blocksinfo, combined
    return head + cinfo + bytes(data)

def unity_crc(buf):
    """Unity's bundle CRC: CRC32 over the decompressed block data."""
    return zlib.crc32(parse(buf)["raw"]) & 0xffffffff
