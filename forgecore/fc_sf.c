/* Unity SerializedFile (versions 9-21, little-endian data) with type-tree driven object reading and writing. */
#include "fc.h"
#include "commonstr.h"
#include <stdlib.h>
#include <string.h>

static const char *common(uint32_t off) {
    for (size_t i = 0; i < sizeof COMMON_STRINGS / sizeof *COMMON_STRINGS; i++) if (COMMON_STRINGS[i].off == off) return COMMON_STRINGS[i].s;
    return "?";
}

typedef struct { const uint8_t *d; size_t n, o; int be; int err; } Rd;
static uint32_t r32(Rd *r) { if (r->o + 4 > r->n) { r->err = 1; return 0; } uint32_t v = r->be ? rd32be(r->d + r->o) : rd32le(r->d + r->o); r->o += 4; return v; }
static uint16_t r16(Rd *r) { if (r->o + 2 > r->n) { r->err = 1; return 0; } uint16_t v = r->be ? rd16be(r->d + r->o) : rd16le(r->d + r->o); r->o += 2; return v; }
static uint64_t r64(Rd *r) { if (r->o + 8 > r->n) { r->err = 1; return 0; } uint64_t v = r->be ? rd64be(r->d + r->o) : rd64le(r->d + r->o); r->o += 8; return v; }
static uint8_t r8(Rd *r) { if (r->o + 1 > r->n) { r->err = 1; return 0; } return r->d[r->o++]; }
static void rskip(Rd *r, size_t k) { if (r->o + k > r->n) r->err = 1; else r->o += k; }
static void ralign(Rd *r, size_t base) { size_t m = (r->o - base) % 4; if (m) rskip(r, 4 - m); }
static void rcstr(Rd *r) { while (r->o < r->n && r->d[r->o]) r->o++; rskip(r, 1); }

int sf_parse(const uint8_t *d, size_t n, SFile *sf) {
    memset(sf, 0, sizeof *sf);
    if (n < 20) return fc_fail("serialized file too short");
    uint32_t msize = rd32be(d), version = rd32be(d + 8), doff = rd32be(d + 12);
    (void)msize;
    if (version < 9 || version >= 22) return fc_fail("unsupported serialized file version %u", version);
    sf->version = version; sf->big_endian = d[16];
    Rd r = {d, n, 20, sf->big_endian, 0};
    size_t meta_start = 20;
    if (version >= 7) rcstr(&r);
    if (version >= 8) r32(&r);
    int tree = 1; if (version >= 13) tree = r8(&r);
    if (!tree) return fc_fail("bundle has no type trees");
    int nt = (int)r32(&r);
    sf->types = calloc(nt, sizeof(SType)); sf->ntypes = nt;
    for (int i = 0; i < nt && !r.err; i++) {
        SType *t = &sf->types[i];
        t->class_id = (int)r32(&r);
        if (version >= 16) r8(&r);
        int16_t sidx = version >= 17 ? (int16_t)r16(&r) : -1; (void)sidx;
        if (version >= 13) { if ((version >= 16 && t->class_id == 114) || (version < 16 && t->class_id < 0)) rskip(&r, 16); rskip(&r, 16); }
        int nn = (int)r32(&r), ssz = (int)r32(&r);
        size_t nsz = version >= 19 ? 32 : 24;
        size_t nodes_at = r.o; rskip(&r, nsz * nn);
        const char *sb = (const char *)d + r.o; rskip(&r, ssz);
        if (r.err) break;
        char *strbuf = malloc(ssz + 1); memcpy(strbuf, sb, ssz); strbuf[ssz] = 0;
        if (sf->nstrbufs < 64) sf->strbufs[sf->nstrbufs++] = strbuf;
        t->nodes = calloc(nn, sizeof(TNode)); t->nnodes = nn;
        Rd nr = {d, n, nodes_at, sf->big_endian, 0};
        for (int k = 0; k < nn; k++) {
            TNode *x = &t->nodes[k];
            x->ver = r16(&nr); x->level = r8(&nr); x->flags = r8(&nr);
            uint32_t to = r32(&nr), no = r32(&nr);
            x->size = (int32_t)r32(&nr); x->index = (int32_t)r32(&nr); x->meta = (int32_t)r32(&nr);
            if (version >= 19) r64(&nr);
            x->type = (to & 0x80000000u) ? common(to & 0x7fffffff) : (to < (uint32_t)ssz ? strbuf + to : "?");
            x->name = (no & 0x80000000u) ? common(no & 0x7fffffff) : (no < (uint32_t)ssz ? strbuf + no : "?");
        }
        if (version >= 21) { int nd = (int)r32(&r); rskip(&r, 4 * (size_t)nd); }
    }
    if (r.err) return fc_fail("corrupt type list");
    buf_put(&sf->types_raw, d + meta_start, r.o - meta_start);
    int no = (int)r32(&r);
    sf->objs = calloc(no > 0 ? no : 1, sizeof(SObj)); sf->cap = no > 0 ? no : 1;
    for (int i = 0; i < no && !r.err; i++) {
        if (version >= 14) ralign(&r, 0);
        SObj *o = &sf->objs[sf->nobjs++];
        o->path_id = (int64_t)r64(&r);
        uint32_t bs = r32(&r), bz = r32(&r); o->type_idx = (int)r32(&r);
        if (version < 16) r16(&r);
        if (version == 15 || version == 16) r8(&r);
        if ((size_t)doff + bs + bz > n) return fc_fail("object outside file");
        buf_put(&o->data, d + doff + bs, bz);
    }
    if (r.err) return fc_fail("corrupt object list");
    size_t meta_end = 20 + msize;
    if (meta_end < r.o || meta_end > n) return fc_fail("bad metadata size");
    buf_put(&sf->tail_raw, d + r.o, meta_end - r.o);
    return 0;
}

static int cmp_obj(const void *a, const void *b) {
    int64_t x = ((const SObj *)a)->path_id, y = ((const SObj *)b)->path_id; return x < y ? -1 : x > y;
}
void sf_write(const SFile *sf, Buf *out) {
    SObj *sorted = malloc(sizeof(SObj) * (sf->nobjs ? sf->nobjs : 1)); memcpy(sorted, sf->objs, sizeof(SObj) * sf->nobjs);
    qsort(sorted, sf->nobjs, sizeof(SObj), cmp_obj);
    Buf meta = {0}, data = {0};
    buf_put(&meta, sf->types_raw.p, sf->types_raw.n);
    buf_u32le(&meta, (uint32_t)sf->nobjs);
    for (int i = 0; i < sf->nobjs; i++) {
        buf_align(&meta, 4, 0);
        buf_u64le(&meta, (uint64_t)sorted[i].path_id);
        buf_u32le(&meta, (uint32_t)data.n); buf_u32le(&meta, (uint32_t)sorted[i].data.n); buf_u32le(&meta, (uint32_t)sorted[i].type_idx);
        buf_put(&data, sorted[i].data.p, sorted[i].data.n);
        buf_align(&data, 8, 0);
    }
    buf_put(&meta, sf->tail_raw.p, sf->tail_raw.n);
    size_t doff = 20 + meta.n; doff += (16 - doff % 16) % 16;
    out->n = 0;
    buf_u32be(out, (uint32_t)meta.n); buf_u32be(out, (uint32_t)(doff + data.n)); buf_u32be(out, sf->version); buf_u32be(out, (uint32_t)doff);
    buf_byte(out, (uint8_t)sf->big_endian); buf_zero(out, 3);
    buf_put(out, meta.p, meta.n);
    buf_align(out, 16, 0);
    buf_put(out, data.p, data.n);
    buf_free(&meta); buf_free(&data); free(sorted);
}
void sf_free(SFile *sf) {
    for (int i = 0; i < sf->ntypes; i++) free(sf->types[i].nodes);
    free(sf->types);
    for (int i = 0; i < sf->nobjs; i++) buf_free(&sf->objs[i].data);
    free(sf->objs); buf_free(&sf->types_raw); buf_free(&sf->tail_raw);
    for (int i = 0; i < sf->nstrbufs; i++) free(sf->strbufs[i]);
    memset(sf, 0, sizeof *sf);
}
int sf_class(const SFile *sf, const SObj *o) { return o->type_idx >= 0 && o->type_idx < sf->ntypes ? sf->types[o->type_idx].class_id : -1; }
SObj *sf_add(SFile *sf, int64_t path_id, int type_idx) {
    if (sf->nobjs == sf->cap) { sf->cap *= 2; sf->objs = realloc(sf->objs, sizeof(SObj) * sf->cap); }
    SObj *o = &sf->objs[sf->nobjs++]; memset(o, 0, sizeof *o); o->path_id = path_id; o->type_idx = type_idx; o->changed = 1; return o;
}

/* ---------------------------------------------------------------- type-tree values */
typedef struct { const TNode *n; int cnt; } Tree;
static int kids(const Tree *t, int i, int *out, int max) {
    int c = 0; uint8_t L = t->n[i].level;
    for (int k = i + 1; k < t->cnt && t->n[k].level > L; k++) if (t->n[k].level == L + 1 && c < max) out[c++] = k;
    return c;
}
enum { P_NONE, P_I8, P_U8, P_I16, P_U16, P_I32, P_U32, P_I64, P_U64, P_F32, P_F64, P_BOOL };
static int prim(const char *t) {
    if (!strcmp(t, "SInt8")) return P_I8;
    if (!strcmp(t, "UInt8") || !strcmp(t, "char")) return P_U8;
    if (!strcmp(t, "short") || !strcmp(t, "SInt16")) return P_I16;
    if (!strcmp(t, "UInt16") || !strcmp(t, "unsigned short")) return P_U16;
    if (!strcmp(t, "int") || !strcmp(t, "SInt32")) return P_I32;
    if (!strcmp(t, "UInt32") || !strcmp(t, "unsigned int") || !strcmp(t, "Type*")) return P_U32;
    if (!strcmp(t, "SInt64") || !strcmp(t, "long long")) return P_I64;
    if (!strcmp(t, "UInt64") || !strcmp(t, "unsigned long long") || !strcmp(t, "FileSize")) return P_U64;
    if (!strcmp(t, "float")) return P_F32;
    if (!strcmp(t, "double")) return P_F64;
    if (!strcmp(t, "bool")) return P_BOOL;
    return P_NONE;
}
static J *read_prim(Rd *r, int p) {
    char b[48];
    switch (p) {
    case P_I8: snprintf(b, sizeof b, "%d", (int8_t)r8(r)); break;
    case P_U8: snprintf(b, sizeof b, "%u", r8(r)); break;
    case P_I16: snprintf(b, sizeof b, "%d", (int16_t)r16(r)); break;
    case P_U16: snprintf(b, sizeof b, "%u", r16(r)); break;
    case P_I32: snprintf(b, sizeof b, "%d", (int32_t)r32(r)); break;
    case P_U32: snprintf(b, sizeof b, "%u", r32(r)); break;
    case P_I64: snprintf(b, sizeof b, "%lld", (long long)(int64_t)r64(r)); break;
    case P_U64: snprintf(b, sizeof b, "%llu", (unsigned long long)r64(r)); break;
    case P_F32: { uint32_t u = r32(r); float f; memcpy(&f, &u, 4); snprintf(b, sizeof b, "%.9g", f); break; }
    case P_F64: { uint64_t u = r64(r); double f; memcpy(&f, &u, 8); snprintf(b, sizeof b, "%.17g", f); break; }
    case P_BOOL: return jnew(r8(r) ? J_TRUE : J_FALSE);
    }
    J *j = jnew(J_NUM); j->s = fc_strdup(b); j->sl = strlen(b); return j;
}

static J *read_node(const Tree *t, int i, Rd *r, size_t base);
static J *read_vector(const Tree *t, int i, Rd *r, size_t base, int *align) {
    int ch[2]; kids(t, i, ch, 2);            /* ch[0] = Array */
    int ak[2]; kids(t, ch[0], ak, 2);         /* ak[0] = size, ak[1] = data */
    if (t->n[ch[0]].meta & 0x4000) *align = 1;
    int32_t cnt = (int32_t)r32(r);
    if (cnt < 0 || r->err) { r->err = 1; return jnew(J_ARR); }
    const TNode *sub = &t->n[ak[1]];
    int p = prim(sub->type);
    if (p == P_U8 || p == P_I8) {               /* byte arrays as blobs */
        size_t at = r->o; rskip(r, (size_t)cnt);
        J *j = r->err ? jstr("") : jstrn((const char *)r->d + at, (size_t)cnt);
        if (sub->meta & 0x4000) ralign(r, base);
        return j;
    }
    J *a = jnew(J_ARR);
    if (p != P_NONE) {
        for (int k = 0; k < cnt && !r->err; k++) jpush(a, read_prim(r, p));
        if (sub->meta & 0x4000) ralign(r, base);
        return a;
    }
    for (int k = 0; k < cnt && !r->err; k++) jpush(a, read_node(t, ak[1], r, base));
    return a;
}
static J *read_node(const Tree *t, int i, Rd *r, size_t base) {
    const TNode *n = &t->n[i];
    int align = (n->meta & 0x4000) != 0;
    J *v; int p = prim(n->type);
    int ch[256]; int nc = kids(t, i, ch, 256);
    if (p != P_NONE) v = read_prim(r, p);
    else if (!strcmp(n->type, "string")) {
        int32_t l = (int32_t)r32(r); size_t at = r->o; rskip(r, l < 0 ? 0 : (size_t)l);
        v = r->err ? jstr("") : jstrn((const char *)r->d + at, (size_t)l); align = 1;
    } else if (!strcmp(n->type, "TypelessData")) {
        int32_t l = (int32_t)r32(r); size_t at = r->o; rskip(r, l < 0 ? 0 : (size_t)l);
        v = r->err ? jstr("") : jstrn((const char *)r->d + at, (size_t)l);
    } else if (!strcmp(n->type, "pair")) {
        v = jnew(J_ARR); jpush(v, read_node(t, ch[0], r, base)); jpush(v, read_node(t, ch[1], r, base));
    } else if (nc && !strcmp(t->n[ch[0]].type, "Array")) {
        v = read_vector(t, i, r, base, &align);
    } else {
        v = jnew(J_OBJ);
        for (int k = 0; k < nc && !r->err; k++) { J *c = read_node(t, ch[k], r, base); c->k = fc_strdup(t->n[ch[k]].name); jpush(v, c); }
    }
    if (align) ralign(r, base);
    return v;
}
J *tt_read(const SFile *sf, const SObj *o) {
    if (o->type_idx < 0 || o->type_idx >= sf->ntypes) { fc_fail("object has no type"); return NULL; }
    Tree t = {sf->types[o->type_idx].nodes, sf->types[o->type_idx].nnodes};
    Rd r = {o->data.p, o->data.n, 0, sf->big_endian, 0};
    J *v = read_node(&t, 0, &r, 0);
    if (r.err) { jfree(v); fc_fail("object %lld doesn't match its type tree", (long long)o->path_id); return NULL; }
    return v;
}

static void walign(Buf *b, size_t base) { buf_align(b, 4, base); }
static int write_prim(Buf *b, int p, const J *v) {
    if (!v) return fc_fail("missing value");
    switch (p) {
    case P_I8: case P_U8: buf_byte(b, (uint8_t)jint(v)); break;
    case P_I16: case P_U16: buf_u16le(b, (uint16_t)jint(v)); break;
    case P_I32: case P_U32: buf_u32le(b, (uint32_t)jint(v)); break;
    case P_I64: buf_u64le(b, (uint64_t)strtoll(v->s ? v->s : "0", NULL, 10)); break;
    case P_U64: buf_u64le(b, (uint64_t)strtoull(v->s ? v->s : "0", NULL, 10)); break;
    case P_F32: { float f = (float)jdbl(v); uint32_t u; memcpy(&u, &f, 4); buf_u32le(b, u); break; }
    case P_F64: { double f = jdbl(v); uint64_t u; memcpy(&u, &f, 8); buf_u64le(b, u); break; }
    case P_BOOL: buf_byte(b, jtruthy(v)); break;
    }
    return 0;
}
static int write_node(const Tree *t, int i, const J *v, Buf *b, size_t base) {
    const TNode *n = &t->n[i];
    int align = (n->meta & 0x4000) != 0;
    int p = prim(n->type);
    int ch[256]; int nc = kids(t, i, ch, 256);
    if (!v) return fc_fail("value missing for field %s", n->name);
    if (p != P_NONE) { if (write_prim(b, p, v)) return -1; }
    else if (!strcmp(n->type, "string") || !strcmp(n->type, "TypelessData")) {
        buf_u32le(b, (uint32_t)v->sl); buf_put(b, v->s, v->sl);
        if (!strcmp(n->type, "string")) align = 1;
    } else if (!strcmp(n->type, "pair")) {
        if (write_node(t, ch[0], jat(v, 0), b, base) || write_node(t, ch[1], jat(v, 1), b, base)) return -1;
    } else if (nc && !strcmp(t->n[ch[0]].type, "Array")) {
        int ak[2]; kids(t, ch[0], ak, 2);
        if (t->n[ch[0]].meta & 0x4000) align = 1;
        const TNode *sub = &t->n[ak[1]]; int sp = prim(sub->type);
        if ((sp == P_U8 || sp == P_I8) && v->t == J_STR) {
            buf_u32le(b, (uint32_t)v->sl); buf_put(b, v->s, v->sl);
            if (sub->meta & 0x4000) walign(b, base);
        } else {
            buf_u32le(b, (uint32_t)v->n);
            for (int k = 0; k < v->n; k++) {
                if (sp != P_NONE) { if (write_prim(b, sp, v->a[k])) return -1; }
                else if (write_node(t, ak[1], v->a[k], b, base)) return -1;
            }
            if (sp != P_NONE && (sub->meta & 0x4000)) walign(b, base);
        }
    } else {
        for (int k = 0; k < nc; k++) if (write_node(t, ch[k], jget(v, t->n[ch[k]].name), b, base)) return -1;
    }
    if (align) walign(b, base);
    return 0;
}
int tt_write(const SFile *sf, const SObj *o, const J *v, Buf *out) {
    Tree t = {sf->types[o->type_idx].nodes, sf->types[o->type_idx].nnodes};
    out->n = 0;
    return write_node(&t, 0, v, out, 0);
}
const char *tt_name(const SFile *sf, const SObj *o) {
    /* m_Name is the first field of every named object: int32 length + bytes */
    static char name[256]; (void)sf;
    if (o->data.n < 4) return "";
    uint32_t l = rd32le(o->data.p); if (l > 255 || 4 + l > o->data.n) return "";
    memcpy(name, o->data.p + 4, l); name[l] = 0; return name;
}
