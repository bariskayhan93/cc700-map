#include "journal.h"
#include <assert.h>
#include <pthread.h>
#include <string.h>

static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static int enter(void *ctx) { (void)ctx; return pthread_mutex_lock(&mutex) == 0; }
static void leave(void *ctx) { (void)ctx; assert(pthread_mutex_unlock(&mutex) == 0); }
static int deny(void *ctx) { (void)ctx; return 0; }
static tm_journal j;
static tm_capture out;
static tm_sample sample = {.block=40,.section=2,.ticks={10,12,20,21}};
static void *writer(void *unused) {
    (void)unused;
    for (unsigned i=0;i<1000;i++) tm_record(&j, &sample);
    return 0;
}
int main(void) {
    tm_identity id = {.workload=3,.width=240,.height=256,.zoom=5};
    id.image_sha256[0]=7; id.route_sha256[0]=9;
    tm_sync sync = {.enter=enter,.leave=leave};
    assert(!tm_init(0,&id,sync));
    assert(!tm_init(&j,0,sync));
    assert(!tm_init(&j,&id,(tm_sync){0}));
    id.width=0; assert(!tm_init(&j,&id,sync)); id.width=240;
    assert(tm_init(&j,&id,sync));
    id.image_sha256[0]=99; /* Initialization copies identity, no borrowed metadata. */
    memset(&out,0xaa,sizeof(out));
    assert(!tm_snapshot(&j,&out)); assert(out.count==0xaaaaaaaaU);
    tm_sample bad=sample; bad.ticks[2]=11;
    assert(!tm_record(&j,&bad));
    assert(tm_record(&j,&sample));
    sample.block=70; sample.section=9; assert(tm_record(&j,&sample));
    assert(tm_freeze(&j)); assert(!tm_record(&j,&sample));
    assert(tm_snapshot(&j,&out)); assert(out.count==2);
    assert(out.identity.image_sha256[0]==7 && out.identity.route_sha256[0]==9);
    assert(out.samples[0].block==40 && out.samples[1].block==70);
    assert(out.samples[1].section==9 && out.rejected==1 && out.dropped==0);
    assert(tm_close(&j)); assert(!tm_snapshot(&j,&out));
    assert(!tm_record(&j,&sample));
    assert(tm_init(&j,&id,sync));
    for(unsigned i=0;i<TM_CAPACITY;i++) assert(tm_record(&j,&sample));
    assert(!tm_record(&j,&sample)); assert(tm_freeze(&j));
    assert(tm_snapshot(&j,&out)); assert(out.count==TM_CAPACITY && out.dropped==1);
    assert(tm_close(&j));
    assert(tm_init(&j,&id,(tm_sync){.enter=deny,.leave=leave}));
    assert(!tm_record(&j,&sample)); assert(!tm_freeze(&j)); assert(!tm_snapshot(&j,&out));
    /* Freeze and publication race with writers: locking must publish only whole samples. */
    assert(tm_init(&j,&id,sync));
    pthread_t thread; assert(pthread_create(&thread,0,writer,0)==0);
    assert(tm_freeze(&j)); assert(tm_snapshot(&j,&out));
    assert(pthread_join(thread,0)==0);
    tm_capture again; assert(tm_snapshot(&j,&again));
    assert(memcmp(&again,&out,sizeof(out))==0);
    for(unsigned i=0;i<out.count;i++) assert(out.samples[i].ticks[3]==21);
    assert(tm_close(&j));
    return 0;
}
