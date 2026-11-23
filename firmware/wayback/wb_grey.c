/* Grey layer reader (cc27). See wb_grey.h. */
#include "wb_grey.h"

#define GL_HEAD 28u
#define GL_DIR 1024u                  /* 256 directory keys */
#define GL_RECS 72u                   /* records of one row read: up to 63 before the row, the row, its end record */
#define GL_BODY 2048u
#define GL_REC_AT(l) ((l)->head + GL_DIR)
#define GL_BODY_AT(l) ((l)->head + GL_DIR + 8u * GL_RECS)
#define GL_XY_AT(l) (GL_BODY_AT(l) + GL_BODY)
#define GL_CELL 4096                  /* cell side in units: 256 m */
#define GL_ONE 4096                   /* scale of gl_sin */
#define GL_HALF_W 4800                /* half the screen width: 300 m in units (1/16 m) */
#define GL_HALF_L 4960                /* half the screen length: (520 m ahead + 100 m behind) / 2 */
#define GL_MID 3360                   /* the screen centre is 210 m ahead of the rider */

static int32_t gl_abs(int32_t v) { return v < 0 ? -v : v; }

/* sin(d degrees) x 4096, Bhaskara I approximation: error below 0.2%, integer only. */
static int32_t gl_sin(uint32_t d) {
  int32_t x = (int32_t)(d % 180u), p = x * (180 - x), s = 4 * GL_ONE * p / (40500 - p);
  return d % 360u < 180u ? s : -s;
}

int gl_open(gl_layer *l, wb_reader rd, void *ctx, uint32_t at, uint32_t size, uint8_t *buf) {
  const uint8_t *h = buf;
  uint32_t shift;
  if (!buf || size < GL_HEAD || !rd(ctx, at, buf, size < GL_HEAD + GL_DIR ? size : GL_HEAD + GL_DIR)) return 0;
  if (wb_u32(h) != 0x4C474343u || h[4] != 12u || h[5] != 3u || h[6] != 2u || h[7] < 4u || h[7] > 6u) return 0;   /* "CCGL" */
  shift = h[7];
  l->rd = rd; l->ctx = ctx; l->at = at; l->size = size; l->buf = buf; l->head = GL_HEAD;
  l->n = wb_u32(h + 8); l->body = wb_u32(h + 12); l->pix_cap = wb_u32(h + 16); l->pt_cap = wb_u32(h + 20); l->m = wb_u32(h + 24);
  l->stride = 1u << shift;
  if (!l->n || l->n > (256u << shift) || l->m != (l->n + l->stride - 1u) >> shift) return 0;
  return l->body <= size && size - l->body == GL_HEAD + 4u * l->m + 8u * (l->n + 1u);
}

uint32_t gl_cells(uint32_t x, uint32_t y, uint32_t course_deg, uint32_t cells[GL_CELLS]) {
  uint32_t n = 0u, j, d[GL_CELLS];
  int32_t ux = gl_sin(course_deg), uy = gl_sin(course_deg + 90u);    /* ahead, x 4096: east, north */
  int32_t ax = gl_abs(ux), ay = gl_abs(uy), r = GL_CELL / 2 * (ax + ay);   /* r: half cell on a screen axis */
  int32_t mx = (int32_t)x + ux * GL_MID / GL_ONE, my = (int32_t)y + uy * GL_MID / GL_ONE;   /* screen centre, units */
  int32_t hx = (GL_HALF_L * ax + GL_HALF_W * ay) / GL_ONE + 1, hy = (GL_HALF_L * ay + GL_HALF_W * ax) / GL_ONE + 1;
  int32_t cx, cy;
  for (cy = (my - hy) >> 12; cy <= (my + hy) >> 12; cy++) {           /* >> 12: the 4,096-unit cell, floor */
    for (cx = (mx - hx) >> 12; cx <= (mx + hx) >> 12; cx++) {
      int32_t dx = cx * GL_CELL + GL_CELL / 2 - (int32_t)x, dy = cy * GL_CELL + GL_CELL / 2 - (int32_t)y;
      uint32_t dd = (uint32_t)(dx * dx + dy * dy);
      /* Separating axes: the box rows and columns above, then the two screen axes. */
      if (cx < 0 || cy < 0 || gl_abs(dx * ux + dy * uy - GL_MID * GL_ONE) >= GL_HALF_L * GL_ONE + r ||
          gl_abs(dx * uy - dy * ux) >= GL_HALF_W * GL_ONE + r) continue;
      if (n == GL_CELLS && dd >= d[n - 1u]) continue;                /* full: keep the nearest */
      j = n < GL_CELLS ? n++ : n - 1u;
      while (j > 0u && d[j - 1u] > dd) {   /* insertion sort, stable: equal distances keep the scan order */
        d[j] = d[j - 1u];
        cells[j] = cells[j - 1u];
        j--;
      }
      d[j] = dd;
      cells[j] = ((uint32_t)cy << 16) | (uint32_t)cx;
    }
  }
  return n;
}

int gl_var(const uint8_t **p, const uint8_t *end, uint32_t *v) {
  uint32_t x = 0u, shift = 0u;
  uint8_t c;
  do {
    if (*p == end || shift > 28u) return 0;
    c = *(*p)++;
    x |= (uint32_t)(c & 0x7Fu) << shift;
    shift += 7u;
  } while (c & 0x80u);
  *v = x;
  return 1;
}
int32_t gl_unzig(uint32_t z) { return (z & 1u) ? -(int32_t)((z + 1u) >> 1) : (int32_t)(z >> 1); }

/* The lines of the body at p. 0 = done, 1 = fn stopped, -1 = a bad body. */
typedef struct { gl_layer *l; gl_fn fn; void *ctx; } gl_grey_ctx;
static int gl_cell(void *vc, uint32_t key, const uint8_t *p, uint32_t len) {
  gl_grey_ctx *g = (gl_grey_ctx *)vc;
  const uint8_t *end = p + len;
  int32_t *xy = (int32_t *)(void *)(g->l->buf + GL_XY_AT(g->l));
  int32_t x0 = (int32_t)((key & 0xFFFFu) << 12), y0 = (int32_t)((key >> 16) << 12);
  uint32_t lines, m, k;
  if (!gl_var(&p, end, &lines)) return -1;
  while (lines--) {
    int32_t qx, qy;
    if (!gl_var(&p, end, &m) || m < 2u || m > GL_POINTS || end - p < 4) return -1;
    qx = (int32_t)(p[0] | (p[1] << 8)); qy = (int32_t)(p[2] | (p[3] << 8)); p += 4;
    for (k = 0u; k < m; k++) {
      if (k) {
        uint32_t zx, zy;
        /* a step inside the cell is at most 512 (zigzag 1024): a larger one is refused before the sum can overflow */
        if (!gl_var(&p, end, &zx) || !gl_var(&p, end, &zy) || zx > 1024u || zy > 1024u) return -1;
        qx += gl_unzig(zx); qy += gl_unzig(zy);
      }
      if (qx < 0 || qx > 512 || qy < 0 || qy > 512) return -1;
      xy[2u * k] = x0 + qx * 8; xy[2u * k + 1u] = y0 + qy * 8;
    }
    if (!g->fn(g->ctx, xy, m)) return 1;
  }
  return 0;
}

int gl_bodies(gl_layer *l, const uint32_t *cells, uint32_t n, gl_body_fn body, void *ctx) {
  uint32_t off[GL_CELLS], len[GL_CELLS], i, t, tab = l->head + 4u * l->m, base = tab + 8u * (l->n + 1u);
  const uint8_t *rec = l->buf + GL_REC_AT(l);
  if (n > GL_CELLS) return 0;
  for (i = 0u; i < n; i++) len[i] = 0u;
  for (i = 0u; i < n; i++) {                        /* one record read for each row, at its first cell */
    uint32_t cy = cells[i] >> 16, lo = cells[i], j, start, cnt, r, o, e;
    for (t = 0u; t < i && (cells[t] >> 16) != cy; t++) {}
    if (t < i) continue;
    for (t = i + 1u; t < n; t++) if ((cells[t] >> 16) == cy && cells[t] < lo) lo = cells[t];
    for (j = 0u; j + 1u < l->m && wb_u32(l->buf + l->head + 4u * (j + 1u)) <= lo; j++) {}
    start = j * l->stride;
    cnt = l->n + 1u - start;
    if (cnt > GL_RECS) cnt = GL_RECS;
    if (!l->rd(l->ctx, l->at + tab + 8u * start, l->buf + GL_REC_AT(l), 8u * cnt)) return 0;
    for (t = i; t < n; t++) {
      if ((cells[t] >> 16) != cy) continue;
      for (r = 0u; r < cnt && wb_u32(rec + 8u * r) != cells[t]; r++) {}
      if (r == cnt) {                                /* no body; unknown when the read stopped before the key */
        if (wb_u32(rec + 8u * (cnt - 1u)) < cells[t]) return 0;
        continue;
      }
      if (r + 1u == cnt) return 0;                    /* the end record is not read */
      o = wb_u32(rec + 8u * r + 4u); e = wb_u32(rec + 8u * r + 12u);
      if (e < o || e > l->body || e - o > GL_BODY) return 0;
      off[t] = o; len[t] = e - o;
    }
  }
  for (i = 0u; i < n; i++) {                        /* one body read for each cell, nearest first */
    int rc;
    if (!len[i]) continue;
    if (!l->rd(l->ctx, l->at + base + off[i], l->buf + GL_BODY_AT(l), len[i])) return 0;
    rc = body(ctx, cells[i], l->buf + GL_BODY_AT(l), len[i]);
    if (rc) return rc > 0;
  }
  return 1;
}

int gl_lines(gl_layer *l, const uint32_t *cells, uint32_t n, gl_fn fn, void *ctx) {
  gl_grey_ctx g; g.l = l; g.fn = fn; g.ctx = ctx;
  return gl_bodies(l, cells, n, gl_cell, &g);
}
