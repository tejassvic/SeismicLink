#include "seismo_filter.h"
#include "adxl345.h"
#include <string.h>

/* 100 Hz sample rate, Butterworth HP 0.5 Hz and LP 20 Hz. */
#define HP_B0  0.97803048f
#define HP_B1 -1.95606096f
#define HP_B2  0.97803048f
#define HP_A1 -1.95557824f
#define HP_A2  0.95654368f

#define LP_B0  0.20657208f
#define LP_B1  0.41314417f
#define LP_B2  0.20657208f
#define LP_A1 -0.36952738f
#define LP_A2  0.19581571f

static float Biquad(float input, SeismoBiquadState *s,
                    float b0, float b1, float b2,
                    float a1, float a2)
{
    float output = b0 * input + b1 * s->x1 + b2 * s->x2
                 - a1 * s->y1 - a2 * s->y2;

    s->x2 = s->x1;
    s->x1 = input;
    s->y2 = s->y1;
    s->y1 = output;
    return output;
}

void SeismoFilter_Init(SeismoFilter *filter)
{
    if (filter != 0)
        memset(filter, 0, sizeof(*filter));
}

int16_t SeismoFilter_Process(SeismoFilter *filter,
                             uint8_t axis,
                             int16_t rawCounts)
{
    if ((filter == 0) || (axis >= 3U))
        return 0;

    /* ADXL345 full-resolution scale: nominally 3.9 mg/LSB. */
    float inputMg = (float)rawCounts * (ADXL345_RAW_TO_G * 1000.0f);

    float hp = Biquad(inputMg, &filter->highPass[axis],
                      HP_B0, HP_B1, HP_B2, HP_A1, HP_A2);
    float lp = Biquad(hp, &filter->lowPass[axis],
                      LP_B0, LP_B1, LP_B2, LP_A1, LP_A2);

    if (lp > 32767.0f) lp = 32767.0f;
    if (lp < -32768.0f) lp = -32768.0f;
    return (int16_t)lp;
}
