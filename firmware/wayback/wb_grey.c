/* Grey layer reader (cc26, D3c). Reads the CCGL section of a version 2 file (E15): the cell table in rows, then the
 * cell bodies in blocks of 192 B. Integer code only, no heap, no float, no new static memory. Reads per frame:
 * per new row, a binary search (one 4 B read per step) and one read of at most 8 records; per cell, one read per
 * 192 B of body that the decode consumes. */
#include "wb_grey.h"

#define GB_BLOCK 192u          /* block read of a cell body (the unit's WB_BLOCK) */
#define GB_CELL 4096u          /* cell side in way-back units: 256 m */
#define GB_ROW_RECORDS 8u      /* cell records read for one row */
#define GB_MAX_ROWS 5u          /* the box of a turned screen spans at most 5 rows */
#define GB_MAX_CELLS 20u
#define GB_MAX_POINTS 32u      /* a line has at most 32 points */
#define GB_HALF_W 4800         /* half the screen width: 300 m in units (1/16 m) */
#define GB_HALF_L 4960         /* half the screen length: (520 m ahead + 100 m behind) / 2 */
#define GB_MID 3360            /* the screen centre is 210 m ahead of the rider */
#define GB_ONE 4096            /* scale of gb_sin */
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

static int32_t gb_abs(int32_t v) { return v < 0 ? -v : v; }

/* sin(d degrees) x 4096, Bhaskara I approximation: error below 0.2%, integer only. */
static int32_t gb_sin(uint32_t d) {
  int32_t x = (int32_t)(d % 180u), p = x * (180 - x), s = 4 * GB_ONE * p / (40500 - p);
  return d % 360u < 180u ? s : -s;
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

uint32_t wb_grey_cells(const wb_engine *e, int32_t lat_e7, int32_t lon_e7, uint32_t course_deg, uint32_t *cells) {
  wb_grid g;
  uint32_t x, y, n = 0u, j, d[GB_MAX_CELLS];
  int32_t ux = gb_sin(course_deg), uy = gb_sin(course_deg + 90u);   /* ahead, x 4096: east, north */
  int32_t ax = gb_abs(ux), ay = gb_abs(uy), r = GB_CELL / 2 * (ax + ay);   /* r: half cell on a screen axis */
  int32_t mx, my, hx, hy, cx, cy;
  wb_grid_get(e, &g);
  if (!wb_units(&g, lat_e7, lon_e7, &x, &y)) return 0u;
  mx = (int32_t)x + ux * GB_MID / GB_ONE;                            /* screen centre and its half box, units */
  my = (int32_t)y + uy * GB_MID / GB_ONE;
  hx = (GB_HALF_L * ax + GB_HALF_W * ay) / GB_ONE + 1;
  hy = (GB_HALF_L * ay + GB_HALF_W * ax) / GB_ONE + 1;
  for (cy = (my - hy) >> 12; cy <= (my + hy) >> 12; cy++) {          /* >> 12: the 4,096-unit cell, floor */
    for (cx = (mx - hx) >> 12; cx <= (mx + hx) >> 12; cx++) {
      int32_t dx = cx * (int32_t)GB_CELL + (int32_t)GB_CELL / 2 - (int32_t)x, dy = cy * (int32_t)GB_CELL + (int32_t)GB_CELL / 2 - (int32_t)y;
      uint32_t dd = (uint32_t)(dx * dx + dy * dy);
      /* Separating axes: the box rows and columns above, then the two screen axes. */
      if (cx < 0 || cy < 0 || gb_abs(dx * ux + dy * uy - GB_MID * GB_ONE) >= GB_HALF_L * GB_ONE + r ||
          gb_abs(dx * uy - dy * ux) >= GB_HALF_W * GB_ONE + r) continue;
      if (n == GB_MAX_CELLS && dd >= d[n - 1u]) continue;           /* full: keep the nearest */
      j = n < GB_MAX_CELLS ? n++ : n - 1u;
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
