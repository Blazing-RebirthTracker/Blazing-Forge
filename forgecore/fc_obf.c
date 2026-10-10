/* ObfuscatedText: [seed u32 LE][marker ^ r][stream ^ r ...]; stream: literal byte, or marker,0 -> literal marker;
   marker,dist,len -> copy len bytes from out[-dist]. r = low byte of MT19937(seed). */
#include "fc.h"
#include <stdlib.h>
#include <string.h>

static void mt_bytes(uint32_t seed, uint8_t *dst, size_t n) {
    uint32_t mt[624]; mt[0] = seed;
    for (int i = 1; i < 624; i++) mt[i] = 1812433253u * (mt[i-1] ^ (mt[i-1] >> 30)) + (uint32_t)i;
    size_t o = 0;
    while (o < n) {
        for (int k = 0; k < 624; k++) {
            uint32_t y = (mt[k] & 0x80000000u) | (mt[(k + 1) % 624] & 0x7fffffffu);
            mt[k] = mt[(k + 397) % 624] ^ (y >> 1) ^ ((y & 1) ? 0x9908b0dfu : 0);
        }
        for (int k = 0; k < 624 && o < n; k++) {
            uint32_t y = mt[k];
            y ^= y >> 11; y ^= (y << 7) & 0x9d2c5680u; y ^= (y << 15) & 0xefc60000u; y ^= y >> 18;
            dst[o++] = (uint8_t)y;
        }
    }
}

int obf_decode(const uint8_t *src, size_t n, Buf *out) {
    if (n < 5) return fc_fail("obfuscated text too short");
    uint32_t seed = rd32le(src); size_t m = n - 4;
    uint8_t *b = malloc(m); mt_bytes(seed, b, m);
    for (size_t i = 0; i < m; i++) b[i] ^= src[4 + i];
    uint8_t marker = b[0]; size_t i = 1;
    out->n = 0; buf_reserve(out, m * 2);
    while (i < m) {
        uint8_t c = b[i++];
        if (c != marker) { buf_byte(out, c); continue; }
        if (i >= m) break;
        uint8_t d = b[i++];
        if (!d) { buf_byte(out, marker); continue; }
        if (i >= m) break;
        uint8_t ln = b[i++];
        if (d > out->n) { free(b); return fc_fail("obfuscated text: bad back-reference"); }
        size_t s = out->n - d;
        buf_reserve(out, ln);
        for (int k = 0; k < ln; k++) out->p[out->n++] = out->p[s + k];
    }
    free(b); return 0;
}

void obf_encode(const uint8_t *data, size_t n, uint32_t seed, Buf *out) {
    size_t counts[256] = {0};
    for (size_t i = 0; i < n; i++) counts[data[i]]++;
    int marker = 0; for (int c = 1; c < 256; c++) if (counts[c] < counts[marker]) marker = c;
    Buf s = {0}; buf_byte(&s, (uint8_t)marker);
    /* hash chains over 4-byte keys, distances up to 255, no overlapping copies (len < dist), like the Python encoder */
    enum { HB = 16 };
    int32_t *head = malloc(sizeof(int32_t) << HB), *prev = malloc(sizeof(int32_t) * (n + 1));
    memset(head, 0xff, sizeof(int32_t) << HB);
    #define HASH(p) ((uint32_t)(((p)[0] | (p)[1] << 8 | (p)[2] << 16 | (uint32_t)(p)[3] << 24) * 2654435761u) >> (32 - HB))
    size_t i = 0;
    while (i < n) {
        int best = 0, bd = 0;
        if (i + 4 <= n) {
            int32_t p = head[HASH(data + i)]; int tries = 16;
            while (p >= 0 && tries--) {
                size_t d = i - (size_t)p;
                if (d > 255) break;
                if (!memcmp(data + p, data + i, 4)) {
                    int L = 0;
                    while (L < 255 && (size_t)L < d && i + L < n && data[p + L] == data[i + L]) L++;
                    if (L > best) { best = L; bd = (int)d; }
                }
                p = prev[p];
            }
        }
        int adv = best >= 4 ? best : 1;
        if (best >= 4) { buf_byte(&s, (uint8_t)marker); buf_byte(&s, (uint8_t)bd); buf_byte(&s, (uint8_t)best); }
        else if (data[i] == marker) { buf_byte(&s, (uint8_t)marker); buf_byte(&s, 0); }
        else buf_byte(&s, data[i]);
        for (int k = 0; k < adv; k++, i++) if (i + 4 <= n) { uint32_t h = HASH(data + i); prev[i] = head[h]; head[h] = (int32_t)i; }
    }
    free(head); free(prev);
    out->n = 0; buf_u32le(out, seed);
    size_t off = out->n; buf_put(out, s.p, s.n);
    uint8_t *r = malloc(s.n); mt_bytes(seed, r, s.n);
    for (size_t k = 0; k < s.n; k++) out->p[off + k] ^= r[k];
    free(r); buf_free(&s);
}
