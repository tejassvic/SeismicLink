
#include "adxl345.h"

extern I2C_HandleTypeDef hi2c1;

#define ADXL345_ADDR          (0x53U << 1)

#define REG_DEVID             0x00U
#define REG_INT_SOURCE        0x30U
#define REG_DATA_FORMAT       0x31U
#define REG_DATAX0            0x32U
#define REG_FIFO_CTL          0x38U
#define REG_FIFO_STATUS       0x39U
#define REG_BW_RATE           0x2CU
#define REG_POWER_CTL         0x2DU
#define REG_INT_ENABLE        0x2EU

#define INT_OVERRUN            0x01U
#define INT_DATA_READY         0x80U
#define FIFO_STREAM_MODE       0x80U
#define FIFO_ENTRIES_MASK      0x3FU

static HAL_StatusTypeDef WriteRegister(uint8_t reg, uint8_t value)
{
    return HAL_I2C_Mem_Write(
        &hi2c1, ADXL345_ADDR, reg,
        I2C_MEMADD_SIZE_8BIT, &value, 1, 100);
}

static HAL_StatusTypeDef ReadRegister(uint8_t reg, uint8_t *value)
{
    return HAL_I2C_Mem_Read(
        &hi2c1, ADXL345_ADDR, reg,
        I2C_MEMADD_SIZE_8BIT, value, 1, 100);
}

HAL_StatusTypeDef ADXL345_Init(void)
{
    uint8_t id = 0U;

    if (ReadRegister(REG_DEVID, &id) != HAL_OK || id != 0xE5U)
        return HAL_ERROR;

    /* Standby while configuring. */
    if (WriteRegister(REG_POWER_CTL, 0x00U) != HAL_OK)
        return HAL_ERROR;

    /* 100 Hz output data rate. */
    if (WriteRegister(REG_BW_RATE, 0x0AU) != HAL_OK)
        return HAL_ERROR;

    /* Full resolution, +/-2 g. */
    if (WriteRegister(REG_DATA_FORMAT, 0x08U) != HAL_OK)
        return HAL_ERROR;

    /* Disable sensor interrupts during configuration. */
    if (WriteRegister(REG_INT_ENABLE, 0x00U) != HAL_OK)
        return HAL_ERROR;

    /* Bypass first to clear FIFO, then enable stream mode. */
    if (WriteRegister(REG_FIFO_CTL, 0x00U) != HAL_OK)
        return HAL_ERROR;

    if (WriteRegister(REG_FIFO_CTL, FIFO_STREAM_MODE) != HAL_OK)
        return HAL_ERROR;

    /* Route DATA_READY and OVERRUN to INT1 (default mapping). */
    if (WriteRegister(REG_INT_ENABLE,
                      INT_DATA_READY | INT_OVERRUN) != HAL_OK)
        return HAL_ERROR;

    /* Start measurement. */
    if (WriteRegister(REG_POWER_CTL, 0x08U) != HAL_OK)
        return HAL_ERROR;

    HAL_Delay(10);
    return HAL_OK;
}

HAL_StatusTypeDef ADXL345_ReadFifoCount(uint8_t *count)
{
    uint8_t status = 0U;

    if (count == NULL)
        return HAL_ERROR;

    if (ReadRegister(REG_FIFO_STATUS, &status) != HAL_OK)
        return HAL_ERROR;

    *count = status & FIFO_ENTRIES_MASK;
    return HAL_OK;
}

HAL_StatusTypeDef ADXL345_ReadFifoSample(ADXL345_Sample *sample)
{
    uint8_t data[6];

    if (sample == NULL)
        return HAL_ERROR;

    if (HAL_I2C_Mem_Read(
            &hi2c1, ADXL345_ADDR, REG_DATAX0,
            I2C_MEMADD_SIZE_8BIT, data, sizeof(data), 20) != HAL_OK)
        return HAL_ERROR;

    sample->rawX = (int16_t)(((uint16_t)data[1] << 8) | data[0]);
    sample->rawY = (int16_t)(((uint16_t)data[3] << 8) | data[2]);
    sample->rawZ = (int16_t)(((uint16_t)data[5] << 8) | data[4]);

    sample->x = sample->rawX * ADXL345_RAW_TO_G;
    sample->y = sample->rawY * ADXL345_RAW_TO_G;
    sample->z = sample->rawZ * ADXL345_RAW_TO_G;

    return HAL_OK;
}

/* Reading INT_SOURCE clears the latched sensor interrupt flags. */
HAL_StatusTypeDef ADXL345_ReadInterruptSource(uint8_t *source)
{
    if (source == NULL)
        return HAL_ERROR;

    return ReadRegister(REG_INT_SOURCE, source);
}
