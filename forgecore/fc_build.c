/* Forge builder: legacy replacement slots and gated experimental new-unit IDs. */
#include "fc.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <dirent.h>
#include <ctype.h>
#include <stdarg.h>
int fc_summon_reskin(const char *mod, const Buf *bundle_in, Buf *out, int lz4_level, int *nparts_out);
#define JC(x) ((x) ? jclone(x) : jnew(J_NULL))

#define R "/assets/iOS/"
#define ROUTE_UNIT R "language/en/unitdata/unitlist.bytes"
#define ROUTE_SKILL R "unitdatabin/skilllist.bytes"
#define ROUTE_LANG R "language/en/stringbin/languagedata.bytes"
#define ROUTE_TRIM R "idlist/trimmingcarddata.bytes"
#define ROUTE_CARDLIST R "idlist/cardimagelist.txt"
#define ROUTE_ICONLIST_TXT R "idlist/iconimagelist.txt"
#define ROUTE_ICONS R "iconlist/iconlist"
#define ROUTE_ABIL R "unitdatabin/abilityskilllist.bytes"
#define ROUTE_THUMBS_TXT R "idlist/thumbnailimagelist.txt"
#define ROUTE_THUMBS R "thumbnaillist/thumbnaillist"
#define LIST_MAIN "content-ios/iOS/assetbundlelistbin/assetbundlelist_en.bytes"
#define LIST_FIRST "content-ios/iOS/assetbundlelistbin/assetbundlelist_first_en.bytes"
#define PARAM "content-ios/iOS/assetbundlelist_param.json"
#define CHARS "content/config/core/characters/cache-valid-characters-2.28.0.json"
#define UEXP "content/config/core/characters/unit-experience-2.28.0.json"
#define PRESENTS "content/config/catalogs/presents.json"
#define SUMMON_DIR "content/config/summons"
#define ART_CFG "content/config/banners/artwork-2.28.0.json"
#define ART_DATA "content/data/banners/artwork-2.28.0.json"
#define IMG_DIR "content/images/summons"

/* ------------------------------------------------------------------ context */
typedef struct { char *path; Buf data; } NewB;   /* asset path -> bundle bytes */
typedef struct {
    const FcBuild *cfg;
    char outdata[4096];         /* <out>/Blazing-Rebirth/BlazingData */
    J *routes;
    NewB *nb; int nnb, cnb;
    J *report;                  /* array of strings */
    int failed;
} Ctx;

static char *base_path(Ctx *c, const char *rel) {
    if (c->cfg->resolve) { char *p = c->cfg->resolve(c->cfg->resolve_ctx, rel); if (p) return p; }
    return fc_sprintf("%s/BlazingData/%s", c->cfg->base, rel);
}
static int base_read(Ctx *c, const char *rel, Buf *out) {
    char *p = base_path(c, rel); int r = file_read(p, out); free(p);
    if (r) return fc_fail("game file missing: %s", rel);
    return 0;
}
static J *base_json(Ctx *c, const char *rel) {
    Buf b = {0}; if (base_read(c, rel, &b)) return NULL;
    J *j = jparse((char *)b.p, b.n); buf_free(&b);
    if (!j) fc_fail("bad JSON in %s", rel);
    return j;
}
static const char *route_file(Ctx *c, const char *route) {
    J *r = jget(c->routes, route); return r ? jgets(r, "file", NULL) : NULL;
}
static int route_bytes(Ctx *c, const char *route, Buf *out) {
    const char *f = route_file(c, route);
    if (!f) return fc_fail("no route %s", route);
    char rel[4096]; snprintf(rel, sizeof rel, "content-ios/%s", f);
    return base_read(c, rel, out);
}
static char *outp(Ctx *c, const char *rel) { return fc_sprintf("%s/%s", c->outdata, rel); }
static int out_write(Ctx *c, const char *rel, const void *d, size_t n) { char *p = outp(c, rel); int r = file_write(p, d, n); free(p); return r; }
static int out_json(Ctx *c, const char *rel, const J *j, int indent) {
    size_t n; char *s = jdump(j, indent, &n); int r = out_write(c, rel, s, n); free(s); return r;
}
static void report(Ctx *c, const char *fmt, ...) {
    char line[1024]; va_list ap; va_start(ap, fmt); vsnprintf(line, sizeof line, fmt, ap); va_end(ap);
    jpush(c->report, jstr(line));
}
static void warn(const char *fmt, ...) {
    char line[1024]; va_list ap; va_start(ap, fmt); vsnprintf(line, sizeof line, fmt, ap); va_end(ap);
    fc_log("warning: %s", line);
}
static NewB *newb_get(Ctx *c, const char *path) {
    for (int i = 0; i < c->nnb; i++) if (!strcmp(c->nb[i].path, path)) return &c->nb[i];
    return NULL;
}
static void newb_set(Ctx *c, const char *path, Buf *data) {   /* takes ownership of data */
    NewB *e = newb_get(c, path);
    if (!e) {
        if (c->nnb == c->cnb) { c->cnb = c->cnb ? c->cnb * 2 : 16; c->nb = realloc(c->nb, sizeof(NewB) * c->cnb); }
        e = &c->nb[c->nnb++]; e->path = fc_strdup(path); memset(&e->data, 0, sizeof e->data);
    }
    buf_free(&e->data); e->data = *data; memset(data, 0, sizeof *data);
}

/* ------------------------------------------------------------------ bundle helpers */
typedef struct { Ufs u; int sfi; SFile sf; } Bundle;
static int bundle_open(const Buf *bytes, Bundle *b) {
    memset(b, 0, sizeof *b);
    if (ufs_parse(bytes->p, bytes->n, &b->u)) return -1;
    b->sfi = -1;
    for (int i = 0; i < b->u.nfiles; i++) {
        const char *n = b->u.files[i].name; size_t l = strlen(n);
        if ((l > 5 && !strcmp(n + l - 5, ".resS")) || (l > 9 && !strcmp(n + l - 9, ".resource"))) continue;
        b->sfi = i; break;
    }
    if (b->sfi < 0) return fc_fail("bundle has no serialized file");
    return sf_parse(b->u.files[b->sfi].data.p, b->u.files[b->sfi].data.n, &b->sf);
}
static void bundle_save(Bundle *b, Buf *out, int level) {
    Buf sfo = {0}; sf_write(&b->sf, &sfo);
    buf_free(&b->u.files[b->sfi].data); b->u.files[b->sfi].data = sfo;
    ufs_build(&b->u, out, level);
}
static void bundle_close(Bundle *b) { sf_free(&b->sf); ufs_free(&b->u); }
static SObj *find_class(SFile *sf, int cls) { for (int i = 0; i < sf->nobjs; i++) if (sf_class(sf, &sf->objs[i]) == cls) return &sf->objs[i]; return NULL; }
static int set_obj(SFile *sf, SObj *o, J *v) {
    Buf nb = {0}; if (tt_write(sf, o, v, &nb)) { buf_free(&nb); return -1; }
    buf_free(&o->data); o->data = nb; o->changed = 1; return 0;
}
/* TextAsset script of a single-text bundle */
static int read_text(const Buf *bundle, Buf *out) {
    Bundle b; if (bundle_open(bundle, &b)) return -1;
    SObj *o = find_class(&b.sf, 49); if (!o) { bundle_close(&b); return fc_fail("no TextAsset in bundle"); }
    J *v = tt_read(&b.sf, o); if (!v) { bundle_close(&b); return -1; }
    J *s = jget(v, "m_Script"); out->n = 0; buf_put(out, s->s, s->sl); buf_byte(out, 0); out->n--;
    jfree(v); bundle_close(&b); return 0;
}
static int replace_text(Ctx *c, const Buf *bundle, const uint8_t *d, size_t n, Buf *out) {
    Bundle b; if (bundle_open(bundle, &b)) return -1;
    SObj *o = find_class(&b.sf, 49); if (!o) { bundle_close(&b); return fc_fail("no TextAsset in bundle"); }
    J *v = tt_read(&b.sf, o); if (!v) { bundle_close(&b); return -1; }
    J *s = jget(v, "m_Script"); free(s->s); s->s = malloc(n + 1); memcpy(s->s, d, n); s->s[n] = 0; s->sl = n;
    int r = set_obj(&b.sf, o, v); jfree(v);
    if (!r) bundle_save(&b, out, c->cfg->lz4_level);
    bundle_close(&b); return r;
}
typedef struct { Buf bundle; uint32_t seed; J *j; } Table;
static int table_load(Ctx *c, const char *route, Table *t) {
    memset(t, 0, sizeof *t);
    if (route_bytes(c, route, &t->bundle)) return -1;
    Buf enc = {0}, dec = {0};
    if (read_text(&t->bundle, &enc) || obf_decode(enc.p, enc.n, &dec)) { buf_free(&enc); return -1; }
    t->seed = rd32le(enc.p); t->j = jparse((char *)dec.p, dec.n);
    buf_free(&enc); buf_free(&dec);
    return t->j ? 0 : fc_fail("bad table %s", route);
}
static int table_bundle(Ctx *c, Table *t, Buf *out) {
    size_t n; char *s = jdump(t->j, -1, &n);
    Buf enc = {0}; obf_encode((uint8_t *)s, n, t->seed, &enc); free(s);
    int r = replace_text(c, &t->bundle, enc.p, enc.n, out); buf_free(&enc); return r;
}
static void table_free(Table *t) { buf_free(&t->bundle); jfree(t->j); }

/* ------------------------------------------------------------------ id maps over table rows */
typedef struct { long long id; J *row; int is_new, forge; } Row;
typedef struct { Row *r; int n, cap; J *arr; } Rows;   /* arr = the table's array, rows indexed by id */
static void rows_init(Rows *rs, J *arr) {
    rs->arr = arr; rs->n = 0; rs->cap = arr->n + 64; rs->r = malloc(sizeof(Row) * rs->cap);
    for (int i = 0; i < arr->n; i++) { Row *x = &rs->r[rs->n++]; x->id = jgeti(arr->a[i], "id", 0); x->row = arr->a[i]; x->is_new = x->forge = 0; }
}
static Row *rows_find(Rows *rs, long long id) { for (int i = 0; i < rs->n; i++) if (rs->r[i].id == id) return &rs->r[i]; return NULL; }
static J *rows_get(Rows *rs, long long id) { Row *r = rows_find(rs, id); return r ? r->row : NULL; }
static int rows_is_forge(Rows *rs, long long id) { Row *r = rows_find(rs, id); return r && r->forge; }
/* put a row (takes ownership): replaces an existing row in place, else adds a new one (written after the originals, by id) */
static void rows_put(Rows *rs, long long id, J *row) {
    Row *r = rows_find(rs, id);
    if (r) {
        if (!r->is_new) for (int i = 0; i < rs->arr->n; i++) if (rs->arr->a[i] == r->row) { rs->arr->a[i] = row; break; }
        if (r->row != row) jfree(r->row);
        r->row = row; r->forge = 1; return;
    }
    if (rs->n == rs->cap) { rs->cap *= 2; rs->r = realloc(rs->r, sizeof(Row) * rs->cap); }
    Row *x = &rs->r[rs->n++]; x->id = id; x->row = row; x->is_new = 1; x->forge = 1;
}
static int cmp_row(const void *a, const void *b) { long long x = ((const Row *)a)->id, y = ((const Row *)b)->id; return x < y ? -1 : x > y; }
/* write the new rows into the array (sorted by id), the keep_order() of forge.py */
static void rows_finish(Rows *rs) {
    Row *nw = malloc(sizeof(Row) * (rs->n + 1)); int k = 0;
    for (int i = 0; i < rs->n; i++) if (rs->r[i].is_new) nw[k++] = rs->r[i];
    qsort(nw, k, sizeof(Row), cmp_row);
    for (int i = 0; i < k; i++) jpush(rs->arr, nw[i].row);
    free(nw); free(rs->r); rs->r = NULL; rs->n = 0;
}

/* ------------------------------------------------------------------ small helpers */
static long long pyround(double x) { return (long long)nearbyint(x); }   /* banker's rounding, like Python's round() */
static J *jobj(void) { return jnew(J_OBJ); }
static char *lang_add(J *lss, const char *prefix, int start, const char *text) {
    int n = start; char key[128];
    for (;;) {
        snprintf(key, sizeof key, "%s%d", prefix, n);
        int used = 0; for (int i = 0; i < lss->n; i++) if (!strcmp(jgets(lss->a[i], "id", ""), key)) { used = 1; break; }
        if (!used) break; n++;
    }
    J *e = jobj(); jset(e, "id", jstr(key)); jset(e, "lines", jnum_i(1)); jset(e, "languageString", jstr(text));
    jpush(lss, e);
    return fc_strdup(key);
}
static J *scale_curve(const J *c, double k) {
    J *o = jobj();
    long long s = jgeti(c, "s", 0), e = jgeti(c, "e", 0);
    jset(o, "s", jnum_i(s ? (pyround(s * k) > 1 ? pyround(s * k) : 1) : 0));
    jset(o, "e", jnum_i(e ? (pyround(e * k) > 1 ? pyround(e * k) : 1) : 0));
    jset(o, "p", JC(jget(c, "p")));
    return o;
}
static int sozai_key(const char *k) {   /* re.match(r"sozai\d?Id\d$") */
    if (strncmp(k, "sozai", 5)) return 0;
    k += 5; if (isdigit((unsigned char)*k)) k++;
    if (strncmp(k, "Id", 2)) return 0;
    k += 2; return isdigit((unsigned char)k[0]) && !k[1];
}
static int cmpstr(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }
static char **list_json(const char *dir, int *n) {
    DIR *d = opendir(dir); *n = 0; if (!d) return NULL;
    char **out = NULL; int cap = 0; struct dirent *e;
    while ((e = readdir(d))) {
        size_t l = strlen(e->d_name);
        if (l > 5 && !strcmp(e->d_name + l - 5, ".json")) {
            if (*n == cap) { cap = cap ? cap * 2 : 16; out = realloc(out, sizeof(char *) * cap); }
            out[(*n)++] = fc_sprintf("%s/%s", dir, e->d_name);
        }
    }
    closedir(d); qsort(out, *n, sizeof(char *), cmpstr); return out;
}
static J *load_json_file(const char *path) {
    Buf b = {0}; if (file_read(path, &b)) return NULL;
    J *j = jparse((char *)b.p, b.n); buf_free(&b);
    if (!j) fc_fail("bad JSON in %s", path);
    return j;
}
static char *dirname_of(const char *p) { char *d = fc_strdup(p); char *s = strrchr(d, '/'); if (s) *s = 0; return d; }

/* ------------------------------------------------------------------ art */
static Img fit_card(Img im) {
    int m = im.w > im.h ? im.w : im.h;
    if (m > 1024) { double s = 1024.0 / m; Img r = img_resize(&im, (int)pyround(im.w * s), (int)pyround(im.h * s)); img_free(&im); return r; }
    return im;
}
static Img icon_from(const Img *im) {
    int s = im->w < im->h ? im->w : im->h;
    Img c = img_crop(im, (im->w - s) / 2, (im->h - s) / 4, s, s); Img r = img_resize(&c, 128, 128); img_free(&c); return r;
}
static Img chakra_from(const Img *icon) {
    Img r = img_resize(icon, 128, 128);
    /* round mask: ellipse (8,8)-(503,503) drawn at 512 px, averaged down to 128 */
    for (int y = 0; y < 128; y++) for (int x = 0; x < 128; x++) {
        int in = 0;
        for (int sy = 0; sy < 4; sy++) for (int sx = 0; sx < 4; sx++) {
            double px = x * 4 + sx + 0.5, py = y * 4 + sy + 0.5, cx = 255.5, cy = 255.5, rr = 248.0;
            if ((px - cx) * (px - cx) + (py - cy) * (py - cy) <= rr * rr) in++;
        }
        uint8_t *a = r.px + 4 * (y * 128 + x) + 3; *a = (uint8_t)((*a * (in * 255 / 16)) / 255);
    }
    return r;
}
static Img apply_overlay(const Img *icon0, const Img *ov0) {
    Img icon = icon0->w == 128 && icon0->h == 128 ? img_crop(icon0, 0, 0, 128, 128) : img_resize(icon0, 128, 128);
    Img o = (ov0->w < 128 || ov0->h < 128) ? img_resize(ov0, 128, 128) : img_crop(ov0, 0, 0, ov0->w, ov0->h);
    Img oc = img_crop(&o, (o.w - 128) / 2, (o.h - 128) / 2, 128, 128); img_free(&o);
    for (int i = 0; i < 128 * 128; i++) {
        uint8_t *s = oc.px + 4 * i, *d = icon.px + 4 * i;
        double sa = s[3] * d[3] / 255.0 / 255.0, da = d[3] / 255.0, oa = sa + da * (1 - sa);
        for (int k = 0; k < 3; k++) d[k] = oa > 0 ? (uint8_t)((s[k] * sa + d[k] * da * (1 - sa)) / oa + 0.5) : 0;
        d[3] = (uint8_t)(oa * 255 + 0.5);
    }
    img_free(&oc); return icon;
}
/* Texture2D: put an RGBA32 image (UnityPy's set_image) */
static void tex_set(J *t, const char *name, const Img *im) {
    if (name) jset(t, "m_Name", jstr(name));
    Buf px = {0}; img_to_rgba32_flipped(im, &px);
    jset(t, "m_Width", jnum_i(im->w)); jset(t, "m_Height", jnum_i(im->h));
    if (jget(t, "m_MipMap")) jset(t, "m_MipMap", jnew(J_FALSE));
    if (jget(t, "m_MipCount")) jset(t, "m_MipCount", jnum_i(1));
    jset(t, "image data", jstrn((char *)px.p, px.n));
    jset(t, "m_CompleteImageSize", jnum_i((long long)px.n));
    jset(t, "m_TextureFormat", jnum_i(4));
    J *sd = jget(t, "m_StreamData");
    if (sd) { jset(sd, "offset", jnum_i(0)); jset(sd, "size", jnum_i(0)); jset(sd, "path", jstr("")); }
    buf_free(&px);
}
static int clone_card(Ctx *c, const Buf *donor, int card_id, const Img *im, Buf *out) {
    char name[64]; snprintf(name, sizeof name, "img_card_%05d", card_id);
    Bundle b; if (bundle_open(donor, &b)) return -1;
    for (int i = 0; i < b.sf.nobjs; i++) {
        SObj *o = &b.sf.objs[i]; int cls = sf_class(&b.sf, o);
        if (cls != 28 && cls != 142) continue;
        J *v = tt_read(&b.sf, o); if (!v) { bundle_close(&b); return -1; }
        if (cls == 28) tex_set(v, name, im);
        else {
            char bn[96]; snprintf(bn, sizeof bn, "card/%s.png", name);
            jset(v, "m_Name", jstr(bn)); jset(v, "m_AssetBundleName", jstr(bn));
            J *ct = jget(v, "m_Container"); char key[128]; snprintf(key, sizeof key, "assets/importassets/card/%s.png", name);
            for (int k = 0; k < ct->n; k++) { J *p0 = jat(ct->a[k], 0); free(p0->s); p0->s = fc_strdup(key); p0->sl = strlen(key); }
        }
        if (set_obj(&b.sf, o, v)) { jfree(v); bundle_close(&b); return -1; }
        jfree(v);
    }
    /* drop the .resS (the texture is inline now) and rename the CAB like UnityPy's clone */
    char seed[64]; snprintf(seed, sizeof seed, "card-%d", card_id); char h[33]; md5_hex(seed, strlen(seed), h);
    char *cab = fc_sprintf("CAB-%s", h);
    for (int i = 0; i < b.u.nfiles; i++) {
        size_t l = strlen(b.u.files[i].name);
        if (l > 5 && !strcmp(b.u.files[i].name + l - 5, ".resS")) {
            free(b.u.files[i].name); buf_free(&b.u.files[i].data);
            memmove(&b.u.files[i], &b.u.files[i + 1], sizeof(UfsFile) * (b.u.nfiles - i - 1)); b.u.nfiles--;
            if (b.sfi > i) b.sfi--;
            i--;
        }
    }
    free(b.u.files[b.sfi].name); b.u.files[b.sfi].name = cab;
    bundle_save(&b, out, c->cfg->lz4_level); bundle_close(&b); return 0;
}
static int64_t icon_pid(const char *name, SFile *sf) {
    char h[65]; sha256_hex(name, strlen(name), h);
    int64_t v = (int64_t)(strtoull(h + 48, NULL, 16) & 0x3fffffffffffffffULL);
    for (;;) { int clash = 0; for (int i = 0; i < sf->nobjs; i++) if (sf->objs[i].path_id == v) { clash = 1; break; } if (!clash) return v; v++; }
}
/* add or replace <prefix>XXXXX (128x128) in an icon bundle (iconlist / thumbnaillist) */
static int add_icon(Ctx *c, Bundle *b, int icon_id, const Img *src, const char *prefix) {
    (void)c;
    char name[64]; snprintf(name, sizeof name, "%s%05d", prefix, icon_id);
    Img im = img_resize(src, 128, 128);
    SObj *tmpl = NULL;
    for (int i = 0; i < b->sf.nobjs; i++) {
        SObj *o = &b->sf.objs[i]; if (sf_class(&b->sf, o) != 28) continue;
        if (!tmpl) tmpl = o;
        if (!strcmp(tt_name(&b->sf, o), name)) {
            J *v = tt_read(&b->sf, o); if (!v) { img_free(&im); return -1; }
            tex_set(v, name, &im); int r = set_obj(&b->sf, o, v); jfree(v); img_free(&im); return r;
        }
    }
    if (!tmpl) { img_free(&im); return fc_fail("icon bundle has no textures"); }
    J *tv = tt_read(&b->sf, tmpl); if (!tv) { img_free(&im); return -1; }
    int type_idx = tmpl->type_idx;
    int64_t pid = icon_pid(name, &b->sf);
    SObj *no = sf_add(&b->sf, pid, type_idx);
    tex_set(tv, name, &im); img_free(&im);
    if (set_obj(&b->sf, no, tv)) { jfree(tv); return -1; }
    jfree(tv);
    SObj *abo = find_class(&b->sf, 142); if (!abo) return fc_fail("icon bundle has no AssetBundle object");
    J *ab = tt_read(&b->sf, abo); if (!ab) return -1;
    J *pre = jget(ab, "m_PreloadTable"); J *pp = jobj(); jset(pp, "m_FileID", jnum_i(0)); jset(pp, "m_PathID", jnum_i(pid)); jpush(pre, pp);
    int idx = pre->n - 1;
    J *ct = jget(ab, "m_Container");
    const char *abn = jgets(ab, "m_Name", ""); char first[128]; snprintf(first, sizeof first, "%s", abn); char *sl = strchr(first, '/'); if (sl) *sl = 0;
    char key[512]; snprintf(key, sizeof key, "assets/importassets/%s/%s.png", first, name);
    if (ct->n) { const char *sample = jstrv(jat(ct->a[0], 0)); const char *ls = strrchr(sample, '/'); if (ls) snprintf(key, sizeof key, "%.*s/%s.png", (int)(ls - sample), sample, name); }
    J *pair = jnew(J_ARR); jpush(pair, jstr(key));
    J *info = jobj(); jset(info, "preloadIndex", jnum_i(idx)); jset(info, "preloadSize", jnum_i(1));
    J *as = jobj(); jset(as, "m_FileID", jnum_i(0)); jset(as, "m_PathID", jnum_i(pid)); jset(info, "asset", as);
    jpush(pair, info); jpush(ct, pair);
    int r = set_obj(&b->sf, abo, ab); jfree(ab); return r;
}
static int txt_has_line(const Buf *t, const char *line) {
    size_t l = strlen(line); const char *s = (const char *)t->p, *e = s + t->n;
    while (s < e) { const char *nl = memchr(s, '\n', e - s); size_t ll = (nl ? nl : e) - s; if (ll && s[ll - 1] == '\r') ll--; if (ll == l && !memcmp(s, line, l)) return 1; s = nl ? nl + 1 : e; }
    return 0;
}
static void txt_add_line(Buf *t, const char *line) {   /* cardlist.rstrip("\n") + "\n" + line + "\n" */
    if (txt_has_line(t, line)) return;
    while (t->n && t->p[t->n - 1] == '\n') t->n--;
    buf_byte(t, '\n'); buf_str(t, line); buf_byte(t, '\n');
}

/* ------------------------------------------------------------------ the character catalog (asset audit) */
static int part_ok(const J *c, const char *part) {
    if (!c) return 0;
    if (!strcmp(part, "rig")) return jtruthy(jget(jget(c, "capabilities"), "spriteAnimationReady"));
    const char *key = !strcmp(part, "cutin") ? "cutIn" : !strcmp(part, "jutsu") ? "primaryEffect" : "ultimateEffect";
    J *v = jget(jget(c, "sourceCoverage"), key);
    return v && v->t == J_STR && strcmp(v->s, "missing");
}
static J *cat_find(J *chars, long long uid) {
    J *us = jget(chars, "units");
    for (int i = 0; i < us->n; i++) if (jgeti(us->a[i], "unitId", -1) == uid) return us->a[i];
    return NULL;
}
static int cri_has_audio(Ctx *c, const char *cri) {
    char route[256]; snprintf(route, sizeof route, R "crimovie/%s.bytes", cri);
    if (!route_file(c, route)) return 0;
    Buf b = {0}, t = {0}; if (route_bytes(c, route, &b)) { fc_err[0] = 0; return 0; }
    int has = 0;
    if (!read_text(&b, &t)) for (size_t i = 0; i + 4 <= t.n; i++) if (!memcmp(t.p + i, "@SFA", 4)) { has = 1; break; }
    buf_free(&b); buf_free(&t); return has;
}

/* ------------------------------------------------------------------ main build */
#define FAIL(...) do { fc_fail(__VA_ARGS__); goto done; } while (0)
#define CHECK(x) do { if ((x)) goto done; } while (0)

int fc_build(const FcBuild *cfg) {
    Ctx C = {0}; Ctx *c = &C; c->cfg = cfg; c->report = jnew(J_ARR);
    int rc = -1;
    snprintf(c->outdata, sizeof c->outdata, "%s/Blazing-Rebirth/BlazingData", cfg->out);
    Table U = {0}, S = {0}, L = {0}, T = {0}, A = {0}, FT = {0}, BT = {0};
    Rows units = {0}, skills = {0}, trims = {0}, abil = {0}, frows = {0}, brows = {0};
    int abil_loaded = 0, f_loaded = 0, b_loaded = 0, f_changed = 0, b_changed = 0;
    J *chars = NULL, *presents = NULL, *uexp = NULL, *playable = NULL, *progression = NULL;
    J *specs = jnew(J_ARR), *made_abil = jnew(J_OBJ);
    int allow_new_ids = 0, any_new_ids = 0;
    Buf cardlist = {0}, iconlist = {0}, thumbs_txt = {0}, tmp = {0}, icons_raw = {0}, thumbs_raw = {0};
    Bundle icons = {0}, thumbs = {0}; int icons_open = 0, thumbs_open = 0, icons_changed = 0;
    char **files = NULL; int nfiles = 0;
    long long now = (long long)time(NULL);

    c->routes = base_json(c, "content-ios/ios-routes.json"); if (!c->routes) goto done;
    { char *d = fc_sprintf("%s/units", cfg->mod); files = list_json(d, &nfiles); free(d); }
    if (!nfiles) FAIL("no units/*.json in the mod");
    for (int i = 0; i < nfiles; i++) {
        J *s = load_json_file(files[i]); if (!s) goto done;
        char *dir = dirname_of(files[i]); jset(s, "_dir", jstr(dir)); free(dir);
        jpush(specs, s);
    }
    fc_log("loading game tables");
    CHECK(table_load(c, ROUTE_UNIT, &U)); rows_init(&units, jget(U.j, "datas"));
    CHECK(table_load(c, ROUTE_SKILL, &S)); rows_init(&skills, jget(S.j, "datas"));
    CHECK(table_load(c, ROUTE_LANG, &L)); J *lss = jget(jget(L.j, "dataLsd"), "lss");
    CHECK(table_load(c, ROUTE_TRIM, &T)); rows_init(&trims, jget(jget(T.j, "trimmingList"), "trimmingDatas"));
    CHECK(route_bytes(c, ROUTE_CARDLIST, &tmp) || read_text(&tmp, &cardlist));
    CHECK(route_bytes(c, ROUTE_ICONLIST_TXT, &tmp) || read_text(&tmp, &iconlist));
    CHECK(route_bytes(c, ROUTE_THUMBS_TXT, &tmp) || read_text(&tmp, &thumbs_txt));
    chars = base_json(c, CHARS); if (!chars) goto done;
    presents = base_json(c, PRESENTS); if (!presents) goto done;

    /* Explicit new-ID opt-in preserves normal slot-only behavior. */
    {
        char *p = fc_sprintf("%s/forge-mod.json", cfg->mod);
        J *m = load_json_file(p); free(p);
        allow_new_ids = m && jtruthy(jget(m, "allowNewIds")); jfree(m);
    }
    J *used_slots = jnew(J_ARR);
    for (int si = 0; si < specs->n; si++) {
        J *s = specs->a[si];
        int slot_mode = jget(s, "slot") != NULL;
        if (!slot_mode && !allow_new_ids) FAIL("%s: new ID requires allowNewIds: true in forge-mod.json", files[si]);
        if (!slot_mode) any_new_ids = 1;
        long long uid = jgeti(s, slot_mode ? "slot" : "id", 0), donor_id = jgeti(s, "donor", 0);
        jset(s, "id", jnum_i(uid));
        J *d = rows_get(&units, donor_id); if (!d) FAIL("%lld: donor %lld not found", uid, donor_id);
        J *vis = jget(s, "visuals");
        if (!part_ok(cat_find(chars, donor_id), "rig") && !jget(vis, "rig"))
            warn("donor %lld has no battle rig in this build (white boxes); set visuals.rig to a unit from 'donors'", donor_id);
        if (uid <= 0 || uid > 499999) FAIL("%lld: id must be 1..499999", uid);
        J *slot = rows_get(&units, uid);
        if (slot_mode) {
            if (!slot || !cat_find(chars, uid)) FAIL("%lld: slot must be a unit the offline server already knows", uid);
            if (uid == donor_id) FAIL("%lld: slot and donor must be different units", uid);
        } else if (slot || cat_find(chars, uid)) FAIL("%lld: new ID collides with existing game unit", uid);
        for (int k = 0; k < used_slots->n; k++)
            if (jint(used_slots->a[k]) == uid) FAIL("%lld: duplicate unit ID in mod", uid);
        jpush(used_slots, jnum_i(uid));
        J *u = jclone(d);
        jset(u, "id", jnum_i(uid));
        if (slot_mode) {
            static const char *keep[] = {"sameId", "rare", "cost", "maxLevel", "exp", "price", "mixExp", "albumId", "charaNameId", "exLimitMax"};
            for (size_t k = 0; k < sizeof keep / sizeof *keep; k++) { J *v = jget(slot, keep[k]); if (v) jset(u, keep[k], jclone(v)); }
            static const char *stat_keys[] = {"hp", "atk", "def", "defPvP", "l_hp", "l_atk", "l_def", "l_spe"};
            J *dpd = jget(d, "paramDatas"); J *dp = dpd && dpd->n ? dpd->a[0] : NULL;
            J *pds = jset(u, "paramDatas", JC(jget(slot, "paramDatas")));
            for (int b = 0; pds && b < pds->n; b++)
                for (size_t k = 0; k < sizeof stat_keys / sizeof *stat_keys; k++) { J *v = jget(dp, stat_keys[k]); if (v) jset(pds->a[b], stat_keys[k], jclone(v)); }
            if (jget(s, "displayRarity")) jset(u, "rare", jnum_i(jgeti(s, "displayRarity", 0)));
        } else {
            jset(u, "sameId", jnum_i(jgeti(s, "sameId", uid / 10)));
            jset(u, "rare", jnum_i(jgeti(s, "rarity", jgeti(d, "rare", 0))));
            jset(u, "cost", jnum_i(jgeti(s, "cost", jgeti(d, "cost", 0))));
        }
        jset(u, "attr", jnum_i(jget(s, "attribute") ? jgeti(s, "attribute", 0) : jgeti(d, "attr", 0)));
        if (jget(s, "jutsuChakra")) jset(u, "start_chakura", jnum_i(jgeti(s, "jutsuChakra", 0)));
        if (jget(s, "ultimateChakra")) jset(u, "chakuraMax", jnum_i(jgeti(s, "ultimateChakra", 0)));
        /* abilities */
        J *abs = jget(s, "abilities");
        if (abs) {
            J *ab = jnew(J_ARR);
            for (int k = 0; k < abs->n && k < 10; k++) {
                J *x = abs->a[k];
                if (x->t != J_OBJ) { jpush(ab, jnum_i(jint(x))); continue; }
                if (!abil_loaded) { CHECK(table_load(c, ROUTE_ABIL, &A)); rows_init(&abil, jget(A.j, "datas")); abil_loaded = 1; }
                J *keyo = jobj(); static const char *kk[] = {"description", "iconType", "name", "script", "secondScript"};
                for (int q = 0; q < 5; q++) { J *v = jget(x, kk[q]); jset(keyo, kk[q], v ? jclone(v) : jnew(J_NULL)); }
                char *key = jdump(keyo, -1, NULL); jfree(keyo);
                J *have = jget(made_abil, key);
                if (!have) {
                    const char *script = jgets(x, "script", ""); char cmd[128]; snprintf(cmd, sizeof cmd, "%s", script); char *colon = strchr(cmd, ':'); if (colon) *colon = 0;
                    J *tmpl = NULL;
                    for (int q = 0; q < abil.n && !tmpl; q++) { char c2[128]; snprintf(c2, sizeof c2, "%s", jgets(abil.r[q].row, "script", "")); char *cc = strchr(c2, ':'); if (cc) *cc = 0; if (!strcmp(c2, cmd)) tmpl = abil.r[q].row; }
                    if (!tmpl) tmpl = abil.r[0].row;
                    J *e = jclone(tmpl); long long aid = 90001; while (rows_get(&abil, aid)) aid++;
                    jset(e, "id", jnum_i(aid)); jset(e, "script", jstr(script));
                    J *ss = jget(x, "secondScript"); jset(e, "secondScript", ss ? (ss->t == J_STR ? jclone(ss) : jstr(jdump(ss, -1, NULL))) : jstr("0"));
                    if (jget(x, "iconType")) jset(e, "iconType", jnum_i(jgeti(x, "iconType", 0)));
                    char *nk = lang_add(lss, "ability_name_", 5000, jgets(x, "name", "")); jset(e, "nameLangId", jstr(nk)); free(nk);
                    char *dk = lang_add(lss, "ability_detail_", 5000, jgets(x, "description", "")); jset(e, "explanationLangId", jstr(dk)); free(dk);
                    rows_put(&abil, aid, e); have = jset(made_abil, key, jnum_i(aid));
                }
                free(key); jpush(ab, jnum_i(jint(have)));
            }
            while (ab->n < 10) jpush(ab, jnum_i(0));
            jset(u, "abilityID", ab);
        }
        /* stats */
        J *st = jget(s, "stats");
        double k_hp = st && jget(st, "hp") ? jdbl(jget(st, "hp")) : 1, k_atk = st && jget(st, "atk") ? jdbl(jget(st, "atk")) : 1, k_spd = st && jget(st, "speed") ? jdbl(jget(st, "speed")) : 1;
        {
            J *blocks[64]; int nbk = 0; blocks[nbk++] = u; J *pd = jget(u, "paramDatas"); for (int b = 0; pd && b < pd->n && nbk < 64; b++) blocks[nbk++] = pd->a[b];
            for (int b = 0; b < nbk; b++) {
                struct { const char *k; double f; } m[] = {{"hp", k_hp}, {"atk", k_atk}, {"l_hp", k_hp}, {"l_atk", k_atk}, {"l_spe", k_spd}};
                for (int q = 0; q < 5; q++) { J *v = jget(blocks[b], m[q].k); if (v) jset(blocks[b], m[q].k, scale_curve(v, m[q].f)); }
            }
            if (st && jget(st, "from")) {
                J *src_u = rows_get(&units, jgeti(st, "from", 0)); if (!src_u) FAIL("%lld: stats.from %lld not found", uid, jgeti(st, "from", 0));
                J *sb = jget(src_u, "paramDatas");
                J *top = jtruthy(jget(st, "maxLimitBreak")) || !jget(st, "maxLimitBreak") ? sb->a[sb->n - 1] : sb->a[0];
                double boost = jget(st, "boost") ? jdbl(jget(st, "boost")) : 1;
                static const char *ks[] = {"hp", "atk", "l_hp", "l_atk", "l_spe", "def", "l_def"};
                for (int q = 0; q < 7; q++) {
                    J *b0 = jget(sb->a[0], ks[q]); J *tp = jget(top, ks[q]);
                    if (!b0 || !tp || !jgeti(tp, "e", 0)) continue;
                    double f = jgeti(tp, "e", 0) * boost / (double)jgeti(b0, "e", 1);
                    long long sv = pyround(jgeti(b0, "s", 0) * f), ev = pyround(jgeti(tp, "e", 0) * boost);
                    J *curve = jobj(); jset(curve, "s", jnum_i(sv > 1 ? sv : 1)); jset(curve, "e", jnum_i(ev > 1 ? ev : 1)); jset(curve, "p", JC(jget(b0, "p")));
                    for (int b = 0; b < nbk; b++) if (jget(blocks[b], ks[q])) jset(blocks[b], ks[q], jclone(curve));
                    jfree(curve);
                }
            }
        }
        { char *k = lang_add(lss, "ch_name_", 5000, jgets(s, "name", "")); jset(u, "langId", jstr(k)); free(k); }
        { char *k = lang_add(lss, "ch_code_", 9000, jgets(s, "subtitle", "")); jset(u, "langId2", jstr(k)); free(k); }
        for (int k = 0; k < u->n; k++) {
            const char *key = u->a[k]->k;
            if (!strcmp(key, "evoId") || !strcmp(key, "evo2Id") || sozai_key(key)) { J *v = slot_mode ? jget(slot, key) : NULL; jset(u, key, v ? jclone(v) : jnum_i(0)); }
        }
        /* jutsu / ultimate */
        for (int kind = 0; kind < 2; kind++) {
            const char *kname = kind ? "ultimate" : "jutsu", *field = kind ? "sSkillId" : "skillId", *pvp = kind ? "sSkillIdPvP" : "skillIdPvP";
            long long base_prefix = kind ? 200000 : 100000;
            J *spec = jget(s, kname); if (!jtruthy(spec)) continue;
            J *src = rows_get(&skills, jgeti(d, field, 0)); if (!src) FAIL("%lld: donor has no %s", uid, kname);
            J *sk = jclone(src);
            long long sid = jget(spec, "id") ? jgeti(spec, "id", 0) : (uid < 100000 ? base_prefix + uid : base_prefix * 10 + uid);
            while (rows_get(&skills, sid) && !rows_is_forge(&skills, sid)) sid++;
            jset(sk, "id", jnum_i(sid));
            if (jget(spec, "name")) { char *k = lang_add(lss, "skill_name_", 5000, jgets(spec, "name", "")); jset(sk, "langNameID", jstr(k)); free(k); }
            if (jget(spec, "description")) { char *k = lang_add(lss, "skill_detail_", 5000, jgets(spec, "description", "")); jset(sk, "langInfoID", jstr(k)); jset(sk, "langEffectInfo1ID", jstr(k)); free(k); }
            static const char *sk_keys[] = {"script", "secondScript", "turn", "rangeType", "range1", "range2", "push", "circleId", "type"};
            for (int q = 0; q < 9; q++) { J *v = jget(spec, sk_keys[q]); if (v) jset(sk, sk_keys[q], jclone(v)); }
            rows_put(&skills, sid, sk); jset(u, field, jnum_i(sid)); jset(u, pvp, jnum_i(sid));
        }
        /* field and buddy skills */
        for (int kind = 0; kind < 2; kind++) {
            const char *kname = kind ? "buddySkill" : "fieldSkill";
            J *fs = jget(s, kname); if (!fs || fs->t == J_NULL) continue;
            Table *tbl = kind ? &BT : &FT; Rows *rows = kind ? &brows : &frows; int *loaded = kind ? &b_loaded : &f_loaded; int *changed = kind ? &b_changed : &f_changed;
            if (!*loaded) { CHECK(table_load(c, kind ? R "unitdatabin/buddyskilllist.bytes" : R "unitdatabin/fieldskilllist.bytes", tbl)); rows_init(rows, jget(tbl->j, "datas")); *loaded = 1; }
            const char *fields[2] = {kind ? "buddySkillId" : "fieldSkillId", kind ? NULL : "fieldSkillIdPvP"};
            long long fid;
            if (fs->t == J_OBJ && jget(fs, "reuse")) {
                fid = jgeti(fs, "reuse", 0); J *e = rows_get(rows, fid); if (!e) FAIL("%lld: %s %lld not found", uid, kname, fid);
                for (int q = 0; q < units.n; q++) {
                    if (units.r[q].forge) continue;
                    for (int f = 0; f < 2; f++) if (fields[f] && jgeti(units.r[q].row, fields[f], -1) == fid) FAIL("%lld: %s %lld is used by another unit; pick a spare one", uid, kname, fid);
                }
                static const char *fk[] = {"script", "secondScript", "state", "stateParam"};
                for (int q = 0; q < 4; q++) { J *v = jget(fs, fk[q]); if (v) jset(e, fk[q], jclone(v)); }
                *changed = 1;
            } else if (fs->t == J_OBJ) {
                J *e = jclone(rows_get(rows, jgeti(fs, "from", 0))); if (!e) FAIL("%lld: %s from not found", uid, kname);
                long long nid = (kind ? 410000 : 310000) + 90000 + uid % 10000;
                while (rows_get(rows, nid) && !rows_is_forge(rows, nid)) nid++;
                jset(e, "id", jnum_i(nid));
                static const char *fk[] = {"script", "secondScript", "state", "stateParam"};
                for (int q = 0; q < 4; q++) { J *v = jget(fs, fk[q]); if (v) jset(e, fk[q], jclone(v)); }
                if (jget(fs, "name")) { char *k = lang_add(lss, "ability_name_", 5000, jgets(fs, "name", "")); jset(e, "nameLangId", jstr(k)); free(k); }
                if (jget(fs, "description")) { char *k = lang_add(lss, "bskill_detail_", 5000, jgets(fs, "description", "")); jset(e, "explanationLangId", jstr(k)); free(k); }
                rows_put(rows, nid, e); fid = nid; *changed = 1;
            } else {
                fid = jint(fs); if (!rows_get(rows, fid)) FAIL("%lld: %s %lld not found", uid, kname, fid);
            }
            for (int f = 0; f < 2; f++) if (fields[f]) jset(u, fields[f], jnum_i(fid));
        }
        /* latent skill */
        J *lat = jget(s, "latent");
        if (jtruthy(lat)) {
            J *fu = rows_get(&units, jgeti(lat, "from", 0)); if (!fu) FAIL("%lld: latent.from not found", uid);
            long long src_id = jget(lat, "fromSkill") ? jgeti(lat, "fromSkill", 0) : (jgeti(fu, "sSkillId_2", 0) ? jgeti(fu, "sSkillId_2", 0) : jgeti(fu, "sSkillId", 0));
            J *ss = rows_get(&skills, src_id); if (!ss) FAIL("%lld: latent: skill %lld not found", uid, src_id);
            int from_latent = src_id == jgeti(fu, "sSkillId_2", 0);
            J *sk = jclone(ss);
            long long sid = jget(lat, "id") ? jgeti(lat, "id", 0) : (uid < 100000 ? 800000 + uid : 8000000 + uid);
            while (rows_get(&skills, sid) && !rows_is_forge(&skills, sid)) sid++;
            jset(sk, "id", jnum_i(sid));
            if (jget(lat, "name")) { char *k = lang_add(lss, "skill_name_", 5000, jgets(lat, "name", "")); jset(sk, "langNameID", jstr(k)); free(k); }
            if (jget(lat, "description")) { char *k = lang_add(lss, "skill_detail_", 5000, jgets(lat, "description", "")); jset(sk, "langInfoID", jstr(k)); jset(sk, "langEffectInfo1ID", jstr(k)); free(k); }
            static const char *sk_keys[] = {"script", "secondScript", "turn", "rangeType", "range1", "range2", "push", "circleId", "type"};
            for (int q = 0; q < 9; q++) { J *v = jget(lat, sk_keys[q]); if (v) jset(sk, sk_keys[q], jclone(v)); }
            long long bone = jgeti(sk, "skillBoneId", 0);
            rows_put(&skills, sid, sk);
            jset(u, "sSkillId_2", jnum_i(sid)); jset(u, "sSkillIdPvP_2", jnum_i(sid));
            jset(u, "boostSSkillId_2", jnum_i(0)); jset(u, "boostSSkillIdPvP_2", jnum_i(0));
            jset(u, "criId_2", jget(lat, "video") ? jclone(jget(lat, "video")) : jclone(jget(fu, from_latent ? "criId_2" : "criId")));
            jset(u, "sSkillVoice_2", jget(lat, "voice") ? jclone(jget(lat, "voice")) : jclone(jget(fu, from_latent ? "sSkillVoice_2" : "sSkillVoice")));
            jset(u, "standbySSkillId_2", jnum_i(jgeti(fu, "standbySSkillId_2", 0) ? jgeti(fu, "standbySSkillId_2", 0) : 30001));
            char eff[128]; snprintf(eff, sizeof eff, R "sprite/effect/%lld_effect", bone);
            if (!route_file(c, eff)) warn("%lld: latent animation %lld is missing in this build", uid, bone);
        }
        /* battle visuals */
        long long rig_id = vis && jget(vis, "rig") ? jgeti(vis, "rig", 0) : donor_id;
        if (rig_id != donor_id) {
            J *rr = rows_get(&units, rig_id); static const char *rk[] = {"boneId", "standBoneId", "attackBoneId", "imageId", "charaMoveType"};
            for (int q = 0; rr && q < 5; q++) { J *v = jget(rr, rk[q]); if (v) jset(u, rk[q], jclone(v)); }
        }
        if (!part_ok(cat_find(chars, rig_id), "rig")) warn("%lld: battle rig from %lld is missing in this build -> white boxes in battle. Set visuals.rig (see 'donors').", uid, rig_id);
        long long cut_id = vis && jget(vis, "cutin") ? jgeti(vis, "cutin", 0) : (vis && jget(vis, "rig") ? rig_id : donor_id);
        { J *cu = rows_get(&units, cut_id); if (cu) jset(u, "cutInImageId", JC(jget(cu, "cutInImageId"))); }
        if (!part_ok(cat_find(chars, cut_id), "cutin")) warn("%lld: cut-in from %lld is missing in this build", uid, cut_id);
        for (int kind = 0; kind < 2; kind++) {
            const char *kname = kind ? "ultimate" : "jutsu", *field = kind ? "sSkillId" : "skillId", *pvp = kind ? "sSkillIdPvP" : "skillIdPvP";
            long long base_prefix = kind ? 200000 : 100000;
            char ek[64]; snprintf(ek, sizeof ek, "%sEffect", kname);
            long long fx_id = vis && jget(vis, ek) ? jgeti(vis, ek, 0) : donor_id;
            if (!jgeti(u, field, 0)) continue;
            if (fx_id != donor_id) {
                J *fxu = rows_get(&units, fx_id); J *src_fx = fxu && jgeti(fxu, field, 0) ? rows_get(&skills, jgeti(fxu, field, 0)) : NULL;
                if (!src_fx) FAIL("%lld: %lld has no %s to borrow an effect from", uid, fx_id, kname);
                long long cur_id = jgeti(u, field, 0); J *cur = rows_get(&skills, cur_id);
                if (!rows_is_forge(&skills, cur_id)) {
                    cur = jclone(cur); long long sid = uid < 100000 ? base_prefix + uid : base_prefix * 10 + uid;
                    while (rows_get(&skills, sid) && !rows_is_forge(&skills, sid)) sid++;
                    jset(cur, "id", jnum_i(sid)); rows_put(&skills, sid, cur); jset(u, field, jnum_i(sid)); jset(u, pvp, jnum_i(sid));
                }
                jset(cur, "skillBoneId", JC(jget(src_fx, "skillBoneId")));
                if (kind) jset(u, "criId", JC(jget(fxu, "criId")));
            }
            if (!part_ok(cat_find(chars, fx_id), kname)) warn("%lld: %s effect from %lld is missing in this build", uid, kname, fx_id);
        }
        if (vis && jget(vis, "ultimateVideo")) {
            J *v = jget(vis, "ultimateVideo");
            int none = v->t == J_NULL || (v->t == J_NUM && jint(v) == 0) || (v->t == J_STR && (!strcmp(v->s, "0") || !strcmp(v->s, "none")));
            if (none) jset(u, "criId", jstr("0"));
            else { J *vu = rows_get(&units, jint(v)); if (vu) jset(u, "criId", JC(jget(vu, "criId"))); }
        }
        {
            char both[512]; snprintf(both, sizeof both, "%s %s", jstrv(jget(u, "criId")), jstrv(jget(u, "criId_2")));
            for (char *p = strstr(both, "cri_"); p; p = strstr(p + 4, "cri_")) {
                char name[64]; int k = 0; while (k < 63 && (isalnum((unsigned char)p[k]) || p[k] == '_')) { name[k] = p[k]; k++; } name[k] = 0;
                if (cri_has_audio(c, name)) warn("%lld: ultimate video %s has its own audio track; videos like that have crashed the ultimate on device. Set visuals.ultimateVideo to 0 (no video) or another unit's id.", uid, name);
            }
        }
        /* art */
        J *art = jget(s, "art");
        long long card_id = jget(s, "cardImageId") ? jgeti(s, "cardImageId", 0) : 30000 + uid % 10000;
        const char *sdir = jgets(s, "_dir", ".");
        if (art && jget(art, "card")) {
            char line[64]; snprintf(line, sizeof line, "%lld,img_card_%05lld", card_id, card_id);
            for (int q = 0; q < units.n; q++) if (!units.r[q].forge && jgeti(units.r[q].row, "cardImageId", -1) == card_id) FAIL("%lld: cardImageId %lld is already used by the game; set another in the unit file", uid, card_id);
            { char pre[32]; snprintf(pre, sizeof pre, "%lld,", card_id);
              Buf base_list = {0}; CHECK(route_bytes(c, ROUTE_CARDLIST, &tmp) || read_text(&tmp, &base_list));
              const char *q = (const char *)base_list.p; size_t pl = strlen(pre); int clash = 0;
              while (q && *q) { if (!strncmp(q, pre, pl)) { clash = 1; break; } q = strchr(q, '\n'); if (q) q++; }
              buf_free(&base_list); if (clash) FAIL("%lld: cardImageId %lld is already used by the game; set another in the unit file", uid, card_id); }
            char *ap = fc_sprintf("%s/%s", sdir, jgets(art, "card", "")); Img im; int r = img_load_file(ap, &im); free(ap); if (r) goto done;
            im = fit_card(im);
            char donor_route[128]; snprintf(donor_route, sizeof donor_route, R "card/img_card_%05lld.png", jgeti(d, "cardImageId", 0));
            Buf donor_card = {0}, card = {0};
            if (route_bytes(c, donor_route, &donor_card) || clone_card(c, &donor_card, (int)card_id, &im, &card)) { img_free(&im); buf_free(&donor_card); goto done; }
            buf_free(&donor_card);
            char path[128]; snprintf(path, sizeof path, "card/img_card_%05lld.png", card_id); newb_set(c, path, &card);
            txt_add_line(&cardlist, line);
            jset(u, "cardImageId", jnum_i(card_id));
            Img icon;
            if (jget(art, "icon")) { char *ip = fc_sprintf("%s/%s", sdir, jgets(art, "icon", "")); r = img_load_file(ip, &icon); free(ip); if (r) { img_free(&im); goto done; } }
            else icon = icon_from(&im);
            if (jget(art, "iconOverlay")) {
                Img ov; char *op = fc_sprintf("%s/%s", sdir, jgets(art, "iconOverlay", "")); r = img_load_file(op, &ov); free(op);
                if (!r) { Img x = apply_overlay(&icon, &ov); img_free(&icon); img_free(&ov); icon = x; }
            }
            if (!icons_open) { CHECK(route_bytes(c, ROUTE_ICONS, &icons_raw) || bundle_open(&icons_raw, &icons)); icons_open = 1; }
            CHECK(add_icon(c, &icons, (int)card_id, &icon, "img_icon_")); icons_changed = 1;
            snprintf(line, sizeof line, "%lld,img_icon_%05lld", card_id, card_id); txt_add_line(&iconlist, line);
            jset(u, "iconImageId", jnum_i(card_id));
            if (!thumbs_open) { CHECK(route_bytes(c, ROUTE_THUMBS, &thumbs_raw) || bundle_open(&thumbs_raw, &thumbs)); thumbs_open = 1; }
            Img ch;
            if (jget(art, "chakraIcon")) { char *cp = fc_sprintf("%s/%s", sdir, jgets(art, "chakraIcon", "")); Img t0; r = img_load_file(cp, &t0); free(cp); if (r) goto done; ch = img_resize(&t0, 128, 128); img_free(&t0); }
            else ch = chakra_from(&icon);
            CHECK(add_icon(c, &thumbs, (int)card_id, &ch, "img_chakraicon_"));
            snprintf(line, sizeof line, "%lld,img_chakraicon_%05lld", card_id, card_id); txt_add_line(&thumbs_txt, line);
            img_free(&ch); img_free(&icon); img_free(&im);
        }
        rows_put(&units, uid, u);
        J *tsrc = rows_get(&trims, donor_id); if (!tsrc) tsrc = trims.r[0].row;
        J *t = jclone(tsrc); jset(t, "id", jnum_i(uid));
        J *tr = jget(s, "trimming");
        static const char *views[] = {"home", "gasha", "panel"};
        for (int q = 0; q < 3; q++) { J *ov = jget(tr, views[q]); J *tv = jget(t, views[q]); if (ov && tv) for (int z = 0; z < ov->n; z++) jset(tv, ov->a[z]->k, jclone(ov->a[z])); }
        rows_put(&trims, uid, t);
        if (!slot_mode) {
            if (!uexp) {
                uexp = base_json(c, UEXP); if (!uexp) goto done;
                playable = base_json(c, "pack/playableunits.json"); if (!playable) goto done;
                progression = base_json(c, "pack/progressionunits.json"); if (!progression) goto done;
            }
            J *donor_cat = cat_find(chars, donor_id);
            if (!donor_cat) FAIL("%lld: donor %lld is missing from character catalog", uid, donor_id);
            J *cat = jclone(donor_cat);
            jset(cat, "unitId", jnum_i(uid));
            jset(cat, "rare", JC(jget(u, "rare"))); jset(cat, "sameId", JC(jget(u, "sameId")));
            jset(cat, "cardImageId", JC(jget(u, "cardImageId")));
            jset(cat, "iconImageId", JC(jget(u, "iconImageId")));
            jset(cat, "primarySkillId", JC(jget(u, "skillId")));
            jset(cat, "ultimateSkillId", JC(jget(u, "sSkillId")));
            J *cs = jget(cat, "skills");
            if (cs) {
                J *v = jget(cs, "primary"); if (v) jset(v, "id", JC(jget(u, "skillId")));
                v = jget(cs, "ultimate"); if (v) jset(v, "id", JC(jget(u, "sSkillId")));
            }
            J *identity = jget(cat, "identity");
            if (identity) {
                jset(identity, "name", jstr(jgets(s, "name", "")));
                jset(identity, "subtitle", jstr(jgets(s, "subtitle", "")));
                jset(identity, "langId", JC(jget(u, "langId")));
                jset(identity, "subtitleLangId", JC(jget(u, "langId2")));
                jset(identity, "rarity", JC(jget(u, "rare")));
                jset(identity, "attribute", JC(jget(u, "attr")));
                jset(identity, "cost", JC(jget(u, "cost")));
            }
            J *pr = jget(cat, "progression");
            if (pr) {
                const char *keys[] = {"blazingEvolution", "evolution", "reversion"};
                for (int i = 0; i < 3; i++) {
                    J *v = jobj(); jset(v, "materials", jnew(J_ARR));
                    jset(v, "targetUnitId", jnum_i(0)); jset(pr, keys[i], v);
                }
            }
            J *management = jget(cat, "managementAssets");
            J *trim_ref = jget(management, "cardTrimming");
            if (trim_ref) jset(trim_ref, "id", jnum_i(uid));
            jset(cat, "defaultTeamEligible", jnew(J_FALSE));
            jpush(jget(chars, "units"), cat);
            char key[64], donor_key[64];
            snprintf(key, sizeof key, "%lld", uid);
            snprintf(donor_key, sizeof donor_key, "%lld", donor_id);
            J *experience_units = jget(uexp, "units");
            if (experience_units) jset(experience_units, key, JC(jget(experience_units, donor_key)));
            if (playable && playable->t == J_ARR) jpush(playable, jnum_i(uid));
            if (progression && progression->t == J_OBJ) {
                J *old = jget(progression, donor_key);
                jset(progression, key, old ? jclone(old) : jnum_i(0));
            }
        }
        if (!jget(s, "gift") || jtruthy(jget(s, "gift"))) {
            char key[64]; snprintf(key, sizeof key, "forge-unit-%lld-v1", uid);
            J *gr = jget(presents, "grants");
            for (int q = gr->n - 1; q >= 0; q--) if (!strcmp(jgets(gr->a[q], "sourceKey", ""), key)) { jfree(gr->a[q]); memmove(gr->a + q, gr->a + q + 1, sizeof(J *) * (gr->n - q - 1)); gr->n--; }
            J *g = jobj(); const char *nm = jgets(s, "name", ""), *sub = jgets(s, "subtitle", "");
            char title[256], detail[512]; snprintf(title, sizeof title, "New ally: %s", nm); snprintf(detail, sizeof detail, "%s (%s) has joined you.", nm, sub);
            jset(g, "sourceKey", jstr(key)); jset(g, "messageTitle", jstr(title)); jset(g, "messageDetail", jstr(jgets(s, "giftMessage", detail)));
            const char *nk[] = {"type", "num", "charaId", "charaLevel", "skillLevel", "abilityCount", "luck", "plusS", "plusA", "plusD", "plusSp", "exlimitCount", "grade", "pflag", "gTicketId", "id", "sortNo"};
            long long nv[] = {1, 1, uid, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 200};
            for (int q = 0; q < 17; q++) jset(g, nk[q], jnum_i(nv[q]));
            jset(g, "expiresAt", jstr("2099-12-31T23:59:59Z")); jpush(gr, g);
        }
        report(c, "%s %lld  %s - %s  (donor %lld, card %lld, jutsu %lld, ultimate %lld%s)", slot_mode ? "slot" : "new-ID", uid, jgets(s, "name", ""), jgets(s, "subtitle", ""), donor_id,
               jgeti(u, "cardImageId", 0), jgeti(u, "skillId", 0), jgeti(u, "sSkillId", 0),
               jgeti(u, "sSkillId_2", 0) ? (snprintf(fc_err, sizeof fc_err, ", latent %lld", jgeti(u, "sSkillId_2", 0)), fc_err) : "");
        fc_err[0] = 0;
    }
    jfree(used_slots);

    /* extra Present Box gifts: gifts.json = [{"charaId", "count", "title", "detail", "version"}] */
    {
        char *gp = fc_sprintf("%s/gifts.json", cfg->mod);
        if (file_exists(gp)) {
            J *gifts = load_json_file(gp); if (!gifts) { free(gp); goto done; }
            J *gr = jget(presents, "grants");
            for (int gi = 0; gi < gifts->n; gi++) {
                J *g = gifts->a[gi]; long long cid = jgeti(g, "charaId", 0);
                if (!rows_get(&units, cid)) { jfree(gifts); free(gp); FAIL("gifts.json: %lld is not a unit or material in the game", cid); }
                long long cnt = jgeti(g, "count", 1), ver = jgeti(g, "version", 1);
                for (long long n = 0; n < cnt; n++) {
                    char key[96]; snprintf(key, sizeof key, "forge-gift-%lld-%lld-v%lld", cid, n + 1, ver);
                    for (int q = gr->n - 1; q >= 0; q--) if (!strcmp(jgets(gr->a[q], "sourceKey", ""), key)) { jfree(gr->a[q]); memmove(gr->a + q, gr->a + q + 1, sizeof(J *) * (gr->n - q - 1)); gr->n--; }
                    J *e = jobj(); jset(e, "sourceKey", jstr(key)); jset(e, "messageTitle", jstr(jgets(g, "title", "Gift"))); jset(e, "messageDetail", jstr(jgets(g, "detail", "")));
                    const char *nk[] = {"type", "num", "charaId", "charaLevel", "skillLevel", "abilityCount", "luck", "plusS", "plusA", "plusD", "plusSp", "exlimitCount", "grade", "pflag", "gTicketId", "id", "sortNo"};
                    long long nv[] = {1, 1, cid, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 150};
                    for (int q = 0; q < 17; q++) jset(e, nk[q], jnum_i(nv[q]));
                    jset(e, "expiresAt", jstr("2099-12-31T23:59:59Z")); jpush(gr, e);
                }
                report(c, "gift %lldx %lld (%s)", cnt, cid, jgets(g, "title", ""));
            }
            jfree(gifts);
        }
        free(gp);
    }

    /* tables back into their bundles */
    fc_log("writing tables");
    rows_finish(&units); rows_finish(&skills); rows_finish(&trims);
    if (any_new_ids) {
        J *count = jget(chars, "counts");
        if (count) {
            if (jget(count, "unitRecords")) jset(count, "unitRecords", jnum_i(jget(U.j, "datas")->n));
            if (jget(count, "playerForms")) jset(count, "playerForms", jnum_i(jget(chars, "units")->n));
        }
    }
    { Buf o = {0}; CHECK(table_bundle(c, &U, &o)); newb_set(c, "language/en/unitdata/unitlist.bytes", &o); }
    { Buf o = {0}; CHECK(table_bundle(c, &S, &o)); newb_set(c, "unitdatabin/skilllist.bytes", &o); }
    if (f_changed) { rows_finish(&frows); Buf o = {0}; CHECK(table_bundle(c, &FT, &o)); newb_set(c, "unitdatabin/fieldskilllist.bytes", &o); }
    if (b_changed) { rows_finish(&brows); Buf o = {0}; CHECK(table_bundle(c, &BT, &o)); newb_set(c, "unitdatabin/buddyskilllist.bytes", &o); }
    if (abil_loaded) { rows_finish(&abil); Buf o = {0}; CHECK(table_bundle(c, &A, &o)); newb_set(c, "unitdatabin/abilityskilllist.bytes", &o); }
    { Buf o = {0}; CHECK(table_bundle(c, &L, &o)); newb_set(c, "language/en/stringbin/languagedata.bytes", &o); }
    { Buf o = {0}; CHECK(table_bundle(c, &T, &o)); newb_set(c, "idlist/trimmingcarddata.bytes", &o); }
    { Buf src = {0}, o = {0}; CHECK(route_bytes(c, ROUTE_CARDLIST, &src) || replace_text(c, &src, cardlist.p, cardlist.n, &o)); buf_free(&src); newb_set(c, "idlist/cardimagelist.txt", &o); }
    { Buf src = {0}, o = {0}; CHECK(route_bytes(c, ROUTE_ICONLIST_TXT, &src) || replace_text(c, &src, iconlist.p, iconlist.n, &o)); buf_free(&src); newb_set(c, "idlist/iconimagelist.txt", &o); }
    if (icons_changed) { Buf o = {0}; bundle_save(&icons, &o, cfg->lz4_level); newb_set(c, "iconlist/iconlist", &o); }
    if (thumbs_open) {
        Buf src = {0}, o = {0}; CHECK(route_bytes(c, ROUTE_THUMBS_TXT, &src) || replace_text(c, &src, thumbs_txt.p, thumbs_txt.n, &o)); buf_free(&src);
        newb_set(c, "idlist/thumbnailimagelist.txt", &o);
        Buf t2 = {0}; bundle_save(&thumbs, &t2, cfg->lz4_level); newb_set(c, "thumbnaillist/thumbnaillist", &t2);
    }

    /*
     * Mirror new iOS unit and skill data into the Android recovery pack used
     * by the offline backend. This does not disable compiled engine allowlists.
     */
    if (any_new_ids) {
        J *pack = base_json(c, "pack/manifest.json"); if (!pack) goto done;
        const char *android_routes[] = {
            "/assets/Android/language/en/unitdata/unitlist.bytes",
            "/assets/Android/unitdatabin/skilllist.bytes"
        };
        Table *ios_tables[] = {&U, &S};
        for (int k = 0; k < 2; k++) {
            J *pentry = NULL, *pfiles = jget(pack, "files");
            for (int q = 0; pfiles && q < pfiles->n; q++)
                if (!strcmp(jgets(pfiles->a[q], "route", ""), android_routes[k])) {
                    pentry = pfiles->a[q]; break;
                }
            if (!pentry) FAIL("missing Android recovery route: %s", android_routes[k]);
            const char *asset = jgets(pentry, "asset", NULL);
            if (!asset) FAIL("Android recovery route has no asset");
            char rel[1024]; snprintf(rel, sizeof rel, "pack/%s", asset);
            Table at = {0}; CHECK(base_read(c, rel, &at.bundle));
            Buf encoded = {0};
            if (read_text(&at.bundle, &encoded) || encoded.n < 4) {
                buf_free(&encoded); table_free(&at); goto done;
            }
            at.seed = rd32le(encoded.p); buf_free(&encoded);
            at.j = jclone(ios_tables[k]->j);
            Buf rewritten = {0}; int rr = table_bundle(c, &at, &rewritten);
            table_free(&at); if (rr) goto done;
            CHECK(out_write(c, rel, rewritten.p, rewritten.n));
            char sh[65]; sha256_hex(rewritten.p, rewritten.n, sh);
            jset(pentry, "bytes", jnum_i((long long)rewritten.n));
            jset(pentry, "sha256", jstr(sh));
            buf_free(&rewritten);
        }
        CHECK(out_json(c, "pack/manifest.json", pack, 2));
        CHECK(out_json(c, "pack/playableunits.json", playable, 1));
        CHECK(out_json(c, "pack/progressionunits.json", progression, 1));
        CHECK(out_json(c, CHARS, chars, 1));
        CHECK(out_json(c, UEXP, uexp, 1));
        jfree(pack);
        fc_log("experimental new-ID tables generated; executable-side validation NOT verified");
    }

    /* summon animation re-skin: mod/summon/summon.json paints new part art into the atlas cells */
    {
        char *sp = fc_sprintf("%s/summon/summon.json", cfg->mod);
        if (file_exists(sp) && cfg->summon != 0) {
            J *sc = load_json_file(sp); if (!sc) { free(sp); goto done; }
            int on = cfg->summon == 1 || !jget(sc, "enabled") || jtruthy(jget(sc, "enabled"));
            if (on) {
                fc_log("re-skinning the summon animation");
                char route[512]; snprintf(route, sizeof route, R "%s", jgets(sc, "bundle", ""));
                Buf src = {0}, o = {0}; int nparts = 0;
                if (route_bytes(c, route, &src) || fc_summon_reskin(cfg->mod, &src, &o, cfg->lz4_level, &nparts)) { buf_free(&src); jfree(sc); free(sp); goto done; }
                buf_free(&src); newb_set(c, jgets(sc, "bundle", ""), &o);
                Buf names = {0}; J *tx = jget(sc, "textures"); for (int q = 0; tx && q < tx->n; q++) buf_printf(&names, q ? ", %s" : "%s", tx->a[q]->k); buf_byte(&names, 0);
                report(c, "summon animation: %d part(s) re-skinned in %s", nparts, (char *)names.p); buf_free(&names);
            }
            jfree(sc);
        }
        free(sp);
    }

    /* iOS routes + asset lists */
    fc_log("writing asset lists");
    {
        J *routes = jclone(c->routes);
        typedef struct { char *path; size_t size; uint32_t crc; char md5[33]; } Meta;
        Meta *meta = calloc(c->nnb + 1, sizeof(Meta));
        for (int i = 0; i < c->nnb; i++) {
            NewB *e = &c->nb[i];
            char rel[1024]; snprintf(rel, sizeof rel, "content-ios/mods/%s", e->path);
            CHECK(out_write(c, rel, e->data.p, e->data.n));
            uint32_t crc; CHECK(ufs_crc(e->data.p, e->data.n, &crc));
            char sh[65]; sha256_hex(e->data.p, e->data.n, sh);
            J *r = jobj(); char *f = fc_sprintf("mods/%s", e->path); jset(r, "file", jstr(f)); free(f);
            jset(r, "bytes", jnum_i((long long)e->data.n)); jset(r, "sha256", jstr(sh)); char crcs[16]; snprintf(crcs, sizeof crcs, "%08X", crc); jset(r, "crc", jstr(crcs));
            char route[1024]; snprintf(route, sizeof route, R "%s", e->path); jset(routes, route, r);
            meta[i].path = e->path; meta[i].size = e->data.n; meta[i].crc = crc; md5_hex(e->data.p, e->data.n, meta[i].md5);
        }
        long long list_rows[2] = {0, 0};
        const char *lists[2] = {LIST_MAIN, LIST_FIRST};
        for (int li = 0; li < 2; li++) {
            Buf lb = {0}, enc = {0}, dec = {0};
            CHECK(base_read(c, lists[li], &lb)); CHECK(read_text(&lb, &enc) || obf_decode(enc.p, enc.n, &dec));
            uint32_t seed = rd32le(enc.p); J *rows = jparse((char *)dec.p, dec.n); buf_free(&dec); buf_free(&enc);
            if (!rows) { buf_free(&lb); goto done; }
            int *seen = calloc(c->nnb + 1, sizeof(int));
            for (int q = 0; q < rows->n; q++) {
                const char *ap = jgets(rows->a[q], "asset_path", "");
                for (int i = 0; i < c->nnb; i++) if (!strcmp(meta[i].path, ap)) {
                    jset(rows->a[q], "hash", jstr(meta[i].md5)); jset(rows->a[q], "crc", jnum_i(meta[i].crc));
                    jset(rows->a[q], "size", jnum_i((long long)meta[i].size)); jset(rows->a[q], "utc", jnum_i(now)); seen[i] = 1;
                }
            }
            if (li == 0) for (int i = 0; i < c->nnb; i++) if (!seen[i]) {
                J *e = jobj(); const char *nm = strrchr(meta[i].path, '/');
                jset(e, "asset_path", jstr(meta[i].path)); jset(e, "asset_name", jstr(nm ? nm + 1 : meta[i].path)); jset(e, "hash", jstr(meta[i].md5));
                jset(e, "version", jnum_i(0)); jset(e, "crc", jnum_i(meta[i].crc)); jset(e, "utc", jnum_i(now)); jset(e, "size", jnum_i((long long)meta[i].size)); jset(e, "auto_retry", jnum_i(1));
                jpush(rows, e);
            }
            free(seen); list_rows[li] = rows->n;
            size_t n; char *s = jdump(rows, -1, &n); Buf enc2 = {0}, ob = {0}; obf_encode((uint8_t *)s, n, seed, &enc2); free(s); jfree(rows);
            if (replace_text(c, &lb, enc2.p, enc2.n, &ob)) { buf_free(&lb); buf_free(&enc2); goto done; }
            buf_free(&lb); buf_free(&enc2);
            CHECK(out_write(c, lists[li], ob.p, ob.n));
            uint32_t crc; CHECK(ufs_crc(ob.p, ob.n, &crc)); char sh[65]; sha256_hex(ob.p, ob.n, sh);
            J *r = jobj(); jset(r, "file", jstr(lists[li] + strlen("content-ios/"))); jset(r, "bytes", jnum_i((long long)ob.n)); jset(r, "sha256", jstr(sh));
            char crcs[16]; snprintf(crcs, sizeof crcs, "%08X", crc); jset(r, "crc", jstr(crcs));
            char route[1024]; snprintf(route, sizeof route, R "%s", lists[li] + strlen("content-ios/iOS/")); jset(routes, route, r);
            buf_free(&ob);
        }
        J *param = base_json(c, PARAM); if (!param) goto done;
        J *cache = jget(param, "assetBundleCache");
        long long cache_n;
        for (int i = 0; i < c->nnb; i++) {
            J *e = NULL; for (int q = 0; q < cache->n; q++) if (!strcmp(jgets(cache->a[q], "url", ""), meta[i].path)) { e = cache->a[q]; break; }
            char crcs[16]; snprintf(crcs, sizeof crcs, "%08X", meta[i].crc);
            if (e) { jset(e, "hash", jstr(meta[i].md5)); jset(e, "crc", jstr(crcs)); }
            else { e = jobj(); jset(e, "url", jstr(meta[i].path)); jset(e, "hash", jstr(meta[i].md5)); jset(e, "crc", jstr(crcs)); jpush(cache, e); }
        }
        for (int li = 0; li < 2; li++) {
            const char *path = lists[li] + strlen("content-ios/iOS/");
            for (int q = 0; q < cache->n; q++) if (!strcmp(jgets(cache->a[q], "url", ""), path)) {
                Buf lb = {0}; char *p = outp(c, lists[li]); file_read(p, &lb); free(p);
                char h[33]; md5_hex(lb.p, lb.n, h); buf_free(&lb);
                char route[1024]; snprintf(route, sizeof route, R "%s", path);
                jset(cache->a[q], "hash", jstr(h)); jset(cache->a[q], "crc", JC(jget(jget(routes, route), "crc")));
            }
        }
        size_t pn; char *ps = jdump(param, -1, &pn);
        /* Python: separators (",", ":") with ensure_ascii=False */
        CHECK(out_write(c, PARAM, ps, pn));
        { char sh[65]; sha256_hex(ps, pn, sh); J *r = jobj(); jset(r, "file", jstr("iOS/assetbundlelist_param.json")); jset(r, "bytes", jnum_i((long long)pn)); jset(r, "sha256", jstr(sh)); jset(r, "crc", jnew(J_NULL)); jset(routes, R "assetbundlelist_param.json", r); }
        cache_n = cache->n; free(ps); jfree(param);
        size_t rn; char *rs = jdump(routes, 0, &rn); CHECK(out_write(c, "content-ios/ios-routes.json", rs, rn));
        char rsh[65]; sha256_hex(rs, rn, rsh); free(rs);
        J *ic = base_json(c, "content-ios/ios-content.json"); if (!ic) goto done;
        J *icr = jget(ic, "routes"); jset(icr, "sha256", jstr(rsh)); jset(icr, "count", jnum_i(routes->n));
        const char *rels[3] = {LIST_MAIN, LIST_FIRST, PARAM};
        J *icf = jget(ic, "files");
        for (int q = 0; q < 3; q++) {
            const char *k = rels[q] + strlen("content-ios/"); J *f = jget(icf, k); if (!f) continue;
            Buf fb = {0}; char *p = outp(c, rels[q]); file_read(p, &fb); free(p);
            char sh[65]; sha256_hex(fb.p, fb.n, sh); jset(f, "sha256", jstr(sh)); jset(f, "bytes", jnum_i((long long)fb.n)); buf_free(&fb);
            if (jget(f, "rows")) jset(f, "rows", jnum_i(q < 2 ? list_rows[q] : cache_n));
        }
        J *forge = jget(ic, "forge"); if (!forge) forge = jset(ic, "forge", jobj());
        J *ul = jnew(J_ARR); for (int i = 0; i < specs->n; i++) jpush(ul, jnum_i(jgeti(specs->a[i], "id", 0))); jset(forge, "units", ul);
        CHECK(out_json(c, "content-ios/ios-content.json", ic, 1)); jfree(ic);
        jfree(routes); free(meta);
    }
    CHECK(out_json(c, PRESENTS, presents, 1));

    /* banners */
    {
        J *rot = base_json(c, SUMMON_DIR "/rotation.json"), *proj = base_json(c, SUMMON_DIR "/summons.json"), *art = base_json(c, ART_CFG);
        if (!rot || !proj || !art) goto done;
        int nbanners = 0;
        char *bd = fc_sprintf("%s/banners", cfg->mod); int nbf = 0; char **bfiles = list_json(bd, &nbf); free(bd);
        for (int bi = 0; bi < nbf; bi++) {
            J *spec = load_json_file(bfiles[bi]); if (!spec) goto done;
            char *sdir = dirname_of(bfiles[bi]);
            long long bid = jgeti(spec, "id", 0); char bids[32]; snprintf(bids, sizeof bids, "%lld", bid);
            if (jget(jget(rot, "rareBanners"), bids)) FAIL("banner %lld: id already used", bid);
            const char *flds[2] = {"name", "ticker"};
            for (int q = 0; q < 2; q++) { const char *t = jgets(spec, flds[q], ""); if (strpbrk(t, ":!")) FAIL("banner %lld: %s '%s' contains ':' or '!', which stops the offline server from starting", bid, flds[q], t); }
            char cf[32]; snprintf(cf, sizeof cf, "%lld", jgeti(spec, "copyFrom", 60001));
            const char *srcrel = jgets(jget(rot, "rareBanners"), cf, NULL); if (!srcrel) FAIL("banner %lld: copyFrom %s not found", bid, cf);
            char *sp = fc_sprintf(SUMMON_DIR "/%s", srcrel); J *src = base_json(c, sp); free(sp); if (!src) goto done;
            const char *base_pool_id = jgets(spec, "basePool", jgets(src, "poolId", ""));
            const char *bprel = jgets(jget(rot, "pools"), base_pool_id, NULL); if (!bprel) FAIL("banner %lld: pool %s not found", bid, base_pool_id);
            char *bpp = fc_sprintf(SUMMON_DIR "/%s", bprel); J *base_pool = base_json(c, bpp); free(bpp); if (!base_pool) goto done;
            char *pool_id = jget(spec, "poolId") ? fc_strdup(jgets(spec, "poolId", "")) : fc_sprintf("forge-%lld", bid);
            J *entries = jclone(jget(base_pool, "entries"));
            J *featured = jget(spec, "featured"); long long fw = jgeti(spec, "featuredWeight", 100);
            for (int q = 0; featured && q < featured->n; q++) {
                long long fid = jint(featured->a[q]); J *e = NULL;
                for (int z = 0; z < entries->n; z++) if (jgeti(entries->a[z], "unitId", -1) == fid) { e = entries->a[z]; break; }
                if (!e) FAIL("banner %lld: featured unit %lld is not in the '%s' pool. The offline server only summons eligible 3-5 star base forms; use a slot that is already in the pool.", bid, fid, base_pool_id);
                jset(e, "weight", jnum_i(fw));
            }
            J *tiers = jget(src, "rateTiers");
            for (int z = 0; z < entries->n; z++) {
                long long r = jgeti(entries->a[z], "rarity", 0); int ok = 0;
                for (int t = 0; t < tiers->n; t++) if (jgeti(tiers->a[t], "rarity", -1) == r) ok = 1;
                if (!ok) FAIL("banner %lld: pool has rarity %lld with no rate tier", bid, r);
            }
            J *pool = jobj(); jset(pool, "schemaVersion", jnum_i(1)); jset(pool, "poolId", jstr(pool_id)); jset(pool, "policyAuthority", jstr("private-server-generated")); jset(pool, "entries", jclone(entries));
            char *poolrel = fc_sprintf(SUMMON_DIR "/pools/%s.json", pool_id); CHECK(out_json(c, poolrel, pool, 2)); free(poolrel); jfree(pool);
            /* artwork: 750x400 front, 367x118 top cut from the lower middle of the front */
            J *sart = jget(spec, "art");
            char *fp = fc_sprintf("%s/%s", sdir, jgets(sart, "front", "")); Img front0; int r = img_load_file(fp, &front0); free(fp); if (r) goto done;
            Img top0;
            if (jget(sart, "top")) { char *tp = fc_sprintf("%s/%s", sdir, jgets(sart, "top", "")); r = img_load_file(tp, &top0); free(tp); if (r) goto done; }
            else { int w = front0.w, h = front0.h, bw = (int)(w * 0.68), bh = (int)(bw / (367.0 / 118)); int x0 = (w - bw) / 2, y0 = (int)(h * 0.93) - bh; if (y0 < 0) y0 = 0;
                   Img cr = img_crop(&front0, x0, y0, bw, bh); top0 = img_resize(&cr, 367, 118); img_free(&cr); }
            Img front = img_resize(&front0, 750, 400), top = img_resize(&top0, 367, 118); img_free(&front0); img_free(&top0);
            long long ids[2];
            J *abn = jget(art, "banners");
            for (int q = 0; q < 2; q++) {
                char fk[32]; snprintf(fk, sizeof fk, "%sBannerId", q ? "top" : "front");
                long long aid = jgeti(spec, fk, 0);
                if (!aid) for (aid = 1900; aid < 1999; aid++) { int used = 0; for (int z = 0; z < abn->n; z++) if (jgeti(abn->a[z], "bannerId", -1) == aid) used = 1; if (!used) break; }
                char fname[96]; snprintf(fname, sizeof fname, "forge-%lld-%s.png", bid, q ? "top" : "front");
                Buf png = {0}; img_png(q ? &top : &front, q, &png);
                char *ip = fc_sprintf(IMG_DIR "/%s", fname); CHECK(out_write(c, ip, png.p, png.n)); free(ip);
                char crcs[16]; snprintf(crcs, sizeof crcs, "%08X", crc32_of(png.p, png.n)); buf_free(&png);
                J *e = jobj(); jset(e, "bannerDivision", jnum_i(q ? 9 : 8)); jset(e, "bannerId", jnum_i(aid)); jset(e, "bannerImage", jstr(fname)); jset(e, "crc", jstr(crcs));
                jset(e, "endsAt", JC(jget(src, "endsAt"))); jset(e, "missionStageOpenId", jnum_i(0)); jset(e, "popup", jstr("")); jset(e, "scene", jstr(""));
                jset(e, "sortNo", jnum_i(aid)); jset(e, "startsAt", JC(jget(src, "startsAt"))); jset(e, "summary", jstr(jgets(spec, "name", "")));
                jpush(abn, jclone(e)); jpush(jget(proj, "banners"), e); ids[q] = aid;
            }
            img_free(&front); img_free(&top);
            /* featured faces: ours first, then the copied banner's, five at most */
            long long feat5[5]; int nf = 0;
            for (int q = 0; featured && q < featured->n && nf < 5; q++) { long long v = jint(featured->a[q]); int dup = 0; for (int z = 0; z < nf; z++) if (feat5[z] == v) dup = 1; if (!dup) feat5[nf++] = v; }
            { char tmpc[256]; snprintf(tmpc, sizeof tmpc, "%s", jgets(src, "bannerCharaIds", "")); for (char *t = strtok(tmpc, ","); t && nf < 5; t = strtok(NULL, ",")) { long long v = atoll(t); int dup = 0; for (int z = 0; z < nf; z++) if (feat5[z] == v) dup = 1; if (!dup) feat5[nf++] = v; } }
            for (int q = 0; q < nf; q++) { int ok = 0; for (int z = 0; z < entries->n; z++) if (jgeti(entries->a[z], "unitId", -1) == feat5[q]) ok = 1; if (!ok) FAIL("banner %lld: featured %lld not in pool", bid, feat5[q]); }
            J *banner = jclone(src);
            Buf fs = {0}; for (int q = 0; q < nf; q++) buf_printf(&fs, q ? ",%lld" : "%lld", feat5[q]); buf_byte(&fs, 0);
            jset(banner, "gashaRareId", jnum_i(bid)); jset(banner, "name", jstr(jgets(spec, "name", "")));
            jset(banner, "ticker", jstr(jgets(spec, "ticker", jgets(spec, "name", "")))); jset(banner, "bannerCharaIds", jstr((char *)fs.p)); buf_free(&fs);
            jset(banner, "poolId", jstr(pool_id)); jset(banner, "sortNo", jnum_i(bid)); jset(banner, "frontBannerId", jnum_i(ids[0])); jset(banner, "topBannerId", jnum_i(ids[1]));
            int stepup = jgeti(src, "gashaRareType", 0) == 5;
            jset(banner, "guaranteedRarity", jnum_i(stepup ? jgeti(spec, "guaranteedRarity", jgeti(src, "guaranteedRarity", 0)) : jgeti(src, "guaranteedRarity", 0)));
            jset(banner, "startsAt", JC(jget(src, "startsAt"))); jset(banner, "endsAt", JC(jget(src, "endsAt")));
            const char *extra[3] = {"onceConsumeNum", "continuityConsumeNum", "confirmMessage"};
            for (int q = 0; q < 3; q++) if (jget(spec, extra[q])) jset(banner, extra[q], JC(jget(spec, extra[q])));
            char *brel = fc_sprintf(SUMMON_DIR "/banners/%lld.json", bid); CHECK(out_json(c, brel, banner, 2)); free(brel);
            { char *v = fc_sprintf("banners/%lld.json", bid); jset(jget(rot, "rareBanners"), bids, jstr(v)); free(v); }
            { char *v = fc_sprintf("pools/%s.json", pool_id); jset(jget(rot, "pools"), pool_id, jstr(v)); free(v); }
            /* projection: banner without poolId, plus the pool entries (keys sorted), whole object sorted by key */
            J *pb = jobj();
            J *pool_sorted = jnew(J_ARR);
            for (int z = 0; z < entries->n; z++) jpush(pool_sorted, jclone(entries->a[z]));
            jset(banner, "pool", pool_sorted); jdel(banner, "poolId");
            /* sort keys (dict(sorted(...))) for the banner and each entry */
            for (int pass = 0; pass < 2; pass++) {
                J *objs[1024]; int no = 0; if (pass == 0) objs[no++] = banner; else for (int z = 0; z < pool_sorted->n && no < 1024; z++) objs[no++] = pool_sorted->a[z];
                for (int oi = 0; oi < no; oi++) { J *o = objs[oi];
                    for (int a = 1; a < o->n; a++) for (int b2 = a; b2 > 0 && strcmp(o->a[b2 - 1]->k, o->a[b2]->k) > 0; b2--) { J *t = o->a[b2]; o->a[b2] = o->a[b2 - 1]; o->a[b2 - 1] = t; } }
            }
            jfree(pb); jpush(jget(proj, "rareBanners"), banner);
            /* report the real rate */
            double tier_total = 0; for (int t = 0; t < tiers->n; t++) tier_total += jdbl(jget(tiers->a[t], "weight"));
            for (int q = 0; featured && q < featured->n; q++) {
                long long fid = jint(featured->a[q]); J *e = NULL;
                for (int z = 0; z < entries->n; z++) if (jgeti(entries->a[z], "unitId", -1) == fid) e = entries->a[z];
                long long rr = jgeti(e, "rarity", 0); double tw = 0, sw = 0;
                for (int t = 0; t < tiers->n; t++) if (jgeti(tiers->a[t], "rarity", -1) == rr) tw = jdbl(jget(tiers->a[t], "weight"));
                for (int z = 0; z < entries->n; z++) if (jgeti(entries->a[z], "rarity", -1) == rr) sw += jdbl(jget(entries->a[z], "weight"));
                double pr = tw / tier_total * jdbl(jget(e, "weight")) / sw;
                report(c, "banner %lld '%s': featured %lld (%lld*) at %.1f%% per pull", bid, jgets(spec, "name", ""), fid, rr, pr * 100);
            }
            nbanners++;
            jfree(entries); jfree(base_pool); jfree(src); jfree(spec); free(sdir); free(pool_id);
        }
        for (int i = 0; i < nbf; i++) free(bfiles[i]); free(bfiles);
        const char *sf_files[4] = {SUMMON_DIR "/rotation.json", SUMMON_DIR "/summons.json", ART_CFG, ART_DATA};
        if (!nbanners) {
            for (int q = 0; q < 4; q++) { Buf b = {0}; CHECK(base_read(c, sf_files[q], &b)); CHECK(out_write(c, sf_files[q], b.p, b.n)); buf_free(&b); }
        } else {
            CHECK(out_json(c, SUMMON_DIR "/rotation.json", rot, 2)); CHECK(out_json(c, SUMMON_DIR "/summons.json", proj, 1));
            CHECK(out_json(c, ART_CFG, art, 1)); CHECK(out_json(c, ART_DATA, art, 1));
        }
        jfree(rot); jfree(proj); jfree(art);
    }

    /* blazing-data.json + engine expectation */
    {
        J *bdj = base_json(c, "blazing-data.json"); if (!bdj) goto done;
        Buf ic = {0}; char *icp = outp(c, "content-ios/ios-content.json"); file_read(icp, &ic); free(icp);
        char sh[65]; sha256_hex(ic.p, ic.n, sh); buf_free(&ic);
        J *ios = jget(bdj, "iosContent"); jset(ios, "manifestSha256", jstr(sh));
        J *routes_now = NULL; { Buf rb = {0}; char *rp = outp(c, "content-ios/ios-routes.json"); file_read(rp, &rb); free(rp); routes_now = jparse((char *)rb.p, rb.n); buf_free(&rb); }
        jset(ios, "routes", jnum_i(routes_now ? routes_now->n : 0)); jfree(routes_now);
        Buf pm = {0};
        if (any_new_ids) {
            char *path = outp(c, "pack/manifest.json");
            int rr = file_read(path, &pm); free(path); CHECK(rr);
        } else CHECK(base_read(c, "pack/manifest.json", &pm));
        sha256_hex(pm.p, pm.n, sh); buf_free(&pm);
        jset(jget(bdj, "pack"), "manifestSha256", jstr(sh));
        char *what = fc_sprintf("%s + Blazing Forge mod", jgets(bdj, "what", "")); jset(bdj, "what", jstr(what)); free(what);
        J *fo = jobj(); J *ul = jnew(J_ARR); for (int i = 0; i < specs->n; i++) jpush(ul, jnum_i(jgeti(specs->a[i], "id", 0)));
        jset(fo, "units", ul); jset(fo, "builtUtc", jnum_i(now)); jset(fo, "mode", jstr(any_new_ids ? "new-ids-experimental" : "slots")); jset(bdj, "forge", fo);
        CHECK(out_json(c, "blazing-data.json", bdj, 1)); jfree(bdj);
        J *eng = load_json_file(cfg->engine_json); if (!eng) goto done;
        Buf bdb = {0}; char *bdp = outp(c, "blazing-data.json"); file_read(bdp, &bdb); free(bdp); sha256_hex(bdb.p, bdb.n, sh); buf_free(&bdb);
        jset(jget(eng, "expect"), "sha256", jstr(sh));
        J *inst = jget(eng, "install"); if (!inst) inst = jset(eng, "install", jobj());
        jset(inst, "zips", jstr("{home}/Documents/BlazingForge/zips"));
        J *ef = jobj(); J *ul2 = jnew(J_ARR); for (int i = 0; i < specs->n; i++) jpush(ul2, jnum_i(jgeti(specs->a[i], "id", 0)));
        jset(ef, "units", ul2); jset(ef, "builtUtc", jnum_i(now)); jset(eng, "forge", ef);
        char *ep = fc_sprintf("%s/Blazing-Rebirth/BlazingEngine/BlazingEngine.json", cfg->out);
        size_t en; char *es = jdump(eng, 1, &en); CHECK(file_write(ep, es, en)); free(es); free(ep); jfree(eng);
    }
    for (int i = 0; i < c->report->n; i++) fc_log("  %s", jstrv(c->report->a[i]));
    rc = 0;
done:
    if (rc && !fc_err[0]) fc_fail("build failed");
    table_free(&U); table_free(&S); table_free(&L); table_free(&T);
    if (abil_loaded) table_free(&A); if (f_loaded) table_free(&FT); if (b_loaded) table_free(&BT);
    if (icons_open) bundle_close(&icons); if (thumbs_open) bundle_close(&thumbs);
    buf_free(&cardlist); buf_free(&iconlist); buf_free(&thumbs_txt); buf_free(&tmp); buf_free(&icons_raw); buf_free(&thumbs_raw);
    jfree(chars); jfree(presents); jfree(uexp); jfree(playable); jfree(progression);
    jfree(specs); jfree(made_abil); jfree(c->routes); jfree(c->report);
    for (int i = 0; i < c->nnb; i++) { free(c->nb[i].path); buf_free(&c->nb[i].data); } free(c->nb);
    for (int i = 0; i < nfiles; i++) free(files[i]); free(files);
    return rc;
}
