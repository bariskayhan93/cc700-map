#pragma once
#include <stdint.h>
typedef struct {uint32_t words[37];} ls_result;
typedef struct {
    uint32_t navigation,arrival,route_mode,max_road,count;
    float start[2],end[2],total,ridden;
} ls_context;
ls_result *cc_loop_match(ls_result *,void *,uint16_t,int,int,const float *,const ls_result *);
