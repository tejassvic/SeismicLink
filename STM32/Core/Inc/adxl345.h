
#ifndef ADXL345_H
#define ADXL345_H

#include "main.h"
#include <stdint.h>

#define ADXL345_RAW_TO_G 0.0039f

typedef struct {
    uint32_t timestamp_ms;
    int16_t rawX, rawY, rawZ;
    float x, y, z;
} ADXL345_Sample;

HAL_StatusTypeDef ADXL345_Init(void);
HAL_StatusTypeDef ADXL345_ReadFifoCount(uint8_t *count);
HAL_StatusTypeDef ADXL345_ReadFifoSample(ADXL345_Sample *sample);
HAL_StatusTypeDef ADXL345_ReadInterruptSource(uint8_t *source);

#endif
