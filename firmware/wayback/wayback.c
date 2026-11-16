/* Way-back core: finds the street piece near the rider and follows the stored next values.
 * Integer code only: no float, no heap, no 64-bit division. The only library-free helper that
 * touches memory is the reader callback. Layout and rules: docs/current/way-back-tree-plan-2026-11-16.md. */
#include "wayback.h"

#define WB_HEADER_BYTES 64u
#define WB_CELL_BYTES 12u
#define WB_NODE_BYTES 12u
#define WB_EXTRA_BYTES 8u
#define WB_EXC_BYTES 8u
#define WB_NIL 0xFFFFFFFFu
#define WB_NO_CHUNK 0xFFFFFFFFu
#define WB_D2_LIMIT 57600u          /* 15 m = 240 units; 240 * 240 */
#define WB_MAX_POINTS 4096u
#define WB_MAX_CHUNKS 4096u
#define WB_FWD_STEPS 64u            /* forward walk limit for the distance to the route */
#define WB_EXTRA_LEN_MASK 0x3FFFu   /* extra piece length in 0.1 m */

struct wb_engine {
  wb_reader reader;
  void *ctx;
  uint32_t file_bytes;
  int32_t lat0_e7, lon0_e7;
  uint32_t lat_u, lon_u, lat_e, lon_e;
  uint32_t node_count, cell_count, extra_count, chunk_count;
  uint32_t off_nodes, off_extras, off_chunks, off_exc;
  uint8_t mounted, has_line, kind, end_first;
  uint8_t fwd, pad0, pad1, pad2;
  uint32_t a, b, len, end, end_dm, chunk, cur_next, npts;
  int32_t p_lat, p_lon;
};

/* 128 bytes on the 32-bit device; host pointers are 8 bytes wide, so the host limit is larger. */
#define WB_ENGINE_MAX (128u + 2u * (sizeof(void *) - 4u))
_Static_assert(sizeof(struct wb_engine) <= WB_ENGINE_MAX, "wb_engine is larger than 128 bytes on the device");

typedef struct {
  uint32_t d2, t, kind, a, b, da, db, len, bits, vn, xa, ya, xb, yb;
} wb_piece;

static void piece_zero(wb_piece *p) {
  p->d2 = 0; p->t = 0; p->kind = 0; p->a = 0; p->b = 0; p->da = 0; p->db = 0;
  p->len = 0; p->bits = 0; p->vn = 0; p->xa = 0; p->ya = 0; p->xb = 0; p->yb = 0;
}

static void piece_set(wb_piece *d, const wb_piece *s) {
  d->d2 = s->d2; d->t = s->t; d->kind = s->kind; d->a = s->a; d->b = s->b; d->da = s->da; d->db = s->db;
  d->len = s->len; d->bits = s->bits; d->vn = s->vn; d->xa = s->xa; d->ya = s->ya; d->xb = s->xb; d->yb = s->yb;
}

static uint32_t rd_u16(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8);
}

static uint32_t rd_u24(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16);
}

static uint32_t rd_u32(const uint8_t *p) {
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

static void wb_to_e7(const wb_engine *e, uint32_t x, uint32_t y, int32_t p[2]) {
  p[0] = (int32_t)((uint32_t)e->lat0_e7 + wb_scale(y, e->lat_e));
  p[1] = (int32_t)((uint32_t)e->lon0_e7 + wb_scale(x, e->lon_e));
}

/* One node record: X, Y, the tree A next (WB_NIL on the route) and the ride distance in dm. */
static int load_node(const wb_engine *e, uint32_t n, uint32_t *x, uint32_t *y, uint32_t *next, uint32_t *dist) {
  uint8_t r[WB_NODE_BYTES];
  uint32_t nx;
  if (n >= e->node_count) return 0;
  if (!rd(e, e->off_nodes + n * WB_NODE_BYTES, r, WB_NODE_BYTES)) return 0;
  *x = rd_u24(r);
  *y = rd_u24(r + 3);
  nx = rd_u24(r + 6);
  *next = nx == 0xFFFFFFu ? WB_NIL : nx;
  *dist = rd_u24(r + 9);
  return 1;
}

static int read_cell(const wb_engine *e, uint32_t i, uint32_t *key, uint32_t *first_node, uint32_t *first_extra) {
  uint8_t r[WB_CELL_BYTES];
  if (!rd(e, WB_HEADER_BYTES + i * WB_CELL_BYTES, r, WB_CELL_BYTES)) return 0;
  *key = rd_u32(r);
  *first_node = rd_u32(r + 4);
  *first_extra = rd_u32(r + 8);
  return 1;
}

/* Binary search for a cell. Returns 1 found, 0 absent, -1 read failure. */
static int find_cell(const wb_engine *e, uint32_t key, uint32_t *n0, uint32_t *n1, uint32_t *x0, uint32_t *x1) {
  uint32_t lo = 0u, hi = e->cell_count, k, fn, fe, k2, fn2, fe2;
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo) / 2u;
    if (!read_cell(e, mid, &k, &fn, &fe)) return -1;
    if (k < key) lo = mid + 1u;
    else hi = mid;
  }
  if (lo >= e->cell_count) return 0;
  if (!read_cell(e, lo, &k, &fn, &fe) || !read_cell(e, lo + 1u, &k2, &fn2, &fe2)) return -1;
  if (k != key) return 0;
  *n0 = fn;
  *n1 = fn2;
  *x0 = fe;
  *x1 = fe2;
  return 1;
}

/* Exception record of node n in chunk c. Returns 1 found, 0 absent, -1 read failure. */
static int rec_find(const wb_engine *e, uint32_t c, uint32_t n, uint32_t *next, uint32_t *dist) {
  uint8_t t[8], r[WB_EXC_BYTES];
  uint32_t lo, hi;
  if (c >= e->chunk_count) return 0;
  if (!rd(e, e->off_chunks + c * 4u, t, 8u)) return -1;
  lo = rd_u32(t);
  hi = rd_u32(t + 4);
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo) / 2u, nd;
    if (!rd(e, e->off_exc + mid * WB_EXC_BYTES, r, WB_EXC_BYTES)) return -1;
    nd = rd_u24(r);
    if (nd < n) lo = mid + 1u;
    else if (nd > n) hi = mid;
    else {
      *next = rd_u24(r + 3);
      *dist = rd_u16(r + 6);
      return 1;
    }
  }
  return 0;
}

/* The next node of n on the line: the exception value in forward mode, else the tree A value.
 * Returns 0 on a read failure. The record test comes first, so a route node with a record is handled. */
static int next_of(const wb_engine *e, uint32_t n, uint32_t anext, uint32_t *out) {
  uint32_t nx = 0u, d = 0u;
  int r;
  *out = anext;
  if (!e->fwd) return 1;
  r = rec_find(e, e->chunk, n, &nx, &d);
  if (r < 0) return 0;
  if (r == 1) *out = nx;
  return 1;
}

/* Forward distance in dm from end to the route, by a walk of at most WB_FWD_STEPS nodes.
 * At the first node with a record: end_dist - dist(k) + record dist. At a route node: end_dist - dist(k).
 * Leaves *dm at WB_DIST_UNKNOWN when neither occurs. Returns 0 on a read failure. */
static int fwd_dm(const wb_engine *e, uint32_t end, uint32_t end_dist, uint32_t *dm) {
  uint32_t x = end, k;
  *dm = WB_DIST_UNKNOWN;
  for (k = 0u; k < WB_FWD_STEPS; k++) {
    uint32_t xx, xy, xn, xd, rn = 0u, rd_dist = 0u;
    int r;
    if (!load_node(e, x, &xx, &xy, &xn, &xd)) return 0;
    if (xd > end_dist) return 1;
    r = rec_find(e, e->chunk, x, &rn, &rd_dist);
    if (r < 0) return 0;
    if (r == 1) {
      *dm = end_dist - xd + rd_dist * 10u;
      return 1;
    }
    if (xn == WB_NIL) {
      *dm = end_dist - xd;
      return 1;
    }
    x = xn;
  }
  return 1;
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
  uint8_t h[WB_HEADER_BYTES], t[8];
  uint32_t i, version, flags, node_count, cell_count, extra_count, chunk_count, exc_count, off_cells, total;
  e->mounted = 0;
  e->has_line = 0;
  e->reader = r;
  e->ctx = ctx;
  e->file_bytes = file_bytes;
  if (!r || file_bytes < WB_HEADER_BYTES) return 0;
  if (!rd(e, 0u, h, WB_HEADER_BYTES)) return 0;
  if (h[0] != 'C' || h[1] != 'C' || h[2] != 'W' || h[3] != 'B') return 0;
  version = rd_u16(h + 4);
  if (version != 1u) return 0;
  flags = rd_u16(h + 6);
  for (i = 0; i < 16u; i++) if (h[8 + i] != route_id[i]) return 0;
  if (rd_u32(h + 32) == 0u || rd_u32(h + 36) == 0u || rd_u32(h + 40) == 0u || rd_u32(h + 44) == 0u) return 0;
  node_count = rd_u32(h + 48);
  cell_count = rd_u32(h + 52);
  extra_count = rd_u32(h + 56);
  chunk_count = rd_u32(h + 60);
  if (node_count >= 0xFFFFFFu || extra_count >= 0xFFFFFFu || cell_count > node_count) return 0;
  if (chunk_count > WB_MAX_CHUNKS) return 0;
  if (((flags & 1u) != 0u) != (chunk_count != 0u)) return 0;

  off_cells = WB_HEADER_BYTES;
  e->off_nodes = off_cells + (cell_count + 1u) * WB_CELL_BYTES;
  e->off_extras = e->off_nodes + node_count * WB_NODE_BYTES;
  e->off_chunks = e->off_extras + extra_count * WB_EXTRA_BYTES;
  e->off_exc = e->off_chunks + (chunk_count ? (chunk_count + 1u) * 4u : 0u);
  if (e->off_exc > file_bytes) return 0;

  exc_count = 0u;
  if (chunk_count) {
    if (!rd(e, e->off_chunks, t, 4u) || rd_u32(t) != 0u) return 0;
    if (!rd(e, e->off_chunks + chunk_count * 4u, t, 4u)) return 0;
    exc_count = rd_u32(t);
    if (exc_count > 0xFFFFFu) return 0;
  }
  total = e->off_exc + exc_count * WB_EXC_BYTES;
  if (total != file_bytes) return 0;

  /* The sentinel cell record must follow the last cell. */
  if (!rd(e, off_cells + cell_count * WB_CELL_BYTES, t, 8u)) return 0;
  if (rd_u32(t) != 0xFFFFFFFFu || rd_u32(t + 4) != node_count) return 0;

  e->lat0_e7 = (int32_t)rd_u32(h + 24);
  e->lon0_e7 = (int32_t)rd_u32(h + 28);
  e->lat_u = rd_u32(h + 32);
  e->lon_u = rd_u32(h + 36);
  e->lat_e = rd_u32(h + 40);
  e->lon_e = rd_u32(h + 44);
  e->node_count = node_count;
  e->cell_count = cell_count;
  e->extra_count = extra_count;
  e->chunk_count = chunk_count;
  e->fwd = 0;
  e->mounted = 1;
  return 1;
}

void wb_unmount(wb_engine *e) {
  e->mounted = 0;
  e->has_line = 0;
}

void wb_tick(wb_engine *e, const wb_input *in, wb_output *out) {
  wb_piece best, cand;
  uint32_t X, Y, dlat, dlon, prev_kind, prev_a, prev_b, prev_chunk, chunk = WB_NO_CHUNK;
  uint32_t end = WB_NIL, end_first = 0u, end_dist = 0u, end_dm = WB_DIST_UNKNOWN, way, dist_dm;
  int prev, have = 0, changed, fwd = 0, dy, dx, r;
  int32_t p[2];

  out->state = WB_NONE;
  out->reason = WB_OK;
  out->distance_dm = 0;
  out->forward = 0;
  out->changed = 0;
  prev = e->has_line;
  prev_kind = e->kind;
  prev_a = e->a;
  prev_b = e->b;
  prev_chunk = e->chunk;
  e->has_line = 0;
  e->npts = WB_NIL;
  piece_zero(&best);
  piece_zero(&cand);

  if (!e->mounted) { out->reason = WB_NO_FILE; return; }
  if (!(in->flags & WB_GPS_VALID)) { out->reason = WB_GPS; return; }
  if (!(in->flags & WB_OFF_ROUTE)) { out->reason = WB_ON_ROUTE; return; }
  if (in->lat_e7 < e->lat0_e7 || in->lon_e7 < e->lon0_e7) { out->reason = WB_NO_STREET; return; }
  dlat = (uint32_t)in->lat_e7 - (uint32_t)e->lat0_e7;
  dlon = (uint32_t)in->lon_e7 - (uint32_t)e->lon0_e7;
  Y = wb_scale(dlat, e->lat_u);
  X = wb_scale(dlon, e->lon_u);
  if (X >= 0x1000000u || Y >= 0x1000000u) { out->reason = WB_NO_STREET; return; }

  /* Forward mode: a trusted exit whose km is in the file. */
  if ((in->flags & WB_EXIT_TRUSTED) && e->chunk_count > 0u) {
    uint32_t c = in->exit_progress_cm / 100000u;
    if (c < e->chunk_count) { chunk = c; fwd = 1; }
  }

  for (dy = -1; dy <= 1; dy++) {
    for (dx = -1; dx <= 1; dx++) {
      int32_t cx = (int32_t)(X >> 11) + dx, cy = (int32_t)(Y >> 11) + dy;
      uint32_t key, n0, n1, x0, x1, i, j;
      if (cx < 0 || cy < 0) continue;
      key = ((uint32_t)cy << 16) | (uint32_t)cx;
      r = find_cell(e, key, &n0, &n1, &x0, &x1);
      if (r < 0) { out->reason = WB_READ; return; }
      if (r == 0) continue;
      for (i = n0; i < n1; i++) {
        uint32_t ux, uy, un, ud, vx, vy, vn, vd, d2, t;
        if (!load_node(e, i, &ux, &uy, &un, &ud)) { out->reason = WB_READ; return; }
        if (un == WB_NIL) continue;
        if (!load_node(e, un, &vx, &vy, &vn, &vd)) { out->reason = WB_READ; return; }
        if (ud < vd) continue;
        if (!wb_measure((int32_t)ux - (int32_t)X, (int32_t)uy - (int32_t)Y,
                        (int32_t)vx - (int32_t)X, (int32_t)vy - (int32_t)Y, &d2, &t)) continue;
        cand.d2 = d2; cand.t = t; cand.kind = 1u; cand.a = i; cand.b = un;
        cand.da = ud; cand.db = vd; cand.len = ud - vd; cand.bits = 0u; cand.vn = vn;
        cand.xa = ux; cand.ya = uy; cand.xb = vx; cand.yb = vy;
        if (!have || d2 < best.d2) { piece_set(&best, &cand); have = 1; }
      }
      for (j = x0; j < x1; j++) {
        uint8_t rec[WB_EXTRA_BYTES];
        uint32_t ea, eb, lf, xa, ya, xb, yb, da, db, dummy, d2, t;
        if (!rd(e, e->off_extras + j * WB_EXTRA_BYTES, rec, WB_EXTRA_BYTES)) { out->reason = WB_READ; return; }
        ea = rd_u24(rec);
        eb = rd_u24(rec + 3);
        lf = rd_u16(rec + 6);
        if (!(lf & 0xC000u)) continue;
        if (!load_node(e, ea, &xa, &ya, &dummy, &da)) { out->reason = WB_READ; return; }
        if (!load_node(e, eb, &xb, &yb, &dummy, &db)) { out->reason = WB_READ; return; }
        if (!wb_measure((int32_t)xa - (int32_t)X, (int32_t)ya - (int32_t)Y,
                        (int32_t)xb - (int32_t)X, (int32_t)yb - (int32_t)Y, &d2, &t)) continue;
        cand.d2 = d2; cand.t = t; cand.kind = 2u; cand.a = ea; cand.b = eb;
        cand.da = da; cand.db = db; cand.len = lf & WB_EXTRA_LEN_MASK;
        cand.bits = ((lf >> 14) & 1u) | (((lf >> 15) & 1u) << 1);
        cand.vn = 0u;
        cand.xa = xa; cand.ya = ya; cand.xb = xb; cand.yb = yb;
        if (!have || d2 < best.d2) { piece_set(&best, &cand); have = 1; }
      }
    }
  }
  if (!have || best.d2 > WB_D2_LIMIT) { out->reason = WB_NO_STREET; return; }

  changed = !prev || best.kind != prev_kind || best.a != prev_a || best.b != prev_b || chunk != prev_chunk;
  if (changed) {
    e->fwd = (uint8_t)fwd;
    e->chunk = chunk;
    if (best.kind == 1u) {
      uint32_t ev = WB_NIL;
      if (fwd) {
        /* The end is the piece's first node when the forward next of the second node is the first node. */
        if (!next_of(e, best.b, best.vn, &ev)) { out->reason = WB_READ; return; }
        end_first = ev == best.a ? 1u : 0u;
      }
      end = end_first ? best.a : best.b;
      end_dist = end_first ? best.da : best.db;
    } else {
      uint32_t cost_a = 0xFFFFFFFFu, cost_b = 0xFFFFFFFFu, use_a = 0u;
      if (best.bits & 1u) cost_a = best.len * best.t / 256u + best.da;
      if (best.bits & 2u) cost_b = best.len * (256u - best.t) / 256u + best.db;
      if (best.bits & 1u) use_a = (!(best.bits & 2u) || cost_a <= cost_b) ? 1u : 0u;
      end_first = use_a;
      end = use_a ? best.a : best.b;
      end_dist = use_a ? best.da : best.db;
    }
    if (!fwd) end_dm = end_dist;
    else if (!fwd_dm(e, end, end_dist, &end_dm)) { out->reason = WB_READ; return; }
    e->kind = (uint8_t)best.kind;
    e->a = best.a;
    e->b = best.b;
    e->len = best.len;
    e->end = end;
    e->end_first = (uint8_t)end_first;
    e->end_dm = end_dm;
  }
  out->changed = changed ? 1u : 0u;
  out->forward = e->fwd;

  if (e->end_dm == WB_DIST_UNKNOWN) {
    dist_dm = WB_DIST_UNKNOWN;
  } else {
    way = e->end_first ? best.len * best.t / 256u : best.len * (256u - best.t) / 256u;
    dist_dm = way + e->end_dm;
  }

  {
    int32_t dxp = (int32_t)best.xb - (int32_t)best.xa, dyp = (int32_t)best.yb - (int32_t)best.ya;
    int32_t px = (int32_t)best.xa + dxp * (int32_t)best.t / 256, py = (int32_t)best.ya + dyp * (int32_t)best.t / 256;
    wb_to_e7(e, (uint32_t)px, (uint32_t)py, p);
    e->p_lat = p[0];
    e->p_lon = p[1];
  }
  e->has_line = 1;
  out->state = WB_LINE;
  out->reason = WB_OK;
  out->distance_dm = dist_dm;
}

int wb_read_point(wb_engine *e, uint32_t index, int32_t point_e7[2]) {
  uint32_t x, y, nx, d, n;
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
  if (!load_node(e, n, &x, &y, &nx, &d)) { e->has_line = 0; return 0; }
  if (!next_of(e, n, nx, &e->cur_next)) { e->has_line = 0; return 0; }
  wb_to_e7(e, x, y, point_e7);
  e->npts = index;
  return 1;
}
