/* cc25 map block decoder, E4 (see README.md). No writable globals, no float, no library call.
 * Every length is checked before every read. On a data error the entries made so far are kept, the rest
 * of the record is consumed, and the function returns 0. On an allocation failure nothing is kept. */
#include <stdint.h>
#include "mapdec.h"

#ifdef HOST
extern uint32_t md_host_count;     /* message count, 0x3c3887bc on the device */
extern void *md_host_array;        /* entry array, 0x3fc9fbe8 on the device */
int md_host_buf_read(pb_istream_t *s, uint8_t *buf, uint32_t n);
int md_host_stock(pb_istream_t *s, const void *field, void **arg);
void *md_host_malloc(uint32_t size, uint32_t caps);
void md_host_free(void *p);
#define MD_BUF_READ_ID ((uintptr_t)md_host_buf_read)
#define MD_MSG_COUNT (md_host_count)
#define MD_ARRAY (md_host_array)
#define MD_STOCK(s, f, a) md_host_stock((s), (f), (a))
#define MD_MALLOC(n, c) md_host_malloc((n), (c))
#define MD_FREE(p) md_host_free(p)
#else
#define MD_BUF_READ_ID 0x421cfe20u                                       /* buffer stream read callback */
#define MD_MSG_COUNT (*(volatile uint32_t *)0x3c3887bcu)                  /* message count */
#define MD_ARRAY (*(void *volatile *)0x3fc9fbe8u)                         /* entry array pointer */
#define MD_STOCK(s, f, a) (((int (*)(pb_istream_t *, const void *, void **))0x42049368u)((s), (f), (a)))
#define MD_MALLOC(n, c) (((void *(*)(uint32_t, uint32_t))0x403763e0u)((n), (c)))
#define MD_FREE(p) (((void (*)(void *))0x40376398u)((p)))
#endif

#define MD_CAPS 0x404u
#define MD_CNT_MAX 4096u
#define MD_N_MAX 0x03ffffffu       /* keeps the array size below 2^31 */
#define MD_HDR_COUNT(h) (*(uint32_t *)((uint8_t *)(h) + 20))
#define MD_HDR_ARRAY(h) (*(void **)((uint8_t *)(h) + 24))

typedef struct { const uint8_t *p; uint32_t left; } md_rd;

static int md_byte(md_rd *r, uint8_t *v) {
  if (!r->left) return 0;
  *v = *r->p++;
  r->left--;
  return 1;
}

/* uvarint of at most 5 bytes */
static int md_var(md_rd *r, uint32_t *v) {
  uint32_t out = 0, sh = 0, k;
  uint8_t b;
  for (k = 0; k < 5u; k++) {
    if (!md_byte(r, &b)) return 0;
    if (k == 4u && (b & 0xf0u)) return 0;                     /* bits above 32, or a continuation */
    out |= (uint32_t)(b & 127u) << sh;
    sh += 7u;
    if (!(b & 128u)) { *v = out; return 1; }
  }
  return 0;
}

/* zigzag 32-bit */
static int md_zz(md_rd *r, int32_t *v) {
  uint32_t u;
  if (!md_var(r, &u)) return 0;
  *v = (int32_t)((u >> 1) ^ (0u - (u & 1u)));
  return 1;
}

/* Rule 6 without a live array, or after a failure: the stock iterator then sees an empty block.
 * Frees the entries [0, filled) and the array, so no allocation of this call stays live. */
static void md_drop(void *h, uint8_t *arr, uint32_t filled) {
  uint32_t i;
  if (arr) {
    for (i = 0; i < filled; i++) {
      void *q = md_getp(arr + MD_STRIDE * i + 20u);
      if (q) MD_FREE(q);
    }
    MD_FREE(arr);
  }
  MD_HDR_COUNT(h) = 0;
  MD_HDR_ARRAY(h) = 0;
  MD_ARRAY = 0;
  MD_MSG_COUNT = 0;
}

static int md_done(pb_istream_t *s, int ok) {   /* the record is consumed */
  s->state += s->bytes_left;
  s->bytes_left = 0;
  return ok;
}

int cc_entries(pb_istream_t *s, const void *field, void **arg) {
  void *h = *arg;
  md_rd outer, pay;
  uint8_t *arr, *ent, *pts;
  uint32_t N, len, i, k, nd, style, cnt, filled = 0;
  int32_t dl, lat, lon, pla = 0, plo = 0, a = 0, b = 0, qa, qb;
  uint8_t ver;
  int bad = 0;

  /* rule 1: another stream, or no E1 prefix, goes to the stock callback */
  if ((uintptr_t)s->callback != MD_BUF_READ_ID || s->bytes_left < 7u ||
      s->state[0] != 0x08 || s->state[1] != 0x00 || s->state[2] != 0x10 || s->state[3] != 0x00 ||
      s->state[4] != 0x28 || s->state[5] != 0x00 || s->state[6] != 0x7a)
    return MD_STOCK(s, field, arg);

  /* rule 2 and 3: count from field 1, array as stock (caps 0x404, zeroed) */
  N = MD_MSG_COUNT;
  if (N == 0u || N > MD_N_MAX) { md_drop(h, 0, 0); return md_done(s, 0); }
  arr = (uint8_t *)MD_MALLOC(MD_ARR_BYTES(N), MD_CAPS);
  if (!arr) { md_drop(h, 0, 0); return md_done(s, 0); }                /* rule 6 */
  for (i = 0; i < MD_ARR_BYTES(N); i++) arr[i] = 0;
  MD_ARRAY = arr;
  MD_HDR_ARRAY(h) = arr;

  outer.p = s->state + 7;
  outer.left = s->bytes_left - 7u;
  if (!md_var(&outer, &len) || len > outer.left) return md_done(s, 0);
  pay.p = outer.p;
  pay.left = len;
  outer.p += len;
  outer.left -= len;

  if (!md_byte(&pay, &ver) || ver != 1u || !md_var(&pay, &nd) || nd != N) return md_done(s, 0);

  for (i = 0; i < N && !bad; i++) {
    if (!md_var(&pay, &style) || !md_var(&pay, &cnt) || cnt > MD_CNT_MAX || !md_zz(&pay, &dl)) { bad = 1; break; }
    lat = (int32_t)((uint32_t)pla + (uint32_t)dl);
    if (!md_zz(&pay, &dl)) { bad = 1; break; }
    lon = (int32_t)((uint32_t)plo + (uint32_t)dl);
    pts = 0;
    if (cnt) {
      if (pay.left < 2u * cnt) { bad = 1; break; }                      /* rule 4: the pairs must fit */
      pts = (uint8_t *)MD_MALLOC(8u * cnt, MD_CAPS);
      if (!pts) { md_drop(h, arr, filled); return md_done(s, 0); }     /* rule 6 */
    }
    qa = lat;
    qb = lon;
    for (k = 0; k < cnt; k++) {
      if (!md_zz(&pay, &a) || !md_zz(&pay, &b)) { bad = 1; break; }
      if ((style & 15u) != 12u) {                                       /* labels keep their raw words */
        a = (int32_t)((uint32_t)qa + (uint32_t)a);
        b = (int32_t)((uint32_t)qb + (uint32_t)b);
        qa = a;
        qb = b;
      }
      md_put32(pts + 8u * k, (uint32_t)a);
      md_put32(pts + 8u * k + 4u, (uint32_t)b);
    }
    if (bad) { if (pts) MD_FREE(pts); break; }
    ent = arr + MD_STRIDE * i;
    md_put32(ent, i);
    md_put32(ent + 4, style);
    md_put32(ent + 8, (uint32_t)lat);
    md_put32(ent + 12, (uint32_t)lon);
    md_put32(ent + 16, cnt);
    md_putp(ent + 20, pts);
    filled = i + 1;
    pla = lat;
    plo = lon;
  }
  if (bad || filled != N || outer.left != 0u || pay.left != 0u) return md_done(s, 0);   /* rule 5 */
  return md_done(s, 1);                                                  /* rule 7 */
}
