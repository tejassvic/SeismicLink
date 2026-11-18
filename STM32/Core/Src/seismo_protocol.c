#include "seismo_protocol.h"

static uint32_t txSequence = 0U;

static void PutU16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
}

static void PutU32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

uint16_t Seismo_CRC16(const uint8_t *data, uint16_t length)
{
    uint16_t crc = 0xFFFFU;

    for (uint16_t i = 0U; i < length; i++)
    {
        crc ^= (uint16_t)data[i] << 8;
        for (uint8_t bit = 0U; bit < 8U; bit++)
        {
            if ((crc & 0x8000U) != 0U)
                crc = (uint16_t)((crc << 1) ^ 0x1021U);
            else
                crc = (uint16_t)(crc << 1);
        }
    }
    return crc;
}

/*
 * Frame:
 * AA 55 | version:u8 | type:u8 | local_node_id:u16 |
 * sequence:u32 | payload_length:u16 | payload | CRC16:u16
 *
 * CRC-16/CCITT-FALSE covers version through the final payload byte.
 * Multi-byte values are little-endian.
 */
uint16_t Seismo_BuildFrame(uint8_t type,
                           const uint8_t *payload,
                           uint16_t payloadLength,
                           uint8_t *output,
                           uint16_t outputCapacity)
{
    uint16_t totalLength = (uint16_t)(14U + payloadLength);

    if ((output == 0) ||
        (payloadLength > SEISMO_MAX_PAYLOAD) ||
        (totalLength > outputCapacity) ||
        ((payloadLength > 0U) && (payload == 0)))
        return 0U;

    output[0] = SEISMO_SYNC_0;
    output[1] = SEISMO_SYNC_1;
    output[2] = SEISMO_PROTOCOL_VERSION;
    output[3] = type;
    PutU16(&output[4], SEISMO_LOCAL_NODE_ID);
    PutU32(&output[6], txSequence++);
    PutU16(&output[10], payloadLength);

    for (uint16_t i = 0U; i < payloadLength; i++)
        output[12U + i] = payload[i];

    uint16_t crc = Seismo_CRC16(&output[2],
                                (uint16_t)(10U + payloadLength));
    PutU16(&output[12U + payloadLength], crc);

    return totalLength;
}
