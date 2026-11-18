#ifndef SEISMO_H
#define SEISMO_H

#include "main.h"

HAL_StatusTypeDef Seismo_Init(void);
void Seismo_DataReadyISR(void);

#endif
