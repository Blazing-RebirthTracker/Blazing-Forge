#include "fc.h"
#include <stdlib.h>
#include <string.h>
#include <zlib.h>
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_NO_STDIO
#include "vendor/stb_image.h"
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "vendor/stb_image_resize2.h"

Img img_new(int w, int h) { Img im = {w, h, calloc((size_t)w * h, 4)}; return im; }
void img_free(Img *im) { free(im->px); im->px = NULL; im->w = im->h = 0; }

int img_load(const uint8_t *d, size_t n, Img *im) {
    int w, h, c;
    uint8_t *px = stbi_load_from_memory(d, (int)n, &w, &h, &c, 4);
    if (!px) return fc_fail("can't read image: %s", stbi_failure_reason());
    im->w = w; im->h = h; im->px = malloc((size_t)w * h * 4); memcpy(im->px, px, (size_t)w * h * 4); stbi_image_free(px);
    return 0;
}
int img_load_file(const char *path, Img *im) {
    Buf b = {0}; if (file_read(path, &b)) return -1;
    int r = img_load(b.p, b.n, im); buf_free(&b);
    if (r) return fc_fail("can't read image %s", path);
    return 0;
}
Img img_resize(const Img *im, int w, int h) {
    Img o = img_new(w, h);
    stbir_resize_uint8_linear(im->px, im->w, im->h, 0, o.px, w, h, 0, STBIR_RGBA);
    return o;
}
Img img_crop(const Img *im, int x, int y, int w, int h) {
    Img o = img_new(w, h);
    for (int r = 0; r < h; r++) for (int c = 0; c < w; c++) {
        int sx = x + c, sy = y + r;
        if (sx >= 0 && sy >= 0 && sx < im->w && sy < im->h) memcpy(o.px + 4 * ((size_t)r * w + c), im->px + 4 * ((size_t)sy * im->w + sx), 4);
    }
    return o;
}
void img_to_rgba32_flipped(const Img *im, Buf *out) {
    out->n = 0; buf_reserve(out, (size_t)im->w * im->h * 4);
    for (int r = im->h - 1; r >= 0; r--) buf_put(out, im->px + (size_t)r * im->w * 4, (size_t)im->w * 4);
}
Img img_from_rgba32_flipped(const uint8_t *d, int w, int h) {
    Img o = img_new(w, h);
    for (int r = 0; r < h; r++) memcpy(o.px + (size_t)r * w * 4, d + (size_t)(h - 1 - r) * w * 4, (size_t)w * 4);
    return o;
}

static void chunk(Buf *b, const char *type, const uint8_t *d, size_t n) {
    buf_u32be(b, (uint32_t)n);
    size_t at = b->n; buf_put(b, type, 4); buf_put(b, d, n);
    buf_u32be(b, crc32_of(b->p + at, n + 4));
}
void img_png(const Img *im, int rgb_only, Buf *out) {
    int ch = rgb_only ? 3 : 4;
    Buf raw = {0};
    for (int r = 0; r < im->h; r++) {
        buf_byte(&raw, 0);
        for (int c = 0; c < im->w; c++) buf_put(&raw, im->px + 4 * ((size_t)r * im->w + c), ch);
    }
    uLongf zn = compressBound(raw.n); uint8_t *z = malloc(zn);
    compress2(z, &zn, raw.p, raw.n, 9);
    out->n = 0; buf_put(out, "\x89PNG\r\n\x1a\n", 8);
    uint8_t ihdr[13]; ihdr[0]=im->w>>24; ihdr[1]=im->w>>16; ihdr[2]=im->w>>8; ihdr[3]=im->w; ihdr[4]=im->h>>24; ihdr[5]=im->h>>16; ihdr[6]=im->h>>8; ihdr[7]=im->h;
    ihdr[8] = 8; ihdr[9] = rgb_only ? 2 : 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
    chunk(out, "IHDR", ihdr, 13); chunk(out, "IDAT", z, zn); chunk(out, "IEND", NULL, 0);
    free(z); buf_free(&raw);
}
