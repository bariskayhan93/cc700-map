/* CC700 V1.414: presentation-only boundary; no matcher/progress writes. */
#include <stdint.h>
#ifdef HOST
unsigned guidance_offroute(void);
void *guidance_child(void *, int);
void guidance_add_flag(void *, unsigned);
void guidance_clear_flag(void *, unsigned);
void guidance_native_card(void *, const void *, void *);
void guidance_native_popup(void *, const void *, void *);
#else
#define guidance_child ((void *(*)(void *, int))0x421cebe4)
#define guidance_offroute ((unsigned (*)(void))0x42050618)
#define guidance_add_flag ((void (*)(void *, unsigned))0x42015568)
#define guidance_clear_flag ((void (*)(void *, unsigned))0x420155c4)
#define guidance_native_card ((void (*)(void *,const void *,void *))0x42081d1c)
#define guidance_native_popup ((void (*)(void *,const void *,void *))0x42086ec8)
#endif
/* Returning NULL/-1 only skips LVGL setters and retains stale pixels.
 * Hide only cue children owned by this consumer. Never alter root visibility:
 * page owners may hide the root independently. The native caption branch owns
 * the mutually-exclusive text/image child visibility and restores its selected
 * child on the next on-route update. */
static int suppress(void *obj, const void *callbacks, void *buffer,
                    uintptr_t table, unsigned children, unsigned stable) {
    if (!obj || !buffer || (uintptr_t)callbacks != table) return 0;
    unsigned offroute = guidance_offroute();
    unsigned count = offroute ? children : stable;
    for (unsigned i = 0; i < count; ++i) {
        void *child = guidance_child(obj, (int)i);
        if (!child) continue;
        if (offroute) guidance_add_flag(child, 1u);
        else guidance_clear_flag(child, 1u);
    }
    return offroute != 0;
}
void cc_guidance_card(void *obj, const void *callbacks, void *buffer) {
    if (!suppress(obj, callbacks, buffer, 0x3fc98b60u, 3u, 1u))
        guidance_native_card(obj, callbacks, buffer);
}
void cc_guidance_popup(void *obj, const void *callbacks, void *buffer) {
    if (!suppress(obj, callbacks, buffer, 0x3fc989f0u, 5u, 3u))
        guidance_native_popup(obj, callbacks, buffer);
}
