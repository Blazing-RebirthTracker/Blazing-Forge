#!/usr/bin/env python3
"""Data-only iOS BlazingEngine playable-ID extension, EXPERIMENTAL.
Supports only the unmodified engine extracted from Blazing-Rebirth-iOS-offline.ipa.
Keeps Mach-O size, all 1089 original ID entries, and every other byte unchanged.
Does NOT add full backend unit records or prove Present Box compatibility.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

BASE_SHA = "d4527aed100120bde2566106d00630441a8eba74c7f925ef83affe54dd54540b"
MARKER = b"[10013, 10014, 10015,"

def sha(blob):
    return hashlib.sha256(blob).hexdigest()

def const_section(blob):
    if struct.unpack_from("<I", blob)[0] != 0xfeedfacf or struct.unpack_from("<i", blob, 4)[0] != 0x0100000c:
        raise ValueError("expected arm64 64-bit Mach-O")
    ncmds = struct.unpack_from("<I", blob, 16)[0]
    p = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", blob, p)
        if size < 8 or p + size > len(blob): raise ValueError("invalid Mach-O load command")
        if cmd == 0x19:
            nsects = struct.unpack_from("<I", blob, p + 64)[0]
            for i in range(nsects):
                s = p + 72 + 80 * i
                name, seg, _, length, off = struct.unpack_from("<16s16sQQI", blob, s)
                if name.rstrip(b"\0") == b"__const" and seg.rstrip(b"\0") == b"__TEXT":
                    return off, length
        p += size
    raise ValueError("__TEXT,__const section not found")

def patch(blob, new_id):
    if sha(blob) != BASE_SHA: raise ValueError("unrecognized base engine SHA; refusing to patch")
    if blob.count(MARKER) != 1: raise ValueError("expected one unique playable list")
    st = blob.index(MARKER)
    en = blob.index(b"]", st) + 1
    off, size = const_section(blob)
    if not off <= st < en <= off + size: raise ValueError("list outside data section")
    old = blob[st:en]
    orig = json.loads(old)
    if len(orig) != 1089 or len(orig) != len(set(orig)) or 13476 not in orig:
        raise ValueError("unexpected baseline playable list")
    if new_id in orig or new_id < 10000: raise ValueError("colliding/invalid new ID")
    append = (", " + str(new_id)).encode("ascii")
    prefix = old[:-1]
    if prefix.count(b", ") < len(append): raise ValueError("no room from JSON optional spaces")
    for _ in range(len(append)): prefix = prefix.replace(b", ", b",", 1)
    updated = prefix + append + b"]"
    if len(updated) != len(old): raise ValueError("size changed")
    new = json.loads(updated)
    if set(new) != (set(orig) | {new_id}) or len(new) != len(orig) + 1:
        raise ValueError("IDs not preserved")
    result = blob[:st] + updated + blob[en:]
    if len(result) != len(blob) or result[:st] != blob[:st] or result[en:] != blob[en:]:
        raise ValueError("changed unrelated engine data")
    audit = dict(source_sha256=sha(blob), output_sha256=sha(result),
                 original_count=len(orig), resulting_count=len(new),
                 new_id=new_id, data_region_offset=hex(st),
                 all_original_ids_retained=True, file_size_unchanged=True,
                 warning="NativeAOT backend registry, gift acceptance, and save compatibility remain unproven")
    return result, audit

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("engine", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--id", type=int, default=480046)
    args = p.parse_args()
    if args.engine.resolve() == args.out.resolve(): p.error("do not overwrite the original engine")
    patched, audit = patch(args.engine.read_bytes(), args.id)
    args.out.write_bytes(patched)
    args.out.with_suffix(".audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print(json.dumps(audit, indent=2))
