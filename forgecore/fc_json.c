/* Ordered JSON that keeps number literals exactly as written, printed like Python's json.dumps(ensure_ascii=False). */
#include "fc.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

J *jnew(int t) { J *j = calloc(1, sizeof *j); j->t = t; return j; }
void jfree(J *j) {
    if (!j) return;
    for (int i = 0; i < j->n; i++) jfree(j->a[i]);
    free(j->a); free(j->k); free(j->s); free(j);
}
J *jclone(const J *j) {
    if (!j) return NULL;
    J *c = jnew(j->t);
    if (j->k) c->k = fc_strdup(j->k);
    if (j->s) { c->s = malloc(j->sl + 1); memcpy(c->s, j->s, j->sl + 1); c->sl = j->sl; }
    if (j->n) { c->a = malloc(sizeof(J *) * j->n); c->cap = j->n; c->n = j->n; for (int i = 0; i < j->n; i++) c->a[i] = jclone(j->a[i]); }
    return c;
}
J *jstrn(const char *s, size_t n) { J *j = jnew(J_STR); j->s = malloc(n + 1); memcpy(j->s, s, n); j->s[n] = 0; j->sl = n; return j; }
J *jstr(const char *s) { return jstrn(s, strlen(s)); }
J *jnum_i(long long v) { J *j = jnew(J_NUM); j->s = fc_sprintf("%lld", v); j->sl = strlen(j->s); return j; }
J *jnum_d(double v) {
    char b[64];
    if (v == floor(v) && fabs(v) < 1e16) { snprintf(b, sizeof b, "%.1f", v); }
    else {
        for (int p = 1; p <= 17; p++) { snprintf(b, sizeof b, "%.*g", p, v); if (strtod(b, NULL) == v) break; }
        /* Python writes 1e-05 as "1e-05" and 1.5e+20 as "1.5e+20": %g already does */
    }
    J *j = jnew(J_NUM); j->s = fc_strdup(b); j->sl = strlen(b); return j;
}
J *jget(const J *o, const char *k) {
    if (!o || o->t != J_OBJ) return NULL;
    for (int i = 0; i < o->n; i++) if (!strcmp(o->a[i]->k, k)) return o->a[i];
    return NULL;
}
J *jat(const J *a, int i) { return a && (a->t == J_ARR || a->t == J_OBJ) && i >= 0 && i < a->n ? a->a[i] : NULL; }
static void jgrow(J *a) { if (a->n == a->cap) { a->cap = a->cap ? a->cap * 2 : 8; a->a = realloc(a->a, sizeof(J *) * a->cap); } }
J *jpush(J *a, J *v) { jgrow(a); a->a[a->n++] = v; return v; }
J *jset(J *o, const char *k, J *v) {
    free(v->k); v->k = fc_strdup(k);
    for (int i = 0; i < o->n; i++) if (!strcmp(o->a[i]->k, k)) { jfree(o->a[i]); o->a[i] = v; return v; }
    return jpush(o, v);
}
void jdel(J *o, const char *k) {
    for (int i = 0; i < o->n; i++) if (!strcmp(o->a[i]->k, k)) {
        jfree(o->a[i]); memmove(o->a + i, o->a + i + 1, sizeof(J *) * (o->n - i - 1)); o->n--; return;
    }
}
long long jint(const J *j) {
    if (!j) return 0;
    if (j->t == J_NUM || j->t == J_STR) {
        if (!strpbrk(j->s, ".eE")) return strtoll(j->s, NULL, 10);   /* exact for 64-bit ids */
        double d = strtod(j->s, NULL); return (long long)(d < 0 ? ceil(d) : floor(d));
    }
    return j->t == J_TRUE;
}
double jdbl(const J *j) { return j && (j->t == J_NUM || j->t == J_STR) ? strtod(j->s, NULL) : (j && j->t == J_TRUE); }
const char *jstrv(const J *j) { return j && j->t == J_STR ? j->s : ""; }
int jtruthy(const J *j) {
    if (!j) return 0;
    switch (j->t) { case J_NULL: case J_FALSE: return 0; case J_TRUE: return 1; case J_NUM: return strtod(j->s, NULL) != 0;
    case J_STR: return j->sl > 0; default: return j->n > 0; }
}
long long jgeti(const J *o, const char *k, long long d) { J *v = jget(o, k); return v && v->t != J_NULL ? jint(v) : d; }
const char *jgets(const J *o, const char *k, const char *d) { J *v = jget(o, k); return v && v->t == J_STR ? v->s : d; }
int jeq(const J *a, const J *b) {
    if (!a || !b) return a == b;
    if (a->t != b->t) return 0;
    switch (a->t) {
    case J_NUM: return strtod(a->s, NULL) == strtod(b->s, NULL);
    case J_STR: return a->sl == b->sl && !memcmp(a->s, b->s, a->sl);
    case J_ARR: if (a->n != b->n) return 0; for (int i = 0; i < a->n; i++) if (!jeq(a->a[i], b->a[i])) return 0; return 1;
    case J_OBJ: if (a->n != b->n) return 0;
        for (int i = 0; i < a->n; i++) { J *o = jget(b, a->a[i]->k); if (!o || !jeq(a->a[i], o)) return 0; } return 1;
    default: return 1;
    }
}

/* ---- parse */
typedef struct { const char *p, *e; } P;
static void ws(P *p) { while (p->p < p->e && (*p->p == ' ' || *p->p == '\n' || *p->p == '\r' || *p->p == '\t')) p->p++; }
static void put_utf8(Buf *b, uint32_t c) {
    if (c < 0x80) buf_byte(b, c);
    else if (c < 0x800) { buf_byte(b, 0xC0 | c >> 6); buf_byte(b, 0x80 | (c & 63)); }
    else if (c < 0x10000) { buf_byte(b, 0xE0 | c >> 12); buf_byte(b, 0x80 | (c >> 6 & 63)); buf_byte(b, 0x80 | (c & 63)); }
    else { buf_byte(b, 0xF0 | c >> 18); buf_byte(b, 0x80 | (c >> 12 & 63)); buf_byte(b, 0x80 | (c >> 6 & 63)); buf_byte(b, 0x80 | (c & 63)); }
}
static int hex4(const char *s, uint32_t *v) {
    *v = 0; for (int i = 0; i < 4; i++) { char c = s[i]; int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; if (d < 0) return -1; *v = *v * 16 + d; }
    return 0;
}
static char *pstring(P *p, size_t *len) {
    Buf b = {0}; p->p++;
    while (p->p < p->e && *p->p != '"') {
        char c = *p->p++;
        if (c != '\\') { buf_byte(&b, c); continue; }
        if (p->p >= p->e) break;
        c = *p->p++;
        switch (c) {
        case 'n': buf_byte(&b, '\n'); break; case 't': buf_byte(&b, '\t'); break; case 'r': buf_byte(&b, '\r'); break;
        case 'b': buf_byte(&b, '\b'); break; case 'f': buf_byte(&b, '\f'); break;
        case 'u': {
            uint32_t v; if (p->e - p->p < 4 || hex4(p->p, &v)) { buf_free(&b); return NULL; } p->p += 4;
            if (v >= 0xD800 && v < 0xDC00 && p->e - p->p >= 6 && p->p[0] == '\\' && p->p[1] == 'u') {
                uint32_t lo; if (!hex4(p->p + 2, &lo) && lo >= 0xDC00 && lo < 0xE000) { v = 0x10000 + ((v - 0xD800) << 10) + (lo - 0xDC00); p->p += 6; }
            }
            put_utf8(&b, v); break; }
        default: buf_byte(&b, c);
        }
    }
    if (p->p >= p->e) { buf_free(&b); return NULL; }
    p->p++;
    buf_byte(&b, 0); *len = b.n - 1; return (char *)b.p;
}
static J *pvalue(P *p, int depth) {
    ws(p); if (p->p >= p->e || depth > 200) return NULL;
    char c = *p->p;
    if (c == '{' || c == '[') {
        J *j = jnew(c == '{' ? J_OBJ : J_ARR); p->p++; ws(p);
        if (p->p < p->e && *p->p == (c == '{' ? '}' : ']')) { p->p++; return j; }
        for (;;) {
            char *key = NULL; size_t kl;
            if (c == '{') {
                ws(p); if (p->p >= p->e || *p->p != '"' || !(key = pstring(p, &kl))) { jfree(j); return NULL; }
                ws(p); if (p->p >= p->e || *p->p != ':') { free(key); jfree(j); return NULL; } p->p++;
            }
            J *v = pvalue(p, depth + 1); if (!v) { free(key); jfree(j); return NULL; }
            v->k = key; jpush(j, v); ws(p);
            if (p->p < p->e && *p->p == ',') { p->p++; continue; }
            if (p->p < p->e && *p->p == (c == '{' ? '}' : ']')) { p->p++; return j; }
            jfree(j); return NULL;
        }
    }
    if (c == '"') { size_t l; char *s = pstring(p, &l); if (!s) return NULL; J *j = jnew(J_STR); j->s = s; j->sl = l; return j; }
    if (!strncmp(p->p, "true", 4)) { p->p += 4; return jnew(J_TRUE); }
    if (!strncmp(p->p, "false", 5)) { p->p += 5; return jnew(J_FALSE); }
    if (!strncmp(p->p, "null", 4)) { p->p += 4; return jnew(J_NULL); }
    const char *s = p->p;
    while (p->p < p->e && strchr("+-0123456789.eE", *p->p)) p->p++;
    if (p->p == s) return NULL;
    J *j = jnew(J_NUM); j->sl = (size_t)(p->p - s); j->s = malloc(j->sl + 1); memcpy(j->s, s, j->sl); j->s[j->sl] = 0;
    return j;
}
J *jparse(const char *text, size_t len) {
    P p = {text, text + len};
    if (len >= 3 && (uint8_t)text[0] == 0xEF && (uint8_t)text[1] == 0xBB && (uint8_t)text[2] == 0xBF) p.p += 3;
    J *j = pvalue(&p, 0);
    if (!j) fc_fail("bad JSON near byte %ld", (long)(p.p - text));
    return j;
}

/* ---- print */
static void pstr(Buf *b, const char *s, size_t n) {
    buf_byte(b, '"');
    for (size_t i = 0; i < n; i++) {
        uint8_t c = (uint8_t)s[i];
        switch (c) {
        case '"': buf_str(b, "\\\""); break; case '\\': buf_str(b, "\\\\"); break;
        case '\n': buf_str(b, "\\n"); break; case '\r': buf_str(b, "\\r"); break; case '\t': buf_str(b, "\\t"); break;
        case '\b': buf_str(b, "\\b"); break; case '\f': buf_str(b, "\\f"); break;
        default: if (c < 0x20) buf_printf(b, "\\u%04x", c); else buf_byte(b, c);
        }
    }
    buf_byte(b, '"');
}
static void pnl(Buf *b, int indent, int level) { buf_byte(b, '\n'); for (int i = 0; i < indent * level; i++) buf_byte(b, ' '); }
static void pval(const J *j, int indent, int level, Buf *b) {
    switch (j->t) {
    case J_NULL: buf_str(b, "null"); break; case J_TRUE: buf_str(b, "true"); break; case J_FALSE: buf_str(b, "false"); break;
    case J_NUM: buf_put(b, j->s, j->sl); break;
    case J_STR: pstr(b, j->s, j->sl); break;
    case J_ARR: case J_OBJ: {
        char o = j->t == J_ARR ? '[' : '{', c = j->t == J_ARR ? ']' : '}';
        buf_byte(b, o);
        if (!j->n) { buf_byte(b, c); break; }
        for (int i = 0; i < j->n; i++) {
            if (i) buf_byte(b, ',');
            if (indent >= 0) pnl(b, indent, level + 1);
            if (j->t == J_OBJ) { pstr(b, j->a[i]->k, strlen(j->a[i]->k)); buf_str(b, indent >= 0 ? ": " : ":"); }
            pval(j->a[i], indent, level + 1, b);
        }
        if (indent >= 0) pnl(b, indent, level);
        buf_byte(b, c); break; }
    }
}
void jprint(const J *j, int indent, Buf *out) { pval(j, indent, 0, out); }
char *jdump(const J *j, int indent, size_t *len) { Buf b = {0}; jprint(j, indent, &b); buf_byte(&b, 0); if (len) *len = b.n - 1; return (char *)b.p; }
