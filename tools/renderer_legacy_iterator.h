/* Frozen v18 selection reference; tests replace only iterator, retaining v19 drawing. */
// ---------- entry iterator ----------
// draw passes: [class, op, op for a bridge edge pass (0 = none)]; done for each level -2..2 except fills and water lines
typedef struct { uint8_t cls, op; } pass_t;
static const pass_t FILLS[] = { { C_BUILT, 1 }, { C_GREEN, 2 }, { C_WATER, 3 }, { C_WLINE, 4 } };
static const pass_t LEVEL[] = { { C_RAIL, 12 }, { C_PTH, 11 }, { C_CYC, 13 },
  { C_SRV, 9 }, { C_MIN, 7 }, { C_MAJ, 5 },                 // edges of all roads first, so junctions merge
  { C_SRV, 10 }, { C_MIN, 8 }, { C_MAJ, 6 }, { C_TRAM, 14 }, { C_TRAM, 15 } };

static void draw_entry(proj_cb_t cb, const ent_t *e, uint16_t sel, float *buf) {
  const float k = 180.0f / 2147483648.0f;
  buf[0] = (float)e->lat * k; buf[1] = (float)e->lon * k;
  for (uint32_t i = 0; i < e->cnt; i++) { buf[2 + 2 * i] = (float)e->pts[2 * i] * k; buf[3 + 2 * i] = (float)e->pts[2 * i + 1] * k; }
  FW_LINE_DSC->dash_width = (int16_t)(0x8000 | sel);
  cb(buf, e->cnt + 1);
}
void cc_iter(proj_cb_t cb) {
  fw_blk_lock();
  uint32_t cnt = FW_BLK_CNT; ent_t *E = FW_BLK_ENTS;
  if (cnt && E) {
    const float k = 180.0f / 2147483648.0f; uint32_t big = 0;
    for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) {
      const ent_t *e = &E[i];
      if (e->style) { if (e->cnt > big) big = e->cnt; continue; }
      for (uint32_t j = 0; j < e->cnt; j++) {               // original star line: centre -> point j
        float l[4] = { (float)e->lat * k, (float)e->lon * k, (float)e->pts[2 * j] * k, (float)e->pts[2 * j + 1] * k };
        FW_LINE_DSC->dash_width = 0; cb(l, 2);
      }
    }
    float *buf = big ? fw_malloc((big + 1) * 8, CAPS_PSRAM) : 0;
    if (buf) {
      for (uint32_t f = 0; f < sizeof FILLS / sizeof *FILLS; f++)
        for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) if (E[i].style && (E[i].style & 15) == FILLS[f].cls) {
          draw_entry(cb, &E[i], FILLS[f].op, buf);
          if ((FILLS[f].cls == C_GREEN || FILLS[f].cls == C_WATER) && !(E[i].style & 0x400)) draw_entry(cb, &E[i], FILLS[f].cls == C_GREEN ? 24 : 25, buf);
        }
      for (int lv = 0; lv <= 4; lv++)
        for (uint32_t f = 0; f < sizeof LEVEL / sizeof *LEVEL; f++)
          for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) {
            uint32_t s = E[i].style;
            if (!s || (s & 15) != LEVEL[f].cls || (int)((s >> 4) & 7) != lv) continue;
            uint8_t op = LEVEL[f].op == 11 && (s & 0x200) ? 18 : LEVEL[f].op;
            if (s & 0x800) op = op == 7 ? 28 : op == 8 ? 29 : op == 9 ? 30 : op == 10 ? 31 : op;   // A2: far from the route
            uint16_t sel = op | (s & 0x100 ? F_TUNNEL : 0);
            int edge = LEVEL[f].op == 5 || LEVEL[f].op == 7 || LEVEL[f].op == 9;
            if (edge && (s & 0x80)) sel |= F_BRIDGE;
            uint8_t c = s & 15;                                // F2: a path, cycleway or rail bridge gets a solid base
            if ((s & 0x80) && (c == C_PTH || c == C_CYC || c == C_RAIL)) { draw_entry(cb, &E[i], 26, buf); draw_entry(cb, &E[i], 27, buf); }
            draw_entry(cb, &E[i], sel, buf);
          }
      for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) {                    // traffic signals and tram stops: edge, core
        uint32_t c = E[i].style & 15;
        if (c == C_SIG || c == C_STOP) { draw_entry(cb, &E[i], c == C_SIG ? 19 : 21, buf); draw_entry(cb, &E[i], c == C_SIG ? 20 : 22, buf); }
      }
      for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) if ((E[i].style & 15) == C_LABEL) {   // street names: anchor only, text from the entry
        buf[0] = (float)E[i].lat * k; buf[1] = (float)E[i].lon * k;
        FW_LINE_DSC->dash_width = (int16_t)(0x8000 | 23); FW_LINE_DSC->dash_gap = (int16_t)i; cb(buf, 1);
      }
      fw_free(buf);
    }
    FW_LINE_DSC->dash_width = 0;
  }
  fw_blk_unlock();
}
