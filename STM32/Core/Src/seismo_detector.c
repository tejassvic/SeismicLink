#include "seismo_detector.h"
#include <math.h>
#include <string.h>

#define EVALUATE_EVERY_SAMPLES  10U
#define CALIBRATION_EVALUATIONS 50U   /* 5 seconds */
#define MIN_TRIGGER_MG          5.0f
#define NOISE_MULTIPLIER        6.0f
#define NOISE_ALPHA             0.02f
#define REQUIRED_VOTES          5U

static uint8_t CountVotes(uint16_t bits)
{
    uint8_t count = 0U;
    for (uint8_t i = 0U; i < 10U; i++)
        count += (uint8_t)((bits >> i) & 1U);
    return count;
}

void SeismoDetector_Init(SeismoDetector *d)
{
    if (d == 0) return;
    memset(d, 0, sizeof(*d));
    d->noiseRmsMg = 1.0f;
    d->thresholdMg = MIN_TRIGGER_MG;
}

void SeismoDetector_Rearm(SeismoDetector *d)
{
    if (d == 0) return;
    memset(d->squareWindow, 0, sizeof(d->squareWindow));
    d->sumSquares = 0.0f;
    d->currentRmsMg = 0.0f;
    d->position = 0U;
    d->filled = 0U;
    d->evalDivider = 0U;
    d->voteBits = 0U;
    d->calibrationEvaluations = 0U;
    d->triggered = 0U;
    /* Keep the learned noiseRmsMg between events. */
}

uint8_t SeismoDetector_Push(SeismoDetector *d,
                            int16_t xMg, int16_t yMg, int16_t zMg)
{
    if ((d == 0) || d->triggered)
        return 0U;

    float x = (float)xMg;
    float y = (float)yMg;
    float z = (float)zMg;
    float mag2 = x*x + y*y + z*z;

    d->sumSquares -= d->squareWindow[d->position];
    d->squareWindow[d->position] = mag2;
    d->sumSquares += mag2;

    d->position = (uint16_t)((d->position + 1U) %
                             SEISMO_DETECTOR_WINDOW);
    if (d->filled < SEISMO_DETECTOR_WINDOW)
        d->filled++;

    if (d->filled < SEISMO_DETECTOR_WINDOW)
        return 0U;

    d->evalDivider++;
    if (d->evalDivider < EVALUATE_EVERY_SAMPLES)
        return 0U;
    d->evalDivider = 0U;

    d->currentRmsMg = sqrtf(d->sumSquares /
                            (float)SEISMO_DETECTOR_WINDOW);

    /* Initial quiet-floor calibration: 5 seconds of 1-second RMS windows. */
    if (d->calibrationEvaluations < CALIBRATION_EVALUATIONS)
    {
        if (d->calibrationEvaluations == 0U)
            d->noiseRmsMg = d->currentRmsMg;
        else
            d->noiseRmsMg += 0.10f *
                (d->currentRmsMg - d->noiseRmsMg);

        d->calibrationEvaluations++;
        d->thresholdMg = fmaxf(MIN_TRIGGER_MG,
                               NOISE_MULTIPLIER * d->noiseRmsMg);
        return 0U;
    }

    d->thresholdMg = NOISE_MULTIPLIER * d->noiseRmsMg;
    if (d->thresholdMg < MIN_TRIGGER_MG)
        d->thresholdMg = MIN_TRIGGER_MG;

    uint8_t above = (d->currentRmsMg >= d->thresholdMg) ? 1U : 0U;
    d->voteBits = (uint16_t)(((d->voteBits << 1) | above) & 0x03FFU);

    /* Freeze the baseline when vibration rises; adapt only below threshold. */
    if (!above)
    {
        d->noiseRmsMg += NOISE_ALPHA *
            (d->currentRmsMg - d->noiseRmsMg);
        if (d->noiseRmsMg < 0.25f)
            d->noiseRmsMg = 0.25f;
    }

    if (CountVotes(d->voteBits) >= REQUIRED_VOTES)
    {
        d->triggered = 1U;
        return 1U;
    }
    return 0U;
}
