"""ObfuscatedText codec for the game client (reimplemented from ObfuscatedText.DecodeToBin).
Layout: [seed u32 LE][marker ^ r][stream ^ r ...]; stream: literal byte, or
marker,0 -> literal marker; marker,dist,len -> copy len bytes from out[-dist].
"""
import numpy as np

def mt_stream(seed, n):
    mt = np.zeros(624, dtype=np.uint64)
    mt[0] = seed & 0xffffffff
    for i in range(1, 624):
        p = int(mt[i-1]); mt[i] = (1812433253 * (p ^ (p >> 30)) + i) & 0xffffffff
    mt = mt.astype(np.uint32)
    out = np.empty(((n + 623) // 624) * 624, dtype=np.uint32)
    for blk in range(len(out) // 624):
        for k in range(624):
            y = (int(mt[k]) & 0x80000000) | (int(mt[(k+1) % 624]) & 0x7fffffff)
            mt[k] = int(mt[(k+397) % 624]) ^ (y >> 1) ^ (0x9908b0df if y & 1 else 0)
        y = mt.copy()
        y ^= y >> np.uint32(11)
        y ^= (y << np.uint32(7)) & np.uint32(0x9d2c5680)
        y ^= (y << np.uint32(15)) & np.uint32(0xefc60000)
        y ^= y >> np.uint32(18)
        out[blk*624:(blk+1)*624] = y
    return (out[:n] & 0xff).astype(np.uint8)

def decode(src: bytes) -> bytes:
    seed = int.from_bytes(src[:4], "little")
    body = np.frombuffer(src[4:], dtype=np.uint8) ^ mt_stream(seed, len(src) - 4)
    b = body.tobytes()
    marker = b[0]; out = bytearray(); i = 1; n = len(b)
    while i < n:
        c = b[i]; i += 1
        if c != marker:
            out.append(c); continue
        d = b[i]; i += 1
        if d == 0:
            out.append(marker); continue
        ln = b[i]; i += 1
        s = len(out) - d
        for k in range(ln): out.append(out[s + k])
    return bytes(out)

def encode(data: bytes, seed: int = 0x4E524231, compress=True) -> bytes:
    """Inverse of decode. Marker = least frequent byte. Simple greedy LZ (dist,len <= 255)."""
    counts = np.bincount(np.frombuffer(data, dtype=np.uint8), minlength=256)
    marker = int(np.argmin(counts))
    out = bytearray([marker]); i = 0; n = len(data)
    index = {}
    while i < n:
        best_len = 0; best_d = 0
        if compress and i + 4 <= n:
            key = data[i:i+4]
            for p in reversed(index.get(key, [])[-16:]):
                d = i - p
                if d > 255: continue
                L = 0
                while L < 255 and L < d and i + L < n and data[p + L] == data[i + L]: L += 1
                if L > best_len: best_len, best_d = L, d
        if best_len >= 4:
            out += bytes([marker, best_d, best_len])
            for k in range(best_len):
                if i + k + 4 <= n: index.setdefault(data[i+k:i+k+4], []).append(i + k)
            i += best_len
        else:
            c = data[i]
            out += bytes([marker, 0]) if c == marker else bytes([c])
            if i + 4 <= n: index.setdefault(data[i:i+4], []).append(i)
            i += 1
    ks = mt_stream(seed, len(out))
    return seed.to_bytes(4, "little") + (np.frombuffer(bytes(out), dtype=np.uint8) ^ ks).tobytes()
