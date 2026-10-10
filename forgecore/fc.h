/* forgecore: Blazing Forge's patch builder in portable C (Linux for testing, iOS inside the game's add-on). */
#ifndef FC_H
#define FC_H
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

/* ------------------------------------------------------------------ errors */
extern char fc_err[512];
int fc_fail(const char *fmt, ...);            /* sets fc_err, returns -1 */
void fc_log(const char *fmt, ...);            /* progress/report lines */
extern void (*fc_log_hook)(const char *line); /* where fc_log goes (default stderr) */

/* ------------------------------------------------------------------ byte buffer */
typedef struct { uint8_t *p; size_t n, cap; } Buf;
void buf_reserve(Buf *b, size_t extra);
void buf_put(Buf *b, const void *d, size_t n);
void buf_byte(Buf *b, uint8_t v);
void buf_zero(Buf *b, size_t n);
void buf_str(Buf *b, const char *s);       /* without NUL */
void buf_cstr(Buf *b, const char *s);      /* with NUL */
void buf_align(Buf *b, size_t a, size_t base); /* pad with zeros so (n-base)%a==0 */
void buf_u16le(Buf *b, uint16_t v); void buf_u32le(Buf *b, uint32_t v); void buf_u64le(Buf *b, uint64_t v);
void buf_u16be(Buf *b, uint16_t v); void buf_u32be(Buf *b, uint32_t v); void buf_u64be(Buf *b, uint64_t v);
void buf_free(Buf *b);
void buf_printf(Buf *b, const char *fmt, ...);

static inline uint16_t rd16le(const uint8_t *p){ return (uint16_t)(p[0] | p[1] << 8); }
static inline uint32_t rd32le(const uint8_t *p){ return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }
static inline uint64_t rd64le(const uint8_t *p){ return (uint64_t)rd32le(p) | (uint64_t)rd32le(p + 4) << 32; }
static inline uint16_t rd16be(const uint8_t *p){ return (uint16_t)(p[0] << 8 | p[1]); }
static inline uint32_t rd32be(const uint8_t *p){ return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
static inline uint64_t rd64be(const uint8_t *p){ return (uint64_t)rd32be(p) << 32 | rd32be(p + 4); }
static inline void wr32le(uint8_t *p, uint32_t v){ p[0]=v; p[1]=v>>8; p[2]=v>>16; p[3]=v>>24; }

/* ------------------------------------------------------------------ files and hashes */
int file_read(const char *path, Buf *out);
int file_write(const char *path, const void *d, size_t n);   /* creates parent folders */
int file_exists(const char *path);
int mkdirs(const char *dir);
void sha256_hex(const void *d, size_t n, char out[65]);
void md5_hex(const void *d, size_t n, char out[33]);
uint32_t crc32_of(const void *d, size_t n);
char *fc_strdup(const char *s);
char *fc_sprintf(const char *fmt, ...);   /* malloc'd */

/* ------------------------------------------------------------------ JSON (ordered, numbers kept as written) */
enum { J_NULL, J_FALSE, J_TRUE, J_NUM, J_STR, J_ARR, J_OBJ };
typedef struct J J;
struct J {
    int t;
    char *k;            /* key, when a member of an object */
    char *s; size_t sl; /* J_NUM: literal text; J_STR: UTF-8 bytes (may contain NUL) */
    J **a; int n, cap;  /* J_ARR / J_OBJ children */
};
J *jparse(const char *text, size_t len);           /* NULL on error (fc_err set) */
void jprint(const J *j, int indent, Buf *out);     /* indent<0: compact ("," ":"), else Python json.dumps(indent=n) */
char *jdump(const J *j, int indent, size_t *len);  /* malloc'd */
void jfree(J *j);
J *jclone(const J *j);
J *jnew(int t);
J *jnum_i(long long v);
J *jnum_d(double v);
J *jstr(const char *s);
J *jstrn(const char *s, size_t n);
J *jget(const J *o, const char *k);                /* object member or NULL */
J *jat(const J *a, int i);
J *jset(J *o, const char *k, J *v);                /* replace or append; takes ownership; returns v */
void jdel(J *o, const char *k);
J *jpush(J *a, J *v);                              /* takes ownership */
long long jint(const J *j);                        /* numbers, bools, numeric strings; 0 otherwise */
double jdbl(const J *j);
const char *jstrv(const J *j);                     /* string value or "" */
int jtruthy(const J *j);
int jeq(const J *a, const J *b);                   /* deep equality (numbers by value) */
long long jgeti(const J *o, const char *k, long long dflt);
const char *jgets(const J *o, const char *k, const char *dflt);

/* ------------------------------------------------------------------ ObfuscatedText (the game's table encoding) */
int obf_decode(const uint8_t *src, size_t n, Buf *out);
void obf_encode(const uint8_t *data, size_t n, uint32_t seed, Buf *out);

/* ------------------------------------------------------------------ UnityFS bundles */
typedef struct { char *name; uint32_t flags; Buf data; } UfsFile;
typedef struct { uint32_t fmt; char *ver, *rev; UfsFile *files; int nfiles; } Ufs;
int ufs_parse(const uint8_t *buf, size_t n, Ufs *u);
void ufs_build(const Ufs *u, Buf *out, int level);   /* UnityPy-style: LZ4HC blocks of 128 KB, info at the end */
void ufs_free(Ufs *u);
int ufs_crc(const uint8_t *buf, size_t n, uint32_t *crc); /* CRC32 over decompressed data */

/* ------------------------------------------------------------------ SerializedFile + type trees */
typedef struct { uint16_t ver; uint8_t level, flags; const char *type, *name; int32_t size, index, meta; } TNode;
typedef struct { int class_id; TNode *nodes; int nnodes; } SType;
typedef struct { int64_t path_id; int type_idx; Buf data; int changed; } SObj;
typedef struct {
    uint32_t version; int big_endian;
    Buf types_raw;          /* metadata from the start through the type list (copied verbatim) */
    Buf tail_raw;           /* scripts, externals, user info (copied verbatim) */
    SType *types; int ntypes;
    SObj *objs; int nobjs, cap;
    char *strbufs[64]; int nstrbufs;
} SFile;
int sf_parse(const uint8_t *d, size_t n, SFile *sf);
void sf_write(const SFile *sf, Buf *out);
void sf_free(SFile *sf);
int sf_class(const SFile *sf, const SObj *o);
SObj *sf_add(SFile *sf, int64_t path_id, int type_idx);

/* typed value trees: reuse J; byte blobs (TypelessData, UInt8 arrays, strings) are J_STR with sl bytes */
J *tt_read(const SFile *sf, const SObj *o);
int tt_write(const SFile *sf, const SObj *o, const J *v, Buf *out);
const char *tt_name(const SFile *sf, const SObj *o);   /* m_Name (first field) */

/* ------------------------------------------------------------------ images */
typedef struct { int w, h; uint8_t *px; } Img;   /* RGBA8, top-down */
int img_load(const uint8_t *d, size_t n, Img *im);
int img_load_file(const char *path, Img *im);
Img img_resize(const Img *im, int w, int h);
Img img_crop(const Img *im, int x, int y, int w, int h);
Img img_new(int w, int h);
void img_free(Img *im);
void img_png(const Img *im, int rgb_only, Buf *out);
void img_to_rgba32_flipped(const Img *im, Buf *out);
Img img_from_rgba32_flipped(const uint8_t *d, int w, int h);

/* ------------------------------------------------------------------ the build */
typedef struct {
    const char *base;        /* folder holding the clean BlazingData (or a resolver below) */
    const char *mod;         /* mod folder: units, banners, summon, gifts.json + art */
    const char *engine_json; /* the game's original BlazingEngine.json */
    const char *out;         /* output root: <out>/Blazing-Rebirth/BlazingData/... */
    int summon;              /* -1 auto (summon.json "enabled"), 0 off, 1 on */
    int lz4_level;           /* LZ4HC level for rebuilt bundles (9 = UnityPy's) */
    /* optional: map a BlazingData-relative path to the real file (e.g. prefer saved originals on device) */
    char *(*resolve)(void *ctx, const char *rel);
    void *resolve_ctx;
} FcBuild;
int fc_build(const FcBuild *b);   /* 0 ok, -1 error (fc_err) */

#endif
