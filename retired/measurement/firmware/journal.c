#include "journal.h"
enum { CLOSED=0, ACTIVE=1, FROZEN=2 };
static void copy(void *dst, const void *src, unsigned n) {
    unsigned char *d=dst; const unsigned char *s=src;
    while (n--) *d++=*s++;
}
static void increment(uint32_t *n) { if (*n != UINT32_MAX) ++*n; }
int tm_init(tm_journal *j, const tm_identity *id, tm_sync sync) {
    if (!j || !id || !sync.enter || !sync.leave || id->width!=240 || id->height!=256)
        return 0;
    /* Initialization is exclusive, before publication to other callers. */
    unsigned char *p=(unsigned char *)j;
    for (unsigned i=0;i<sizeof(*j);++i) p[i]=0;
    copy(&j->sync,&sync,sizeof(sync));
    copy(&j->capture.identity,id,sizeof(*id)); j->state=ACTIVE;
    return 1;
}
int tm_record(tm_journal *j, const tm_sample *s) {
    if (!j || !s || !j->sync.enter || !j->sync.enter(j->sync.context)) return 0;
    int ok=0;
    if (j->state==ACTIVE) {
        if (s->ticks[0]>s->ticks[1] || s->ticks[1]>s->ticks[2] || s->ticks[2]>s->ticks[3])
            increment(&j->capture.rejected);
        else if (j->capture.count==TM_CAPACITY) increment(&j->capture.dropped);
        else {
            copy(&j->capture.samples[j->capture.count],s,sizeof(*s));
            ++j->capture.count;
            ok=1;
        }
    }
    j->sync.leave(j->sync.context);
    return ok;
}
int tm_freeze(tm_journal *j) {
    if (!j || !j->sync.enter || !j->sync.enter(j->sync.context)) return 0;
    int ok=j->state==ACTIVE || j->state==FROZEN;
    if (ok) j->state=FROZEN;
    j->sync.leave(j->sync.context);
    return ok;
}
int tm_snapshot(tm_journal *j, tm_capture *out) {
    if (!j || !out || !j->sync.enter || !j->sync.enter(j->sync.context)) return 0;
    int ok=j->state==FROZEN;
    if (ok) copy(out,&j->capture,sizeof(*out));
    j->sync.leave(j->sync.context);
    return ok;
}
int tm_close(tm_journal *j) {
    if (!j || !j->sync.enter || !j->sync.enter(j->sync.context)) return 0;
    int ok=j->state!=CLOSED;
    j->state=CLOSED;
    j->sync.leave(j->sync.context);
    return ok;
}
