/* UnityFS (bundle format 6/7) reader and a writer that matches UnityPy's "lz4" packer (proven on device). */
#include "fc.h"
#include "vendor/lz4.h"
#include "vendor/lz4hc.h"
#include <stdlib.h>
#include <string.h>

static int cstr(const uint8_t *b, size_t n, size_t *o, char **out) {
    size_t s = *o; while (*o < n && b[*o]) (*o)++;
    if (*o >= n) return -1;
    *out = malloc(*o - s + 1); memcpy(*out, b + s, *o - s + 1); (*o)++; return 0;
}
static int unlz4(const uint8_t *src, size_t sn, uint8_t *dst, size_t dn) {
    int r = LZ4_decompress_safe((const char *)src, (char *)dst, (int)sn, (int)dn);
    return r == (int)dn ? 0 : -1;
}

int ufs_parse(const uint8_t *buf, size_t n, Ufs *u) {
    memset(u, 0, sizeof *u);
    size_t o = 0; char *sig;
    if (cstr(buf, n, &o, &sig) || strcmp(sig, "UnityFS")) { if (o) free(sig); return fc_fail("not a UnityFS bundle"); }
    free(sig);
    if (o + 4 > n) return fc_fail("truncated bundle");
    u->fmt = rd32be(buf + o); o += 4;
    if (cstr(buf, n, &o, &u->ver) || cstr(buf, n, &o, &u->rev) || o + 20 > n) return fc_fail("truncated bundle header");
    uint32_t csz = rd32be(buf + o + 8), usz = rd32be(buf + o + 12), flags = rd32be(buf + o + 16); o += 20;
    if (u->fmt >= 7) o = (o + 15) & ~(size_t)15;
    const uint8_t *bi; size_t data_start;
    if (flags & 0x80) { if (csz > n) return fc_fail("bad block info"); bi = buf + n - csz; data_start = o; }
    else { bi = buf + o; data_start = o + csz; }
    if (flags & 0x200) data_start = (data_start + 15) & ~(size_t)15;
    uint8_t *info = malloc(usz ? usz : 1);
    int comp = flags & 0x3f;
    if (comp == 0) memcpy(info, bi, usz);
    else if ((comp == 2 || comp == 3) && !unlz4(bi, csz, info, usz)) {}
    else { free(info); return fc_fail("unsupported block-info compression %d", comp); }
    size_t p = 16;
    int nb = (int)rd32be(info + p); p += 4;
    uint32_t *bu = malloc(sizeof(uint32_t) * nb), *bc = malloc(sizeof(uint32_t) * nb); uint16_t *bf = malloc(2 * nb);
    size_t total = 0;
    for (int i = 0; i < nb; i++) { bu[i] = rd32be(info + p); bc[i] = rd32be(info + p + 4); bf[i] = rd16be(info + p + 8); p += 10; total += bu[i]; }
    int nn = (int)rd32be(info + p); p += 4;
    uint8_t *raw = malloc(total ? total : 1); size_t q = data_start, w = 0; int bad = 0;
    for (int i = 0; i < nb && !bad; i++) {
        if (q + bc[i] > n) { bad = 1; break; }
        int m = bf[i] & 0x3f;
        if (m == 0) memcpy(raw + w, buf + q, bu[i]);
        else if (m == 2 || m == 3) bad = unlz4(buf + q, bc[i], raw + w, bu[i]);
        else bad = 2;
        q += bc[i]; w += bu[i];
    }
    if (bad) { free(info); free(raw); free(bu); free(bc); free(bf); return fc_fail(bad == 2 ? "unsupported block compression (LZMA?)" : "corrupt bundle block"); }
    u->files = calloc(nn, sizeof(UfsFile)); u->nfiles = nn;
    for (int i = 0; i < nn; i++) {
        uint64_t off = rd64be(info + p), sz = rd64be(info + p + 8); uint32_t fl = rd32be(info + p + 16); p += 20;
        cstr(info, usz, &p, &u->files[i].name);
        u->files[i].flags = fl;
        if (off + sz > total) { free(info); free(raw); free(bu); free(bc); free(bf); return fc_fail("bad bundle node"); }
        buf_put(&u->files[i].data, raw + off, sz);
    }
    free(info); free(raw); free(bu); free(bc); free(bf);
    return 0;
}

void ufs_free(Ufs *u) {
    for (int i = 0; i < u->nfiles; i++) { free(u->files[i].name); buf_free(&u->files[i].data); }
    free(u->files); free(u->ver); free(u->rev); memset(u, 0, sizeof *u);
}

static size_t hc(const uint8_t *src, size_t n, uint8_t *dst, size_t cap, int level) {
    return (size_t)LZ4_compress_HC((const char *)src, (char *)dst, (int)n, (int)cap, level);
}

void ufs_build(const Ufs *u, Buf *out, int level) {
    if (level <= 0) level = 9;
    Buf data = {0};
    for (int i = 0; i < u->nfiles; i++) buf_put(&data, u->files[i].data.p, u->files[i].data.n);
    const size_t CH = 0x20000;
    Buf blocks = {0}; Buf bi = {0}; buf_zero(&bi, 16);
    size_t nblocks = (data.n + CH - 1) / CH; buf_u32be(&bi, (uint32_t)nblocks);
    uint8_t *tmp = malloc(LZ4_compressBound((int)CH));
    for (size_t p = 0; p < data.n; p += CH) {
        size_t len = data.n - p < CH ? data.n - p : CH;
        size_t c = hc(data.p + p, len, tmp, LZ4_compressBound((int)CH), level);
        int raw = c == 0 || (len == CH ? c >= CH : c > len);
        if (raw) { buf_put(&blocks, data.p + p, len); buf_u32be(&bi, (uint32_t)len); buf_u32be(&bi, (uint32_t)len); buf_u16be(&bi, 0); }
        else { buf_put(&blocks, tmp, c); buf_u32be(&bi, (uint32_t)len); buf_u32be(&bi, (uint32_t)c); buf_u16be(&bi, 2); }
    }
    free(tmp);
    buf_u32be(&bi, (uint32_t)u->nfiles);
    uint64_t off = 0;
    for (int i = 0; i < u->nfiles; i++) {
        buf_u64be(&bi, off); buf_u64be(&bi, u->files[i].data.n); buf_u32be(&bi, u->files[i].flags); buf_cstr(&bi, u->files[i].name);
        off += u->files[i].data.n;
    }
    uint8_t *cbi = malloc(LZ4_compressBound((int)bi.n)); size_t cbn = hc(bi.p, bi.n, cbi, LZ4_compressBound((int)bi.n), 9);
    out->n = 0;
    buf_cstr(out, "UnityFS"); buf_u32be(out, u->fmt); buf_cstr(out, u->ver); buf_cstr(out, u->rev);
    size_t size_pos = out->n; buf_u64be(out, 0); buf_u32be(out, (uint32_t)cbn); buf_u32be(out, (uint32_t)bi.n); buf_u32be(out, 0xC2);
    if (u->fmt >= 7) buf_align(out, 16, 0);
    buf_put(out, blocks.p, blocks.n); buf_put(out, cbi, cbn);
    uint64_t total = out->n;
    for (int k = 0; k < 8; k++) out->p[size_pos + k] = (uint8_t)(total >> (56 - 8 * k));
    free(cbi); buf_free(&blocks); buf_free(&bi); buf_free(&data);
}

int ufs_crc(const uint8_t *buf, size_t n, uint32_t *crc) {
    Ufs u; if (ufs_parse(buf, n, &u)) return -1;
    Buf all = {0}; for (int i = 0; i < u.nfiles; i++) buf_put(&all, u.files[i].data.p, u.files[i].data.n);
    *crc = crc32_of(all.p, all.n); buf_free(&all); ufs_free(&u); return 0;
}
