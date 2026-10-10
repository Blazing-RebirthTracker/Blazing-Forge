#include "fc.h"
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>
#include <zlib.h>

char fc_err[512];
static void log_stderr(const char *l){ fprintf(stderr, "%s\n", l); }
void (*fc_log_hook)(const char *line) = log_stderr;

int fc_fail(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); vsnprintf(fc_err, sizeof fc_err, fmt, ap); va_end(ap); return -1;
}
void fc_log(const char *fmt, ...) {
    char line[1024]; va_list ap; va_start(ap, fmt); vsnprintf(line, sizeof line, fmt, ap); va_end(ap);
    if (fc_log_hook) fc_log_hook(line);
}

void buf_reserve(Buf *b, size_t extra) {
    if (b->n + extra <= b->cap) return;
    size_t c = b->cap ? b->cap : 256;
    while (c < b->n + extra) c *= 2;
    b->p = realloc(b->p, c); b->cap = c;
}
void buf_put(Buf *b, const void *d, size_t n) { if (!n) return; buf_reserve(b, n); memcpy(b->p + b->n, d, n); b->n += n; }
void buf_byte(Buf *b, uint8_t v) { buf_reserve(b, 1); b->p[b->n++] = v; }
void buf_zero(Buf *b, size_t n) { buf_reserve(b, n); memset(b->p + b->n, 0, n); b->n += n; }
void buf_str(Buf *b, const char *s) { buf_put(b, s, strlen(s)); }
void buf_cstr(Buf *b, const char *s) { buf_put(b, s, strlen(s) + 1); }
void buf_align(Buf *b, size_t a, size_t base) { size_t r = (b->n - base) % a; if (r) buf_zero(b, a - r); }
void buf_u16le(Buf *b, uint16_t v) { uint8_t t[2] = {v, v >> 8}; buf_put(b, t, 2); }
void buf_u32le(Buf *b, uint32_t v) { uint8_t t[4]; wr32le(t, v); buf_put(b, t, 4); }
void buf_u64le(Buf *b, uint64_t v) { buf_u32le(b, (uint32_t)v); buf_u32le(b, (uint32_t)(v >> 32)); }
void buf_u16be(Buf *b, uint16_t v) { uint8_t t[2] = {v >> 8, v}; buf_put(b, t, 2); }
void buf_u32be(Buf *b, uint32_t v) { uint8_t t[4] = {v >> 24, v >> 16, v >> 8, v}; buf_put(b, t, 4); }
void buf_u64be(Buf *b, uint64_t v) { buf_u32be(b, (uint32_t)(v >> 32)); buf_u32be(b, (uint32_t)v); }
void buf_free(Buf *b) { free(b->p); b->p = NULL; b->n = b->cap = 0; }
void buf_printf(Buf *b, const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); int n = vsnprintf(NULL, 0, fmt, ap); va_end(ap);
    buf_reserve(b, n + 1); va_start(ap, fmt); vsnprintf((char *)b->p + b->n, n + 1, fmt, ap); va_end(ap); b->n += n;
}

char *fc_strdup(const char *s) { size_t n = strlen(s); char *r = malloc(n + 1); memcpy(r, s, n + 1); return r; }
char *fc_sprintf(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); int n = vsnprintf(NULL, 0, fmt, ap); va_end(ap);
    char *r = malloc(n + 1); va_start(ap, fmt); vsnprintf(r, n + 1, fmt, ap); va_end(ap); return r;
}

int file_read(const char *path, Buf *out) {
    FILE *f = fopen(path, "rb");
    if (!f) return fc_fail("can't open %s: %s", path, strerror(errno));
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    out->n = 0; buf_reserve(out, (size_t)n + 1);
    if (n && fread(out->p, 1, (size_t)n, f) != (size_t)n) { fclose(f); return fc_fail("can't read %s", path); }
    out->n = (size_t)n; out->p[n] = 0; fclose(f); return 0;
}
int file_exists(const char *path) { struct stat st; return stat(path, &st) == 0; }
int mkdirs(const char *dir) {
    char tmp[4096]; snprintf(tmp, sizeof tmp, "%s", dir);
    for (char *p = tmp + 1; *p; p++) if (*p == '/') { *p = 0; mkdir(tmp, 0755); *p = '/'; }
    mkdir(tmp, 0755); return 0;
}
int file_write(const char *path, const void *d, size_t n) {
    char dir[4096]; snprintf(dir, sizeof dir, "%s", path);
    char *s = strrchr(dir, '/'); if (s) { *s = 0; mkdirs(dir); }
    FILE *f = fopen(path, "wb");
    if (!f) return fc_fail("can't write %s: %s", path, strerror(errno));
    if (n && fwrite(d, 1, n, f) != n) { fclose(f); return fc_fail("short write %s", path); }
    fclose(f); return 0;
}

uint32_t crc32_of(const void *d, size_t n) {
    uLong c = crc32(0L, Z_NULL, 0);
    const uint8_t *p = d;
    while (n) { uInt k = n > 0x40000000 ? 0x40000000 : (uInt)n; c = crc32(c, p, k); p += k; n -= k; }
    return (uint32_t)c;
}

/* ---- SHA-256 */
typedef struct { uint32_t h[8]; uint64_t len; uint8_t buf[64]; size_t bl; } Sha;
static const uint32_t K256[64] = {
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define ROR(x,n) (((x) >> (n)) | ((x) << (32 - (n))))
static void sha_block(Sha *s, const uint8_t *p) {
    uint32_t w[64], a, b, c, d, e, f, g, h;
    for (int i = 0; i < 16; i++) w[i] = rd32be(p + 4 * i);
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = ROR(w[i-15], 7) ^ ROR(w[i-15], 18) ^ (w[i-15] >> 3), s1 = ROR(w[i-2], 17) ^ ROR(w[i-2], 19) ^ (w[i-2] >> 10);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }
    a=s->h[0]; b=s->h[1]; c=s->h[2]; d=s->h[3]; e=s->h[4]; f=s->h[5]; g=s->h[6]; h=s->h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t S1 = ROR(e,6) ^ ROR(e,11) ^ ROR(e,25), ch = (e & f) ^ (~e & g), t1 = h + S1 + ch + K256[i] + w[i];
        uint32_t S0 = ROR(a,2) ^ ROR(a,13) ^ ROR(a,22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = S0 + mj;
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    s->h[0]+=a; s->h[1]+=b; s->h[2]+=c; s->h[3]+=d; s->h[4]+=e; s->h[5]+=f; s->h[6]+=g; s->h[7]+=h;
}
void sha256_hex(const void *data, size_t n, char out[65]) {
    Sha s = {{0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}, 0, {0}, 0};
    const uint8_t *p = data; size_t i = 0;
    for (; i + 64 <= n; i += 64) sha_block(&s, p + i);
    uint8_t last[128] = {0}; size_t r = n - i; memcpy(last, p + i, r); last[r] = 0x80;
    size_t tot = r + 1 + 8 <= 64 ? 64 : 128; uint64_t bits = (uint64_t)n * 8;
    for (int k = 0; k < 8; k++) last[tot - 1 - k] = (uint8_t)(bits >> (8 * k));
    sha_block(&s, last); if (tot == 128) sha_block(&s, last + 64);
    for (int k = 0; k < 8; k++) sprintf(out + 8 * k, "%08x", s.h[k]);
}

/* ---- MD5 */
static const uint32_t MK[64] = {
0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,
0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,
0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,
0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391};
static const int MR[64] = {7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21};
static void md5_block(uint32_t h[4], const uint8_t *p) {
    uint32_t m[16]; for (int i = 0; i < 16; i++) m[i] = rd32le(p + 4 * i);
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
    for (int i = 0; i < 64; i++) {
        uint32_t f; int g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
        else { f = c ^ (b | ~d); g = (7 * i) & 15; }
        uint32_t t = d; d = c; c = b;
        uint32_t x = a + f + MK[i] + m[g]; b = b + ((x << MR[i]) | (x >> (32 - MR[i]))); a = t;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
}
void md5_hex(const void *data, size_t n, char out[33]) {
    uint32_t h[4] = {0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476};
    const uint8_t *p = data; size_t i = 0;
    for (; i + 64 <= n; i += 64) md5_block(h, p + i);
    uint8_t last[128] = {0}; size_t r = n - i; memcpy(last, p + i, r); last[r] = 0x80;
    size_t tot = r + 1 + 8 <= 64 ? 64 : 128; uint64_t bits = (uint64_t)n * 8;
    for (int k = 0; k < 8; k++) last[tot - 8 + k] = (uint8_t)(bits >> (8 * k));
    md5_block(h, last); if (tot == 128) md5_block(h, last + 64);
    for (int k = 0; k < 4; k++) for (int j = 0; j < 4; j++) sprintf(out + 8 * k + 2 * j, "%02x", (h[k] >> (8 * j)) & 0xff);
}
