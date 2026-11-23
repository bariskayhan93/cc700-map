/* Way-back core: finds the street piece near the rider and follows the stored next values.
 * Integer code only: no float, no heap, no 64-bit division. The only library-free helper that
 * touches memory is the reader callback. File layout: firmware/wayback/README.md. */
#include "wayback.h"

#define WB_HEADER_BYTES 64u
#define WB_CELL_BYTES 12u
#define WB_NODE_BYTES 8u              /* version 2 (cc26, E7) */
#define WB_EXTRA_BYTES 8u
#define WB_NIL 0xFFFFFFFFu
#define WB_D2_LIMIT 57600u          /* 15 m = 240 units; 240 * 240 */
#define WB_MAX_POINTS 4096u
#ifndef WB_BLOCK
#define WB_BLOCK 192u             /* block read: 24 nodes or 24 extra pieces */
#endif
#define WB_NEAR 1940u             /* 240 units (15 m) + 1,700 units (longest piece on one axis) */
#define WB_EXTRA_LEN_MASK 0x1FFFu   /* extra piece length in 0.1 m (13 bits, D1b) */
#define WB_EXTRA_GREY 0x2000u       /* extra piece grey flag (bit 13, D1b) */
#define WB_NODE_GREY_BIT 63u        /* node bit 63: grey flag of the piece to next (D1b) */
#define WB_GREY_BITS (1u << 24)     /* candidate bits 24: grey flag */
#define WB_EXTRA_FLAG 0x800000u     /* candidate id bit 23: extra piece (E10) */
#define WB_ROW_CELLS 8u             /* cell records read for one row: at most 7 cells and the next record */

struct wb_engine {
  wb_reader reader;
  void *ctx;
  uint32_t file_bytes;
  int32_t lat0_e7, lon0_e7;
  uint32_t lat_u, lon_u, lat_e, lon_e;
  uint32_t node_count, cell_count, extra_count;
  uint32_t off_nodes, off_extras;
  uint8_t mounted, has_line, kind, end_first;
  uint32_t a, b, len, end, end_dm, cur_next, npts;
  int32_t p_lat, p_lon;
};

/* 128 bytes on the 32-bit device; host pointers are 8 bytes wide, so the host limit is larger. */
#define WB_ENGINE_MAX (128u + 2u * (sizeof(void *) - 4u))
_Static_assert(sizeof(struct wb_engine) <= WB_ENGINE_MAX, "wb_engine is larger than 128 bytes on the device");

/* The line state before a tick: the change test needs it after the scan has started. */
typedef struct { uint8_t has; uint32_t kind, a, b; } wb_prev;

/* The best piece of a scan, with its squared distance and its position on the piece (0..256). */
typedef struct { uint32_t X, Y, d2, t; int have; wb_cand cand; } wb_pick;

static uint32_t rd_u16(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8);
}

static uint32_t rd_u24(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16);
}

uint32_t wb_u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Reads n bytes at offset off. Refuses any range outside the file. */
static int rd(const wb_engine *e, uint32_t off, uint8_t *dst, uint32_t n) {
  if (off > e->file_bytes || n > e->file_bytes - off) return 0;
  return e->reader(e->ctx, off, dst, n) != 0;
}

/* floor(v * s / 65536) for the unit scales. */
static uint32_t wb_scale(uint32_t v, uint32_t s) {
  return (uint32_t)(((uint64_t)v * s) >> 16);
}

void wb_grid_get(const wb_engine *e, wb_grid *g) {
  g->lat0_e7 = e->lat0_e7;
  g->lon0_e7 = e->lon0_e7;
  g->lat_u = e->lat_u;
  g->lon_u = e->lon_u;
  g->lat_e = e->lat_e;
  g->lon_e = e->lon_e;
}

int wb_units(const wb_grid *g, int32_t lat_e7, int32_t lon_e7, uint32_t *x, uint32_t *y) {
  uint32_t dlat, dlon, X, Y;
  if (lat_e7 < g->lat0_e7 || lon_e7 < g->lon0_e7) return 0;
  dlat = (uint32_t)lat_e7 - (uint32_t)g->lat0_e7;
  dlon = (uint32_t)lon_e7 - (uint32_t)g->lon0_e7;
  Y = wb_scale(dlat, g->lat_u);
  X = wb_scale(dlon, g->lon_u);
  if (X >= 0x1000000u || Y >= 0x1000000u) return 0;
  *x = X;
  *y = Y;
  return 1;
}

void wb_point(const wb_grid *g, uint32_t x, uint32_t y, int32_t point_e7[2]) {
  point_e7[0] = (int32_t)((uint32_t)g->lat0_e7 + wb_scale(y, g->lat_e));
  point_e7[1] = (int32_t)((uint32_t)g->lon0_e7 + wb_scale(x, g->lon_e));
}

/* One version 2 node (E7, D1b), node index n: X and Y in 1/16 m units (stored halved), the next index
 * (WB_NIL on the route: delta 0), the ride distance in dm (bits 51-62, 2 m steps since version 3) and the grey flag
 * (bit 63). The next index is n plus a signed 13-bit delta; a value that names no node is refused by the
 * caller (load_node). */
typedef struct { uint32_t x, y, next, dist, grey; } wb_node;
static void node_parse(uint32_t n, const uint8_t *r, wb_node *o) {
  uint32_t lo = wb_u32(r), hi = wb_u32(r + 4), d = (hi >> 6) & 0x1FFFu;
  o->x = 2u * (lo & 0x7FFFFu);
  o->y = 2u * ((lo >> 19) | ((hi & 0x3Fu) << 13));
  o->next = d == 0u ? WB_NIL : (uint32_t)((int32_t)n + (d >= 4096u ? (int32_t)d - 8192 : (int32_t)d));
  o->dist = ((hi >> 19) & 0xFFFu) * 20u;                  /* version 3: 2 m steps (cc27) */
  o->grey = hi >> (WB_NODE_GREY_BIT - 32u);
}

static int load_node(const wb_engine *e, uint32_t n, wb_node *o) {
  uint8_t r[WB_NODE_BYTES];
  if (n >= e->node_count) return 0;
  if (!rd(e, e->off_nodes + n * WB_NODE_BYTES, r, WB_NODE_BYTES)) return 0;
  node_parse(n, r, o);
  return 1;
}

/* Index of the first cell whose key is not less than key. Returns 0 on a read failure. */
static int find_row(const wb_engine *e, uint32_t key, uint32_t *at) {
  uint8_t r[4];
  uint32_t lo = 0u, hi = e->cell_count;
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo) / 2u;
    if (!rd(e, WB_HEADER_BYTES + mid * WB_CELL_BYTES, r, 4u)) return 0;
    if (wb_u32(r) < key) lo = mid + 1u;
    else hi = mid;
  }
  *at = lo;
  return 1;
}

/* 1 when a coordinate v lies outside the box [lo, hi] by more than the near limit: no point of a piece that
 * starts at v can then be 15 m or less from the box. A piece is at most 1,700 units long on each axis. For
 * lo = hi = c this is the old test "far" of the rider at c. Requires lo <= hi. */
static int wb_out(uint32_t v, uint32_t lo, uint32_t hi) {
  return v - lo + WB_NEAR > (hi - lo) + 2u * WB_NEAR;
}

/* Returns 1 and sets *d2 (units squared) and *t (0..256 from A to B), or 0 to skip the piece. */
static int wb_measure(int32_t ax, int32_t ay, int32_t bx, int32_t by, uint32_t *d2, uint32_t *t) {
  int32_t dx, dy, dot, cx, cy;
  uint32_t l2, q;
  if (ax < -4095 || ax > 4095 || ay < -4095 || ay > 4095) return 0;
  dx = bx - ax;
  dy = by - ay;
  if (dx < -1700 || dx > 1700 || dy < -1700 || dy > 1700) return 0;
  l2 = (uint32_t)(dx * dx + dy * dy);
  if (!l2) return 0;
  dot = -(ax * dx + ay * dy);
  q = dot <= 0 ? 0u : (uint32_t)dot >= l2 ? 256u : (uint32_t)dot * 256u / l2;
  cx = ax + dx * (int32_t)q / 256;
  cy = ay + dy * (int32_t)q / 256;
  *d2 = (uint32_t)(cx * cx + cy * cy);
  *t = q;
  return 1;
}

size_t wb_size(void) {
  return sizeof(struct wb_engine);
}

int wb_mount(wb_engine *e, wb_reader r, void *ctx, uint32_t file_bytes, const uint8_t route_id[16]) {
  uint8_t h[WB_HEADER_BYTES], s[WB_CELL_BYTES];
  uint32_t i, version, flags, node_count, cell_count, extra_count, chunk_count, off_cells, total;
  e->mounted = 0;
  e->has_line = 0;
  e->reader = r;
  e->ctx = ctx;
  e->file_bytes = file_bytes;
  if (!r || file_bytes < WB_HEADER_BYTES) return 0;
  if (!rd(e, 0u, h, WB_HEADER_BYTES)) return 0;
  if (h[0] != 'C' || h[1] != 'C' || h[2] != 'W' || h[3] != 'B') return 0;
  version = rd_u16(h + 4);
  if (version != 3u) return 0;                           /* versions 1 and 2 are refused (cc27) */
  flags = rd_u16(h + 6);
  if (flags & 1u) return 0;                              /* version 2 has no exception lists */
  for (i = 0; i < 16u; i++) if (h[8 + i] != route_id[i]) return 0;
  if (wb_u32(h + 32) == 0u || wb_u32(h + 36) == 0u || wb_u32(h + 40) == 0u || wb_u32(h + 44) == 0u) return 0;
  node_count = wb_u32(h + 48);
  cell_count = wb_u32(h + 52);
  extra_count = wb_u32(h + 56);
  chunk_count = wb_u32(h + 60);
  if (chunk_count != 0u) return 0;                       /* version 2 has no exception lists */
  if (node_count >= 0xFFFFFFu || extra_count >= 0xFFFFFFu || cell_count > node_count) return 0;

  off_cells = WB_HEADER_BYTES;
  e->off_nodes = off_cells + (cell_count + 1u) * WB_CELL_BYTES;
  e->off_extras = e->off_nodes + node_count * WB_NODE_BYTES;
  total = e->off_extras + extra_count * WB_EXTRA_BYTES;
  if (total != file_bytes) return 0;                     /* cc27: grey is its own section (type 2), no tail; counts < 2^24: no overflow */

  /* The sentinel cell record must follow the last cell: key, node count and extra count. */
  if (!rd(e, off_cells + cell_count * WB_CELL_BYTES, s, WB_CELL_BYTES)) return 0;
  if (wb_u32(s) != 0xFFFFFFFFu || wb_u32(s + 4) != node_count || wb_u32(s + 8) != extra_count) return 0;

  e->lat0_e7 = (int32_t)wb_u32(h + 24);
  e->lon0_e7 = (int32_t)wb_u32(h + 28);
  e->lat_u = wb_u32(h + 32);
  e->lon_u = wb_u32(h + 36);
  e->lat_e = wb_u32(h + 40);
  e->lon_e = wb_u32(h + 44);
  e->node_count = node_count;
  e->cell_count = cell_count;
  e->extra_count = extra_count;
  e->mounted = 1;
  return 1;
}


void wb_unmount(wb_engine *e) {
  e->mounted = 0;
  e->has_line = 0;
}

/* The cell rectangle of one scan. Rows cy0..cy1 in order; in each row the cells cx0..cx1 in order; in each cell the
 * tree pieces (nodes in index order), then the extra pieces. Pieces whose start node is outside the box are not visited. */
int wb_scan(wb_engine *e, uint32_t cx0, uint32_t cy0, uint32_t cx1, uint32_t cy1,
            uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1, wb_visit visit, void *ctx) {
  uint8_t cb[WB_ROW_CELLS * WB_CELL_BYTES], buf[WB_BLOCK];
  uint32_t cy;
  if (cx1 < cx0 || cy1 < cy0 || cx1 - cx0 > WB_ROW_CELLS - 2u) return 0;
  if (x1 < x0 || y1 < y0) return 0;
  for (cy = cy0; cy <= cy1; cy++) {
    uint32_t klo = (cy << 16) | cx0, khi = (cy << 16) | cx1, at, cnt, c;
    if (!find_row(e, klo, &at)) return 0;
    cnt = e->cell_count + 1u - at;
    if (cnt > WB_ROW_CELLS) cnt = WB_ROW_CELLS;
    if (!rd(e, WB_HEADER_BYTES + at * WB_CELL_BYTES, cb, cnt * WB_CELL_BYTES)) return 0;
    for (c = 0u; c + 1u < cnt && wb_u32(cb + c * WB_CELL_BYTES) <= khi; c++) {
      const uint8_t *q = cb + c * WB_CELL_BYTES;
      uint32_t n0 = wb_u32(q + 4), n1 = wb_u32(q + 16), x0c = wb_u32(q + 8), x1c = wb_u32(q + 20), i, k, m;
      if (n1 > e->node_count || x1c > e->extra_count) return 0;
      for (i = n0; i < n1; i += m) {
        m = n1 - i;
        if (m > WB_BLOCK / WB_NODE_BYTES) m = WB_BLOCK / WB_NODE_BYTES;
        if (!rd(e, e->off_nodes + i * WB_NODE_BYTES, buf, m * WB_NODE_BYTES)) return 0;
        for (k = 0u; k < m; k++) {
          wb_node u, v;
          wb_cand cc;
          node_parse(i + k, buf + k * WB_NODE_BYTES, &u);
          if (u.next == WB_NIL || wb_out(u.x, x0, x1) || wb_out(u.y, y0, y1)) continue;
          if (u.next >= i && u.next < i + m) node_parse(u.next, buf + (u.next - i) * WB_NODE_BYTES, &v);
          else if (!load_node(e, u.next, &v)) return 0;
          if (u.dist < v.dist) continue;
          cc.id = i + k; cc.a = i + k; cc.b = u.next; cc.da = u.dist; cc.db = v.dist; cc.len = u.dist - v.dist;
          cc.bits = u.grey ? WB_GREY_BITS : 0u; cc.vn = v.next;
          cc.xa = u.x; cc.ya = u.y; cc.xb = v.x; cc.yb = v.y;
          if (!visit(ctx, &cc)) return 1;
        }
      }
      for (i = x0c; i < x1c; i += m) {
        m = x1c - i;
        if (m > WB_BLOCK / WB_EXTRA_BYTES) m = WB_BLOCK / WB_EXTRA_BYTES;
        if (!rd(e, e->off_extras + i * WB_EXTRA_BYTES, buf, m * WB_EXTRA_BYTES)) return 0;
        for (k = 0u; k < m; k++) {
          const uint8_t *rec = buf + k * WB_EXTRA_BYTES;
          uint32_t ea = rd_u24(rec), eb = rd_u24(rec + 3), lf = rd_u16(rec + 6);
          wb_node a, b;
          wb_cand cc;
          if (!(lf & 0xC000u)) continue;
          if (!load_node(e, ea, &a)) return 0;
          if (wb_out(a.x, x0, x1) || wb_out(a.y, y0, y1)) continue;
          if (!load_node(e, eb, &b)) return 0;
          cc.id = WB_EXTRA_FLAG | (i + k); cc.a = ea; cc.b = eb; cc.da = a.dist; cc.db = b.dist;
          cc.len = lf & WB_EXTRA_LEN_MASK;
          cc.bits = ((lf >> 14) & 1u) | (((lf >> 15) & 1u) << 1) | ((lf & WB_EXTRA_GREY) ? WB_GREY_BITS : 0u);
          cc.vn = 0u;
          cc.xa = a.x; cc.ya = a.y; cc.xb = b.x; cc.yb = b.y;
          if (!visit(ctx, &cc)) return 1;
        }
      }
    }
  }
  return 1;
}

/* Field by field: a struct assignment would call memcpy, and the unit has no C library. */
static void cand_set(wb_cand *d, const wb_cand *s) {
  d->id = s->id; d->a = s->a; d->b = s->b; d->da = s->da; d->db = s->db; d->len = s->len;
  d->bits = s->bits; d->vn = s->vn; d->xa = s->xa; d->ya = s->ya; d->xb = s->xb; d->yb = s->yb;
}

static int pick_visit(void *vp, const wb_cand *c) {
  wb_pick *p = (wb_pick *)vp;
  uint32_t d2, t;
  if (!wb_measure((int32_t)c->xa - (int32_t)p->X, (int32_t)c->ya - (int32_t)p->Y,
                  (int32_t)c->xb - (int32_t)p->X, (int32_t)c->yb - (int32_t)p->Y, &d2, &t)) return 1;
  if (!p->have || d2 < p->d2) {
    cand_set(&p->cand, c);
    p->d2 = d2;
    p->t = t;
    p->have = 1;
  }
  return 1;
}

static void prev_take(wb_engine *e, wb_prev *p) {
  p->has = e->has_line;
  p->kind = e->kind;
  p->a = e->a;
  p->b = e->b;
  e->has_line = 0;
  e->npts = WB_NIL;
}

static void out_reset(wb_output *out) {
  out->state = WB_NONE;
  out->reason = WB_OK;
  out->distance_dm = 0;
  out->forward = 0;
  out->changed = 0;
  out->piece = WB_NIL;
}

/* The end choice, the change test and the output of a chosen piece (the end of wb_tick). */
static void wb_commit(wb_engine *e, const wb_cand *c, uint32_t t, const wb_prev *pr, wb_output *out) {
  uint32_t kind = (c->id & WB_EXTRA_FLAG) ? 2u : 1u, end = WB_NIL, end_first = 0u, end_dist = 0u, way, dist_dm;
  int changed = !pr->has || kind != pr->kind || c->a != pr->a || c->b != pr->b;
  int32_t p[2];
  wb_grid g;
  if (changed) {
    if (kind == 1u) {
      end = c->b;
      end_dist = c->db;
    } else {
      uint32_t cost_a = 0xFFFFFFFFu, cost_b = 0xFFFFFFFFu, use_a = 0u;
      if (c->bits & 1u) cost_a = c->len * t / 256u + c->da;
      if (c->bits & 2u) cost_b = c->len * (256u - t) / 256u + c->db;
      if (c->bits & 1u) use_a = (!(c->bits & 2u) || cost_a <= cost_b) ? 1u : 0u;
      end_first = use_a;
      end = use_a ? c->a : c->b;
      end_dist = use_a ? c->da : c->db;
    }
    e->kind = (uint8_t)kind;
    e->a = c->a;
    e->b = c->b;
    e->len = c->len;
    e->end = end;
    e->end_first = (uint8_t)end_first;
    e->end_dm = end_dist;
  }
  out->changed = changed ? 1u : 0u;
  out->forward = 0u;
  way = e->end_first ? c->len * t / 256u : c->len * (256u - t) / 256u;
  dist_dm = way + e->end_dm;
  {
    int32_t dxp = (int32_t)c->xb - (int32_t)c->xa, dyp = (int32_t)c->yb - (int32_t)c->ya;
    int32_t px = (int32_t)c->xa + dxp * (int32_t)t / 256, py = (int32_t)c->ya + dyp * (int32_t)t / 256;
    wb_grid_get(e, &g);
    wb_point(&g, (uint32_t)px, (uint32_t)py, p);
    e->p_lat = p[0];
    e->p_lon = p[1];
  }
  e->has_line = 1;
  out->state = WB_LINE;
  out->reason = WB_OK;
  out->distance_dm = dist_dm;
  out->piece = c->id & 0x00FFFFFFu;
}

void wb_tick(wb_engine *e, const wb_input *in, wb_output *out) {
  wb_grid g;
  wb_pick pk;
  wb_prev pr;
  uint32_t X, Y, cx, cy;
  out_reset(out);
  prev_take(e, &pr);
  pk.have = 0;
  if (!e->mounted) { out->reason = WB_NO_FILE; return; }
  if (!(in->flags & WB_GPS_VALID)) { out->reason = WB_GPS; return; }
  if (!(in->flags & WB_OFF_ROUTE)) { out->reason = WB_ON_ROUTE; return; }
  wb_grid_get(e, &g);
  if (!wb_units(&g, in->lat_e7, in->lon_e7, &X, &Y)) { out->reason = WB_NO_STREET; return; }
  cx = X >> 11;
  cy = Y >> 11;
  pk.X = X;
  pk.Y = Y;
  /* The 3 x 3 cells around the rider (clamped at 0), with the box of the rider point itself. */
  if (!wb_scan(e, cx > 0u ? cx - 1u : 0u, cy > 0u ? cy - 1u : 0u, cx + 1u, cy + 1u, X, Y, X, Y, pick_visit, &pk)) {
    out->reason = WB_READ;
    return;
  }
  if (!pk.have || pk.d2 > WB_D2_LIMIT) { out->reason = WB_NO_STREET; return; }
  wb_commit(e, &pk.cand, pk.t, &pr, out);
}

void wb_line_info(const wb_engine *e, uint32_t info[3]) {
  info[0] = e->end_dm;
  info[1] = e->len;
  info[2] = e->end_first;
}

int wb_read_point(wb_engine *e, uint32_t index, int32_t point_e7[2]) {
  uint32_t n;
  wb_node o;
  wb_grid grid;
  if (!e->has_line || index >= WB_MAX_POINTS) return 0;
  if (index == 0u) {
    if (e->npts != WB_NIL) return 0;
    point_e7[0] = e->p_lat;
    point_e7[1] = e->p_lon;
    e->npts = 0u;
    return 1;
  }
  if (index == 1u) {
    if (e->npts != 0u) return 0;
    n = e->end;
  } else {
    if (e->npts != index - 1u || e->cur_next == WB_NIL) return 0;
    n = e->cur_next;
  }
  if (!load_node(e, n, &o)) { e->has_line = 0; return 0; }
  e->cur_next = o.next;
  wb_grid_get(e, &grid);
  wb_point(&grid, o.x, o.y, point_e7);
  e->npts = index;
  return 1;
}
