/* Grey layer reader (cc26, D3c). Reads the CCGL section of a version 2 file (E15): the cell table in rows, then the
 * cell bodies in blocks of 192 B. Integer code only, no heap, no float, no new static memory. Reads per frame:
 * per new row, a binary search (one 4 B read per step) and one read of at most 8 records; per cell, one read per
 * 192 B of body that the decode consumes. */
#include "wb_grey.h"

#define GB_BLOCK 192u          /* block read of a cell body (the unit's WB_BLOCK) */
#define GB_CELL 4096u          /* cell side in way-back units: 256 m */
#define GB_ROW_RECORDS 8u      /* cell records read for one row */
#define GB_MAX_ROWS 4u
#define GB_MAX_CELLS 16u
#define GB_MAX_POINTS 32u      /* a line has at most 32 points */
#define GB_HALF_W 4800         /* 300 m in units (1/16 m) */
#define GB_BEHIND 1600         /* 100 m */
#define GB_AHEAD 8320          /* 520 m */
#define GB_SECTION_HEAD 16u    /* magic, shifts, reserved, cell count, body bytes */

struct gb_row { uint32_t cy, cnt, key[GB_ROW_RECORDS], off[GB_ROW_RECORDS]; };

/* Streaming reader of one cell body: one block buffer, refilled only when a byte is needed. */
struct gb_read {
  wb_engine *e;
  uint32_t base, len, used, pos, have;
  uint8_t buf[GB_BLOCK];
};

static uint32_t gb_u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int32_t fdiv(int32_t v, int32_t d) {   /* floor(v / d) for d > 0 */
  return v >= 0 ? v / d : -((-v + d - 1) / d);
}

/* 1 = byte, 0 = end of the body, -1 = read error. */
static int gb_byte(struct gb_read *s, uint8_t *out) {
  if (s->pos == s->have) {
    uint32_t want = s->len - s->used;
    if (want == 0u) return 0;
    if (want > GB_BLOCK) want = GB_BLOCK;
    if (!wb_read_at(s->e, s->base + s->used, s->buf, want)) return -1;
    s->used += want;
    s->have = want;
    s->pos = 0u;
  }
  *out = s->buf[s->pos++];
  return 1;
}

static int gb_varint(struct gb_read *s, uint32_t *v) {
  uint32_t x = 0u, shift = 0u;
  uint8_t c;
  for (;;) {
    if (gb_byte(s, &c) != 1 || shift > 28u) return -1;
    x |= (uint32_t)(c & 0x7Fu) << shift;
    if (!(c & 0x80u)) break;
    shift += 7u;
  }
  *v = x;
  return 0;
}

static int32_t unzig(uint32_t z) {
  return (z & 1u) ? -(int32_t)((z + 1u) >> 1) : (int32_t)(z >> 1);
}

/* Decodes the lines of one cell body and calls fn for each line. Returns 0 when the body is done, 1 when fn stopped
 * the draw, -1 on a read error or a malformed body. */
static int gb_cell(wb_engine *e, const wb_grid *g, uint32_t base, uint32_t len, uint32_t cx, uint32_t cy,
                   wb_grey_fn fn, void *ctx) {
  struct gb_read s;
  int32_t pts[2 * GB_MAX_POINTS];
  uint32_t lines, l, m, k;
  s.e = e; s.base = base; s.len = len; s.used = 0u; s.pos = 0u; s.have = 0u;
  if (gb_varint(&s, &lines) != 0) return -1;
  for (l = 0u; l < lines; l++) {
    uint8_t b[4];
    uint32_t qx, qy;
    if (gb_varint(&s, &m) != 0 || m < 2u || m > GB_MAX_POINTS) return -1;
    for (k = 0u; k < 4u; k++) if (gb_byte(&s, &b[k]) != 1) return -1;
    qx = (uint32_t)b[0] | ((uint32_t)b[1] << 8);
    qy = (uint32_t)b[2] | ((uint32_t)b[3] << 8);
    for (k = 0u; k < m; k++) {
      if (k > 0u) {
        uint32_t zx, zy;
        if (gb_varint(&s, &zx) != 0 || gb_varint(&s, &zy) != 0) return -1;
        qx = (uint32_t)((int32_t)qx + unzig(zx));
        qy = (uint32_t)((int32_t)qy + unzig(zy));
      }
      if (qx > 512u || qy > 512u) return -1;
      wb_point(g, cx * GB_CELL + qx * 8u, cy * GB_CELL + qy * 8u, pts + 2 * k);
    }
    if (!fn(ctx, pts, m)) return 1;
  }
  return 0;
}

uint32_t wb_grey_cells(const wb_engine *e, int32_t lat_e7, int32_t lon_e7, uint32_t *cells) {
  wb_grid g;
  uint32_t x, y, n = 0u;
  uint64_t d[GB_MAX_CELLS];
  int32_t X, Y, cx0, cx1, cy0, cy1, cx, cy;
  wb_grid_get(e, &g);
  if (!wb_units(&g, lat_e7, lon_e7, &x, &y)) return 0u;
  X = (int32_t)x;
  Y = (int32_t)y;
  cx0 = fdiv(X - GB_HALF_W, GB_CELL);
  if (cx0 < 0) cx0 = 0;
  cx1 = fdiv(X + GB_HALF_W - 1, GB_CELL);
  cy0 = fdiv(Y - GB_BEHIND, GB_CELL);
  if (cy0 < 0) cy0 = 0;
  cy1 = fdiv(Y + GB_AHEAD - 1, GB_CELL);
  for (cy = cy0; cy <= cy1; cy++) {
    for (cx = cx0; cx <= cx1; cx++) {
      int64_t dx = (int64_t)cx * GB_CELL + GB_CELL / 2 - X, dy = (int64_t)cy * GB_CELL + GB_CELL / 2 - Y;
      uint64_t dd = (uint64_t)(dx * dx) + (uint64_t)(dy * dy);
      uint32_t j;
      if (n >= GB_MAX_CELLS) return n;   /* the box is at most 4 cells on each side */
      j = n++;
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

int wb_grey_lines(wb_engine *e, const uint32_t *cells, uint32_t ncells, wb_grey_fn fn, void *ctx) {
  uint32_t info[3], nrows = 0u, i;
  struct gb_row rows[GB_MAX_ROWS];
  wb_grid g;
  if (!wb_grey_section(e, info)) return 1;
  if (ncells > GB_MAX_CELLS) return 0;
  wb_grid_get(e, &g);
  for (i = 0u; i < ncells; i++) {
    uint32_t cy = cells[i] >> 16, cx = cells[i] & 0xFFFFu, r, j, lo, hi, cnt, len;
    int rc;
    for (r = 0u; r < nrows && rows[r].cy != cy; r++) ;
    if (r == nrows) {   /* first cell of this row: one binary search and one read of the records */
      uint32_t cxlo = cx, t;
      uint8_t rec[GB_ROW_RECORDS * 8u];
      if (nrows >= GB_MAX_ROWS) return 0;
      for (t = 0u; t < ncells; t++) if ((cells[t] >> 16) == cy && (cells[t] & 0xFFFFu) < cxlo) cxlo = cells[t] & 0xFFFFu;
      lo = 0u;
      hi = info[1];
      while (lo < hi) {
        uint32_t mid = lo + (hi - lo) / 2u, key;
        uint8_t kb[4];
        if (!wb_read_at(e, info[0] + GB_SECTION_HEAD + mid * 8u, kb, 4u)) return 0;
        key = gb_u32(kb);
        if (key < ((cy << 16) | cxlo)) lo = mid + 1u;
        else hi = mid;
      }
      cnt = info[1] + 1u - lo;
      if (cnt > GB_ROW_RECORDS) cnt = GB_ROW_RECORDS;
      if (!wb_read_at(e, info[0] + GB_SECTION_HEAD + lo * 8u, rec, cnt * 8u)) return 0;
      rows[nrows].cy = cy;
      rows[nrows].cnt = cnt;
      for (j = 0u; j < cnt; j++) {
        rows[nrows].key[j] = gb_u32(rec + 8u * j);
        rows[nrows].off[j] = gb_u32(rec + 8u * j + 4u);
      }
      r = nrows++;
    }
    for (j = 0u; j < rows[r].cnt && rows[r].key[j] != cells[i]; j++) ;
    if (j == rows[r].cnt) continue;          /* the cell has no body in the layer */
    if (j + 1u >= rows[r].cnt) return 0;     /* the next record, which gives the body length, is not read */
    len = rows[r].off[j + 1u] - rows[r].off[j];
    rc = gb_cell(e, &g, info[0] + GB_SECTION_HEAD + (info[1] + 1u) * 8u + rows[r].off[j], len, cx, cy, fn, ctx);
    if (rc < 0) return 0;
    if (rc == 1) return 1;
  }
  return 1;
}
