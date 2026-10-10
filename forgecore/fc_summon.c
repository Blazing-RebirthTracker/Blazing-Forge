/* Summon animation re-skin (port of forge/lib/summon.py): paint new part art into the SpriteStudio atlas cells. */
#include "fc.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

static long long rnd(double x) { return (long long)nearbyint(x); }
static Img img_copy(const Img *a) { Img o = img_new(a->w, a->h); memcpy(o.px, a->px, (size_t)a->w * a->h * 4); return o; }
/* PIL rotate(angle, expand=True) for multiples of 90 (counter-clockwise) */
static Img rot90k(const Img *a, int deg) {
    int k = ((deg / 90) % 4 + 4) % 4;
    if (!k) return img_copy(a);
    Img o = img_new(k % 2 ? a->h : a->w, k % 2 ? a->w : a->h);
    for (int y = 0; y < a->h; y++) for (int x = 0; x < a->w; x++) {
        int nx, ny;
        if (k == 1) { nx = y; ny = a->w - 1 - x; }
        else if (k == 2) { nx = a->w - 1 - x; ny = a->h - 1 - y; }
        else { nx = a->h - 1 - y; ny = x; }
        memcpy(o.px + 4 * ((size_t)ny * o.w + nx), a->px + 4 * ((size_t)y * a->w + x), 4);
    }
    return o;
}
static Img flip_lr(const Img *a) {
    Img o = img_new(a->w, a->h);
    for (int y = 0; y < a->h; y++) for (int x = 0; x < a->w; x++) memcpy(o.px + 4 * ((size_t)y * a->w + (a->w - 1 - x)), a->px + 4 * ((size_t)y * a->w + x), 4);
    return o;
}
static int bbox_alpha(const Img *a, int thr, int bb[4]) {   /* alpha > thr; returns 0 if empty */
    int x0 = a->w, y0 = a->h, x1 = -1, y1 = -1;
    for (int y = 0; y < a->h; y++) for (int x = 0; x < a->w; x++) if (a->px[4 * ((size_t)y * a->w + x) + 3] > thr) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return 0;
    bb[0] = x0; bb[1] = y0; bb[2] = x1 + 1; bb[3] = y1 + 1; return 1;
}
static void paste(Img *dst, const Img *src, int x, int y) {   /* replace pixels (PIL paste without mask) */
    for (int r = 0; r < src->h; r++) for (int c = 0; c < src->w; c++) {
        int dx = x + c, dy = y + r; if (dx < 0 || dy < 0 || dx >= dst->w || dy >= dst->h) continue;
        memcpy(dst->px + 4 * ((size_t)dy * dst->w + dx), src->px + 4 * ((size_t)r * src->w + c), 4);
    }
}
static void composite(Img *dst, const Img *src, int x, int y) {  /* alpha_composite */
    for (int r = 0; r < src->h; r++) for (int c = 0; c < src->w; c++) {
        int dx = x + c, dy = y + r; if (dx < 0 || dy < 0 || dx >= dst->w || dy >= dst->h) continue;
        uint8_t *s = src->px + 4 * ((size_t)r * src->w + c), *d = dst->px + 4 * ((size_t)dy * dst->w + dx);
        double sa = s[3] / 255.0, da = d[3] / 255.0, oa = sa + da * (1 - sa);
        for (int k = 0; k < 3; k++) d[k] = oa > 0 ? (uint8_t)((s[k] * sa + d[k] * da * (1 - sa)) / oa + 0.5) : 0;
        d[3] = (uint8_t)(oa * 255 + 0.5);
    }
}
static Img shift(const Img *im, double dx, double dy) {
    Img o = img_new(im->w, im->h); composite(&o, im, (int)rnd(dx * im->w), (int)rnd(dy * im->h)); return o;
}
static Img fit(const Img *src, int w, int h, const char *mode, int rotate) {
    Img im = rotate ? rot90k(src, rotate) : img_copy(src);
    for (size_t i = 0; i < (size_t)im.w * im.h; i++) if (im.px[4 * i + 3] < 8) im.px[4 * i + 3] = 0;
    int bb[4]; if (bbox_alpha(&im, 0, bb)) { Img c = img_crop(&im, bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]); img_free(&im); im = c; }
    Img out;
    if (!mode || !strcmp(mode, "stretch")) out = img_resize(&im, w, h);
    else if (!strcmp(mode, "width")) {
        double s = (double)w / im.w; int nh = (int)rnd(im.h * s); if (nh < 1) nh = 1;
        Img r = img_resize(&im, w, nh); out = img_new(w, h); Img c = img_crop(&r, 0, 0, w, nh < h ? nh : h); composite(&out, &c, 0, 0); img_free(&c); img_free(&r);
    } else if (!strcmp(mode, "cover")) {
        double s = fmax((double)w / im.w, (double)h / im.h); int nw = (int)rnd(im.w * s), nh = (int)rnd(im.h * s); if (nw < w) nw = w; if (nh < h) nh = h;
        Img r = img_resize(&im, nw, nh); out = img_crop(&r, (nw - w) / 2, (nh - h) / 2, w, h); img_free(&r);
    } else {   /* contain, bottom-centred */
        double s = fmin((double)w / im.w, (double)h / im.h); int nw = (int)rnd(im.w * s), nh = (int)rnd(im.h * s); if (nw < 1) nw = 1; if (nh < 1) nh = 1;
        Img r = img_resize(&im, nw, nh); out = img_new(w, h); composite(&out, &r, (w - nw) / 2, h - nh); img_free(&r);
    }
    img_free(&im); return out;
}
static void rgb_to_hls(double r, double g, double b, double *h, double *l, double *s) {
    double mx = fmax(r, fmax(g, b)), mn = fmin(r, fmin(g, b)); *l = (mx + mn) / 2;
    if (mx == mn) { *h = 0; *s = 0; return; }
    *s = *l <= 0.5 ? (mx - mn) / (mx + mn) : (mx - mn) / (2.0 - mx - mn);
    *h = 0;
}
static void recolor_grey(Img *im, const int rgb[3]) {
    for (size_t i = 0; i < (size_t)im->w * im->h; i++) {
        uint8_t *p = im->px + 4 * i; if (!p[3]) continue;
        double h, l, s; rgb_to_hls(p[0] / 255.0, p[1] / 255.0, p[2] / 255.0, &h, &l, &s);
        if (s < 0.22 && l > 0.25 && l < 0.92) { double k = 0.35 + l * 0.8; for (int c = 0; c < 3; c++) { int v = (int)(rgb[c] * k); p[c] = v > 255 ? 255 : v; } }
    }
}
static void tint(Img *im, const int rgb[3]) {
    for (size_t i = 0; i < (size_t)im->w * im->h; i++) {
        uint8_t *p = im->px + 4 * i; if (!p[3]) continue;
        double lum = (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000.0 / 255;
        if (lum < 0.12) continue;
        double k = 0.45 + lum * 0.9; for (int c = 0; c < 3; c++) { int v = (int)(rgb[c] * k); p[c] = v > 255 ? 255 : v; }
    }
}
static void match_bottom(Img *nw, const Img *orig) {
    int last_any = -1;
    for (int y = 0; y < orig->h; y++) for (int x = 0; x < orig->w; x++) if (orig->px[4 * ((size_t)y * orig->w + x) + 3] > 24) last_any = y;
    if (last_any < 0) return;
    for (int x = 0; x < nw->w && x < orig->w; x++) {
        int last = -1; for (int y = 0; y < orig->h; y++) if (orig->px[4 * ((size_t)y * orig->w + x) + 3] > 24) last = y;
        if (last < 0) last = last_any;
        for (int y = last + 1; y < nw->h; y++) nw->px[4 * ((size_t)y * nw->w + x) + 3] = 0;
    }
}
/* grey-level helpers for shadows */
static float *alpha_f(const Img *a) { float *f = malloc(sizeof(float) * a->w * a->h); for (size_t i = 0; i < (size_t)a->w * a->h; i++) f[i] = a->px[4 * i + 3]; return f; }
static void max_filter(float *f, int w, int h, int size) {
    int r = size / 2; float *t = malloc(sizeof(float) * w * h);
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { float m = 0; for (int k = -r; k <= r; k++) { int xx = x + k; if (xx >= 0 && xx < w && f[y * w + xx] > m) m = f[y * w + xx]; } t[y * w + x] = m; }
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { float m = 0; for (int k = -r; k <= r; k++) { int yy = y + k; if (yy >= 0 && yy < h && t[yy * w + x] > m) m = t[yy * w + x]; } f[y * w + x] = m; }
    free(t);
}
static void box_blur(float *f, int w, int h, int r) {
    float *t = malloc(sizeof(float) * w * h);
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { double s = 0; for (int k = -r; k <= r; k++) { int xx = x + k; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; s += f[y * w + xx]; } t[y * w + x] = (float)(s / (2 * r + 1)); }
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { double s = 0; for (int k = -r; k <= r; k++) { int yy = y + k; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; s += t[yy * w + x]; } f[y * w + x] = (float)(s / (2 * r + 1)); }
    free(t);
}
static Img xf(const Img *a, int r, int flip) { Img o = rot90k(a, r); if (flip) { Img f = flip_lr(&o); img_free(&o); return f; } return o; }
static Img make_shadow(const Img *orig_src, const Img *new_src, const Img *orig_shadow) {
    int sb[4]; if (!bbox_alpha(orig_shadow, 24, sb)) return img_copy(orig_shadow);
    int sbw = sb[2] - sb[0], sbh = sb[3] - sb[1];
    double best = -1; int bt_r = 0, bt_f = 0, bob[4] = {0, 0, 1, 1};
    for (int r = 0; r < 360; r += 90) for (int fl = 0; fl < 2; fl++) {
        Img o = xf(orig_src, r, fl); int ob[4];
        if (!bbox_alpha(&o, 24, ob)) { img_free(&o); continue; }
        Img c = img_crop(&o, ob[0], ob[1], ob[2] - ob[0], ob[3] - ob[1]); Img rz = img_resize(&c, sbw, sbh);
        long inter = 0, uni = 0;
        for (int y = 0; y < sbh; y++) for (int x = 0; x < sbw; x++) {
            int A = rz.px[4 * (y * sbw + x) + 3] > 24, B = orig_shadow->px[4 * ((size_t)(sb[1] + y) * orig_shadow->w + sb[0] + x) + 3] > 24;
            inter += A && B; uni += A || B;
        }
        double iou = (double)inter / (uni > 1 ? uni : 1);
        if (iou > best) { best = iou; bt_r = r; bt_f = fl; memcpy(bob, ob, sizeof bob); }
        img_free(&c); img_free(&rz); img_free(&o);
    }
    double sx = (double)sbw / (bob[2] - bob[0]), sy = (double)sbh / (bob[3] - bob[1]);
    Img n = xf(new_src, bt_r, bt_f);
    int nw = (int)rnd(n.w * sx), nh = (int)rnd(n.h * sy); if (nw < 1) nw = 1; if (nh < 1) nh = 1;
    Img nr = img_resize(&n, nw, nh); img_free(&n);
    int W = orig_shadow->w, H = orig_shadow->h;
    float *sil = calloc((size_t)W * H, sizeof(float));
    int ox = (int)rnd(sb[0] - bob[0] * sx), oy = (int)rnd(sb[1] - bob[1] * sy);
    for (int y = 0; y < nh; y++) for (int x = 0; x < nw; x++) { int X = ox + x, Y = oy + y; if (X >= 0 && Y >= 0 && X < W && Y < H) sil[Y * W + X] = nr.px[4 * (y * nw + x) + 3] / 255.0f; }
    img_free(&nr);
    float *sa = alpha_f(orig_shadow), *env = alpha_f(orig_shadow);
    float smax = 0; for (int i = 0; i < W * H; i++) if (sa[i] > smax) smax = sa[i];
    max_filter(env, W, H, 21);
    for (int k = 0; k < 3; k++) box_blur(env, W, H, 5);   /* ~ GaussianBlur(8) */
    double col[3] = {0, 0, 0}, wsum = 0;
    for (int i = 0; i < W * H; i++) if (sa[i] > 24) { for (int k = 0; k < 3; k++) col[k] += orig_shadow->px[4 * i + k] * sa[i]; wsum += sa[i]; }
    Img out = img_new(W, H);
    for (int i = 0; i < W * H; i++) {
        for (int k = 0; k < 3; k++) out.px[4 * i + k] = (uint8_t)(wsum > 0 ? col[k] / wsum : 0);
        double e = env[i] / (smax > 1 ? smax : 1); e = e < 0 ? 0 : e > 1 ? 1 : e;
        double a = sil[i] * e * smax; out.px[4 * i + 3] = (uint8_t)(a < 0 ? 0 : a > 255 ? 255 : a);
    }
    free(sil); free(sa); free(env); return out;
}

/* ---------------------------------------------------------------- the bundle side */
typedef struct { char *tex, *cell; Img before, after; } Painted;

static J *find_controller_from(SFile *sf, const char *texname, SObj **obj, int *map_id, int start) {
    /* MonoScript class names */
    for (int i = start; i < sf->nobjs; i++) {
        SObj *o = &sf->objs[i]; if (sf_class(sf, o) != 114) continue;
        J *v = tt_read(sf, o); if (!v) { fc_err[0] = 0; continue; }
        J *scr = jget(v, "m_Script"); long long spid = jgeti(scr, "m_PathID", 0);
        const char *cls = NULL;
        for (int k = 0; k < sf->nobjs; k++) if (sf->objs[k].path_id == spid && sf_class(sf, &sf->objs[k]) == 115) {
            J *ms = tt_read(sf, &sf->objs[k]); if (ms) { static char nm[128]; snprintf(nm, sizeof nm, "%s", jgets(ms, "m_ClassName", "")); cls = nm; jfree(ms); } break;
        }
        if (!cls || strcmp(cls, "SSController")) { jfree(v); continue; }
        J *ct = jget(v, "cellTextures"); int mid = -1;
        for (int t = 0; ct && t < ct->n; t++) {
            long long pid = jgeti(ct->a[t], "m_PathID", 0);
            for (int k = 0; k < sf->nobjs; k++) if (sf->objs[k].path_id == pid && sf_class(sf, &sf->objs[k]) == 28) { if (!strcmp(tt_name(sf, &sf->objs[k]), texname)) mid = t; break; }
            if (mid >= 0) break;
        }
        if (mid < 0) { jfree(v); continue; }
        *obj = o; *map_id = mid; return v;
    }
    if (!start) fc_fail("no SpriteStudio controller uses %s", texname);
    return NULL;
}
static J *find_controller(SFile *sf, const char *texname, SObj **obj, int *map_id) { return find_controller_from(sf, texname, obj, map_id, 0); }
static J *cell_of(J *ctl, int mid, const char *name) {
    J *cl = jget(ctl, "cellList");
    for (int i = 0; cl && i < cl->n; i++) if (jgeti(cl->a[i], "mapId", -1) == mid && !strcmp(jgets(cl->a[i], "name", ""), name)) return cl->a[i];
    return NULL;
}
static int tex_image(Ufs *u, SFile *sf, SObj *o, J **tv, Img *im) {
    J *t = tt_read(sf, o); if (!t) return -1;
    int w = (int)jgeti(t, "m_Width", 0), h = (int)jgeti(t, "m_Height", 0), fmt = (int)jgeti(t, "m_TextureFormat", 0);
    J *idata = jget(t, "image data"); const uint8_t *src = (const uint8_t *)idata->s; size_t n = idata->sl;
    Buf stream = {0};
    J *sd = jget(t, "m_StreamData");
    if ((!n) && sd && jgeti(sd, "size", 0)) {
        const char *path = jgets(sd, "path", ""); const char *base = strrchr(path, '/'); base = base ? base + 1 : path;
        for (int i = 0; i < u->nfiles; i++) if (!strcmp(u->files[i].name, base)) {
            size_t off = (size_t)jgeti(sd, "offset", 0), sz = (size_t)jgeti(sd, "size", 0);
            if (off + sz <= u->files[i].data.n) buf_put(&stream, u->files[i].data.p + off, sz);
        }
        src = stream.p; n = stream.n;
    }
    Img a = img_new(w, h);
    if (fmt == 13 && n >= (size_t)w * h * 2) {          /* RGBA4444: 16-bit LE, R in the top nibble */
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            const uint8_t *p = src + 2 * ((size_t)(h - 1 - y) * w + x); uint16_t v = (uint16_t)(p[0] | p[1] << 8);
            uint8_t *d = a.px + 4 * ((size_t)y * w + x);
            d[0] = ((v >> 12) & 15) * 17; d[1] = ((v >> 8) & 15) * 17; d[2] = ((v >> 4) & 15) * 17; d[3] = (v & 15) * 17;
        }
    } else if (fmt == 4 && n >= (size_t)w * h * 4) { img_free(&a); a = img_from_rgba32_flipped(src, w, h); }
    else { buf_free(&stream); jfree(t); img_free(&a); return fc_fail("atlas texture format %d isn't supported", fmt); }
    buf_free(&stream); *tv = t; *im = a; return 0;
}

int fc_summon_reskin(const char *mod, const Buf *bundle_in, Buf *out, int lz4_level, int *nparts_out);
int fc_summon_reskin(const char *mod, const Buf *bundle_in, Buf *out, int lz4_level, int *nparts_out) {
    char *sp = fc_sprintf("%s/summon/summon.json", mod); char *sdir = fc_sprintf("%s/summon", mod);
    Buf cb = {0}; if (file_read(sp, &cb)) { free(sp); free(sdir); return -1; }
    J *cfg = jparse((char *)cb.p, cb.n); buf_free(&cb); free(sp);
    if (!cfg) { free(sdir); return -1; }
    Ufs u; if (ufs_parse(bundle_in->p, bundle_in->n, &u)) { jfree(cfg); free(sdir); return -1; }
    int sfi = -1; for (int i = 0; i < u.nfiles; i++) { size_t l = strlen(u.files[i].name); if (!(l > 5 && !strcmp(u.files[i].name + l - 5, ".resS"))) { sfi = i; break; } }
    SFile sf; if (sfi < 0 || sf_parse(u.files[sfi].data.p, u.files[sfi].data.n, &sf)) { ufs_free(&u); jfree(cfg); free(sdir); return -1; }
    Painted pt[256]; int npt = 0, nparts = 0, rc = -1;
    J *texs = jget(cfg, "textures");
    for (int ti = 0; texs && ti < texs->n; ti++) {
        const char *tname = texs->a[ti]->k; J *tparts = texs->a[ti];
        SObj *ctlo = NULL; int mid = -1; J *ctl = find_controller(&sf, tname, &ctlo, &mid); if (!ctl) goto done;
        SObj *texo = NULL; for (int i = 0; i < sf.nobjs; i++) if (sf_class(&sf, &sf.objs[i]) == 28 && !strcmp(tt_name(&sf, &sf.objs[i]), tname)) { texo = &sf.objs[i]; break; }
        if (!texo) { jfree(ctl); fc_fail("no texture %s", tname); goto done; }
        J *tv; Img atlas; if (tex_image(&u, &sf, texo, &tv, &atlas)) { jfree(ctl); goto done; }
        Img before = img_copy(&atlas);
        for (int pi = 0; pi < tparts->n; pi++) {
            J *pc = tparts->a[pi]; const char *cell = pc->k; J *c = cell_of(ctl, mid, cell);
            if (!c) { fc_fail("%s has no cell %s", tname, cell); jfree(tv); jfree(ctl); img_free(&atlas); img_free(&before); goto done; }
            int x = (int)jdbl(jget(jget(c, "pos"), "x")), y = (int)jdbl(jget(jget(c, "pos"), "y")), w = (int)jdbl(jget(jget(c, "size"), "x")), h = (int)jdbl(jget(jget(c, "size"), "y"));
            Img orig = img_crop(&atlas, x, y, w, h), nw;
            if (jget(pc, "shadowFrom")) {
                J *sf2 = jget(pc, "shadowFrom"); const char *st = jstrv(jat(sf2, 0)), *sc = jstrv(jat(sf2, 1)); Painted *src = NULL;
                for (int k = 0; k < npt; k++) if (!strcmp(pt[k].tex, st) && !strcmp(pt[k].cell, sc)) src = &pt[k];
                if (!src) { fc_fail("%s: shadowFrom %s/%s isn't painted yet", cell, st, sc); img_free(&orig); goto done; }
                Img new_src = img_copy(&src->after);
                if (jget(pc, "silhouette")) {
                    char *p = fc_sprintf("%s/%s", sdir, jgets(pc, "silhouette", "")); Img s0; int r = img_load_file(p, &s0); free(p); if (r) goto done;
                    img_free(&new_src); new_src = fit(&s0, src->before.w, src->before.h, jgets(pc, "fit", "stretch"), (int)jgeti(pc, "rotate", 0)); img_free(&s0);
                }
                Img bs = img_crop(&before, x, y, w, h);
                nw = make_shadow(&src->before, &new_src, &bs); img_free(&bs); img_free(&new_src);
                J *off = jget(pc, "offset"); if (off) { Img s2 = shift(&nw, jdbl(jat(off, 0)), jdbl(jat(off, 1))); img_free(&nw); nw = s2; }
            } else if (jtruthy(jget(pc, "clear"))) {
                nw = img_new(w, h);
            } else if (jget(pc, "tint") || jget(pc, "recolorGrey")) {
                J *a = jget(pc, "tint") ? jget(pc, "tint") : jget(pc, "recolorGrey"); int rgb[3] = {(int)jint(jat(a, 0)), (int)jint(jat(a, 1)), (int)jint(jat(a, 2))};
                nw = img_copy(&orig); if (jget(pc, "tint")) tint(&nw, rgb); else recolor_grey(&nw, rgb);
            } else {
                char *p = fc_sprintf("%s/%s", sdir, jgets(pc, "file", "")); Img src; int r = img_load_file(p, &src); free(p); if (r) { img_free(&orig); goto done; }
                J *cr = jget(pc, "crop");
                if (cr) { Img c2 = img_crop(&src, (int)jint(jat(cr, 0)), (int)jint(jat(cr, 1)), (int)(jint(jat(cr, 2)) - jint(jat(cr, 0))), (int)(jint(jat(cr, 3)) - jint(jat(cr, 1)))); img_free(&src); src = c2; }
                nw = fit(&src, w, h, jgets(pc, "fit", "stretch"), (int)jgeti(pc, "rotate", 0)); img_free(&src);
                if (jtruthy(jget(pc, "matchBottom"))) match_bottom(&nw, &orig);
                J *off = jget(pc, "offset"); if (off) { Img s2 = shift(&nw, jdbl(jat(off, 0)), jdbl(jat(off, 1))); img_free(&nw); nw = s2; }
            }
            Img blank = img_new(w, h); paste(&atlas, &blank, x, y); img_free(&blank); paste(&atlas, &nw, x, y);
            if (npt < 256) { pt[npt].tex = fc_strdup(tname); pt[npt].cell = fc_strdup(cell); pt[npt].before = img_crop(&before, x, y, w, h); pt[npt].after = nw; npt++; } else img_free(&nw);
            img_free(&orig); nparts++;
        }
        /* atlas back in as RGBA32 (inline, stream cleared) */
        jset(tv, "m_Width", jnum_i(atlas.w));
        { Buf px = {0}; img_to_rgba32_flipped(&atlas, &px);
          if (jget(tv, "m_MipMap")) jset(tv, "m_MipMap", jnew(J_FALSE)); if (jget(tv, "m_MipCount")) jset(tv, "m_MipCount", jnum_i(1));
          jset(tv, "m_Height", jnum_i(atlas.h)); jset(tv, "image data", jstrn((char *)px.p, px.n)); jset(tv, "m_CompleteImageSize", jnum_i((long long)px.n)); jset(tv, "m_TextureFormat", jnum_i(4));
          J *sd = jget(tv, "m_StreamData"); if (sd) { jset(sd, "offset", jnum_i(0)); jset(sd, "size", jnum_i(0)); jset(sd, "path", jstr("")); }
          buf_free(&px); }
        { Buf nb = {0}; if (tt_write(&sf, texo, tv, &nb)) goto done; buf_free(&texo->data); texo->data = nb; }
        jfree(tv); img_free(&atlas); img_free(&before);
        /* scale / pivot: size, pos and pixelSize scale together, around the cell pivot -- in every controller using this atlas */
        jfree(ctl);
        for (int start = 0;;) {
            SObj *co = NULL; int cm = -1; J *cv = find_controller_from(&sf, tname, &co, &cm, start);
            if (!cv) break;
            start = (int)(co - sf.objs) + 1;
            int scaled = 0;
            for (int pi = 0; pi < tparts->n; pi++) {
                J *pc = tparts->a[pi]; if (!jget(pc, "scale") && !jget(pc, "pivot")) continue;
                J *cl = jget(cv, "cellList");
                for (int ci = 0; cl && ci < cl->n; ci++) {
                    J *c = cl->a[ci]; if (jgeti(c, "mapId", -1) != cm || strcmp(jgets(c, "name", ""), pc->k)) continue;
                    J *pv = jget(pc, "pivot"); if (pv) { jset(jget(c, "pivot"), "x", jnum_d(jdbl(jat(pv, 0)))); jset(jget(c, "pivot"), "y", jnum_d(jdbl(jat(pv, 1)))); }
                    J *k = jget(pc, "scale"); double kx = 1, ky = 1;
                    if (k && k->t == J_ARR) { kx = jdbl(jat(k, 0)); ky = jdbl(jat(k, 1)); } else if (k) kx = ky = jdbl(k);
                    const char *keys[3] = {"size", "pos", "pixelSize"};
                    for (int q = 0; q < 3; q++) { J *v = jget(c, keys[q]); if (!v) continue; jset(v, "x", jnum_d(jdbl(jget(v, "x")) * kx)); jset(v, "y", jnum_d(jdbl(jget(v, "y")) * ky)); }
                    scaled = 1;
                }
            }
            if (scaled) { Buf nb = {0}; if (tt_write(&sf, co, cv, &nb)) { jfree(cv); goto done; } buf_free(&co->data); co->data = nb; }
            jfree(cv);
        }
    }
    { Buf sfo = {0}; sf_write(&sf, &sfo); buf_free(&u.files[sfi].data); u.files[sfi].data = sfo; }
    ufs_build(&u, out, lz4_level);
    if (nparts_out) *nparts_out = nparts;
    rc = 0;
done:
    for (int k = 0; k < npt; k++) { free(pt[k].tex); free(pt[k].cell); img_free(&pt[k].before); img_free(&pt[k].after); }
    sf_free(&sf); ufs_free(&u); jfree(cfg); free(sdir);
    return rc;
}
