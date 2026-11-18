/* Host harness for firmware/mapdec/mapdec.c (cc25, E4). Built with -DHOST.
 * Usage: mapdec_host RECORDS MODE FAIL_AT
 *   RECORDS: repeated records of a u32 little-endian length and the block bytes. Each record is one load.
 *   MODE: normal, or othercb (the stream callback is not the buffer reader, so E4 rule 1 applies).
 *   FAIL_AT: 0, or the 1-based allocation that returns NULL.
 * The load follows the stock sequence (0x420494d0): free the old entries (0x4204944c), clear the message,
 * decode the block (field 1 = count, field 2 = entry records, callback = cc_entries), then set the header.
 * Host guard (not in stock): a block that gives no array has count 0 and loaded 0 (flag guard = 1 when the
 * block had a count). md_host_stock models the stock entries callback for protobuf entries.
 * The allocator aborts on a double free. Prints one JSON line per record, then one final line. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../firmware/mapdec/mapdec.h"

uint32_t md_host_count;
void *md_host_array;

typedef struct { uint8_t pad[20]; uint32_t count; void *array; uint32_t loaded; } hdr_t;   /* count +20, array +24 */
static hdr_t hdr;
static void *msg_arg;
static uint32_t n_alloc, fail_at, n_live, n_stock, n_errs, n_records;
#define LIVE_MAX 400000u
#define RC_MAX 64u
static void *live[LIVE_MAX];

void *md_host_malloc(uint32_t size, uint32_t caps) {
  void *p;
  (void)caps;
  n_alloc++;
  if (fail_at && n_alloc == fail_at) return NULL;
  if (n_live >= LIVE_MAX) abort();
  p = calloc(1, size ? size : 1);
  if (!p) return NULL;
  live[n_live++] = p;
  return p;
}

void md_host_free(void *p) {
  uint32_t i;
  for (i = 0; i < n_live; i++) {
    if (live[i] == p) { live[i] = live[--n_live]; free(p); return; }
  }
  abort();   /* a double free, or a pointer that was never allocated */
}

int md_host_buf_read(pb_istream_t *s, uint8_t *buf, uint32_t n) { (void)s; (void)buf; (void)n; return 0; }
static int md_host_other_read(pb_istream_t *s, uint8_t *buf, uint32_t n) { (void)s; (void)buf; (void)n; return 0; }

/* protobuf reader for the stock model and the outer block */
typedef struct { const uint8_t *p; uint32_t left; } rd_t;
static int rd_v(rd_t *r, uint64_t *v) {
  uint32_t sh = 0;
  *v = 0;
  for (;;) {
    uint8_t b;
    if (!r->left || sh > 63) return 0;
    b = *r->p++;
    r->left--;
    *v |= (uint64_t)(b & 127u) << sh;
    sh += 7;
    if (!(b & 128u)) return 1;
  }
}
static int rd_zz(rd_t *r, int32_t *v) {
  uint64_t u;
  if (!rd_v(r, &u)) return 0;
  *v = (int32_t)(((uint32_t)u >> 1) ^ (0u - ((uint32_t)u & 1u)));
  return 1;
}
static int rd_skip(rd_t *r, uint64_t n) {
  if (n > r->left) return 0;
  r->p += n;
  r->left -= (uint32_t)n;
  return 1;
}

/* Stock entries callback (protobuf): one entry record per call. The array is allocated once (count from the message). */
int md_host_stock(pb_istream_t *s, const void *field, void **arg) {
  rd_t r;
  hdr_t *h = (hdr_t *)*arg;
  uint32_t N = md_host_count, n = 0, style = 0, cnt = 0, k = 0;
  int32_t lat = 0, lon = 0;
  uint8_t *pts = NULL, *arr;
  uint64_t f, v, len;
  int ok = 1;
  (void)field;
  n_stock++;
  r.p = s->state;
  r.left = s->bytes_left;
  if (!md_host_array && N) {
    arr = (uint8_t *)md_host_malloc(MD_ARR_BYTES(N), 0x404u);
    if (!arr) { ok = 0; }
    else { memset(arr, 0, MD_ARR_BYTES(N)); md_host_array = arr; h->array = arr; }
  }
  while (ok && r.left) {
    uint32_t fld, wt;
    if (!rd_v(&r, &f)) { ok = 0; break; }
    fld = (uint32_t)(f >> 3);
    wt = (uint32_t)(f & 7u);
    if (wt == 0) {
      if (fld == 3 || fld == 4) {
        int32_t z;
        if (!rd_zz(&r, &z)) { ok = 0; break; }
        if (fld == 3) lat = z; else lon = z;
      } else {
        if (!rd_v(&r, &v)) { ok = 0; break; }
        if (fld == 1) n = (uint32_t)v;
        else if (fld == 2) style = (uint32_t)v;
        else if (fld == 5) cnt = (uint32_t)v;
      }
    } else if (wt == 2) {
      if (!rd_v(&r, &len) || len > r.left) { ok = 0; break; }
      if (fld == 6) {
        rd_t q;
        int32_t a = 0, b = 0;
        uint64_t g;
        q.p = r.p;
        q.left = (uint32_t)len;
        while (ok && q.left) {
          if (!rd_v(&q, &g)) { ok = 0; break; }
          if (g == 0x08) { if (!rd_zz(&q, &a)) ok = 0; }
          else if (g == 0x10) { if (!rd_zz(&q, &b)) ok = 0; }
          else ok = 0;
        }
        if (ok) {
          if (!pts && cnt) {
            pts = (uint8_t *)md_host_malloc(8u * cnt, 0x404u);
            if (!pts) ok = 0;
          }
          if (ok && pts && k < cnt) { md_put32(pts + 8u * k, (uint32_t)a); md_put32(pts + 8u * k + 4u, (uint32_t)b); }
          k++;
        }
      }
      if (!rd_skip(&r, len)) { ok = 0; break; }
    } else if (wt == 5) {
      if (!rd_skip(&r, 4)) { ok = 0; break; }
    } else if (wt == 1) {
      if (!rd_skip(&r, 8)) { ok = 0; break; }
    } else {
      ok = 0;
      break;
    }
  }
  if (ok && md_host_array && n < N) {
    uint8_t *e = (uint8_t *)md_host_array + MD_STRIDE * n;
    md_put32(e, n);
    md_put32(e + 4, style);
    md_put32(e + 8, (uint32_t)lat);
    md_put32(e + 12, (uint32_t)lon);
    md_put32(e + 16, cnt);
    md_putp(e + 20, pts);
  }
  if (!ok) n_errs++;
  s->state += s->bytes_left;
  s->bytes_left = 0;
  return ok;
}

/* stock free loop 0x4204944c: each pts, then the array at 0x3fc9fbe8, which is cleared (header +24 is kept) */
static void free_old(void) {
  uint32_t i;
  uint8_t *arr = (uint8_t *)md_host_array;
  if (arr) {
    for (i = 0; i < hdr.count; i++) {
      void *q = md_getp(arr + MD_STRIDE * i + 20u);
      if (q) md_host_free(q);
    }
    md_host_free(arr);
  }
  md_host_array = NULL;
}

static uint32_t rd_le32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

static uint32_t rcs_n;
static int32_t rcs[RC_MAX];
static uint32_t guard;

static void load(const uint8_t *blk, uint32_t len, int othercb) {
  rd_t r;
  uint64_t f, v, l2;
  rcs_n = 0;
  guard = 0;
  free_old();
  md_host_count = 0;
  msg_arg = &hdr;
  r.p = blk;
  r.left = len;
  while (r.left) {
    uint32_t fld, wt;
    if (!rd_v(&r, &f)) break;
    fld = (uint32_t)(f >> 3);
    wt = (uint32_t)(f & 7u);
    if (fld == 1 && wt == 0) {
      if (!rd_v(&r, &v)) break;
      md_host_count = (uint32_t)v;
    } else if (fld == 2 && wt == 2) {
      pb_istream_t s;
      int32_t rc;
      if (!rd_v(&r, &l2) || l2 > r.left) break;
      s.callback = othercb ? md_host_other_read : md_host_buf_read;
      s.state = r.p;
      s.bytes_left = (uint32_t)l2;
      s.errmsg = NULL;
      rc = cc_entries(&s, NULL, &msg_arg);
      if (rcs_n < RC_MAX) rcs[rcs_n] = rc;
      rcs_n++;
      r.p += l2;
      r.left -= (uint32_t)l2;
    } else if (wt == 0) {
      if (!rd_v(&r, &v)) break;
    } else if (wt == 2) {
      if (!rd_v(&r, &l2) || l2 > r.left) break;
      r.p += l2;
      r.left -= (uint32_t)l2;
    } else if (wt == 5) {
      if (!rd_skip(&r, 4)) break;
    } else if (wt == 1) {
      if (!rd_skip(&r, 8)) break;
    } else {
      break;
    }
  }
  if (md_host_count != 0 && md_host_array) { hdr.count = md_host_count; hdr.loaded = 1; }
  else {
    if (md_host_count != 0) guard = 1;
    hdr.count = 0;
    hdr.loaded = 0;
  }
}

static void print_record(void) {
  uint32_t i, k, shown = rcs_n < RC_MAX ? rcs_n : RC_MAX;
  uint8_t *arr = (uint8_t *)md_host_array;
  printf("{\"count\":%u,\"loaded\":%u,\"array\":%s,\"allocs\":%u,\"live\":%u,\"stock\":%u,\"errs\":%u,\"guard\":%u,\"nrec\":%u,\"rc\":[",
         hdr.count, hdr.loaded, arr ? "true" : "false", n_alloc, n_live, n_stock, n_errs, guard, rcs_n);
  for (i = 0; i < shown; i++) printf("%s%d", i ? "," : "", rcs[i]);
  printf("],\"entries\":[");
  for (i = 0; arr && i < hdr.count; i++) {
    uint8_t *e = arr + MD_STRIDE * i;
    uint32_t cnt = md_get32(e + 16);
    int32_t *pp = (int32_t *)md_getp(e + 20);
    printf("%s{\"n\":%u,\"style\":%u,\"lat\":%d,\"lon\":%d,\"cnt\":%u,\"pts\":[", i ? "," : "",
           md_get32(e), md_get32(e + 4), (int32_t)md_get32(e + 8), (int32_t)md_get32(e + 12), cnt);
    for (k = 0; k < cnt; k++) printf("%s[%d,%d]", k ? "," : "", pp[2 * k], pp[2 * k + 1]);
    printf("]}");
  }
  printf("]}\n");
  n_records++;
}

int main(int argc, char **argv) {
  FILE *f;
  long sz;
  uint8_t *buf, *p, *end;
  int othercb;
  if (argc != 4) return 2;
  othercb = strcmp(argv[2], "othercb") == 0;
  fail_at = (uint32_t)atoi(argv[3]);
  f = fopen(argv[1], "rb");
  if (!f) return 3;
  fseek(f, 0, SEEK_END);
  sz = ftell(f);
  fseek(f, 0, SEEK_SET);
  buf = (uint8_t *)malloc(sz > 0 ? (size_t)sz : 1);
  if (!buf || (sz > 0 && fread(buf, 1, (size_t)sz, f) != (size_t)sz)) return 4;
  fclose(f);
  p = buf;
  end = buf + sz;
  while (end - p >= 4) {
    uint32_t len = rd_le32(p);
    p += 4;
    if (len > (uint32_t)(end - p)) break;
    load(p, len, othercb);
    print_record();
    p += len;
  }
  free_old();
  hdr.count = 0;
  printf("{\"final\":true,\"live\":%u}\n", n_live);
  free(buf);
  return 0;
}
