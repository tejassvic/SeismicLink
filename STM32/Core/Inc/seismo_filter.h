#ifndef SEISMO_FILTER_H
#define SEISMO_FILTER_H

#include <stdint.h>

typedef struct {
    float x1, x2, y1, y2;
} SeismoBiquadState;

typedef struct {
    SeismoBiquadState highPass[3];
    SeismoBiquadState lowPass[3];
} SeismoFilter;

void SeismoFilter_Init(SeismoFilter *filter);
int16_t SeismoFilter_Process(SeismoFilter *filter,
                             uint8_t axis,
                             int16_t rawCounts);

#endif
