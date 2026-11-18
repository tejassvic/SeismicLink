#ifndef SEISMO_DETECTOR_H
#define SEISMO_DETECTOR_H

#include <stdint.h>

#define SEISMO_DETECTOR_WINDOW 100U

typedef struct {
    float squareWindow[SEISMO_DETECTOR_WINDOW];
    float sumSquares;
    float noiseRmsMg;
    float currentRmsMg;
    float thresholdMg;
    uint16_t position;
    uint16_t filled;
    uint16_t evalDivider;
    uint16_t voteBits;
    uint16_t calibrationEvaluations;
    uint8_t triggered;
} SeismoDetector;

void SeismoDetector_Init(SeismoDetector *detector);
void SeismoDetector_Rearm(SeismoDetector *detector);
uint8_t SeismoDetector_Push(SeismoDetector *detector,
                            int16_t xMg, int16_t yMg, int16_t zMg);

#endif
