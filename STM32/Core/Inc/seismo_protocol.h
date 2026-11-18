#ifndef SEISMO_PROTOCOL_H
#define SEISMO_PROTOCOL_H

#include <stdint.h>

#define SEISMO_PROTOCOL_VERSION  1U
#define SEISMO_LOCAL_NODE_ID     1U
#define SEISMO_SYNC_0            0xAAU
#define SEISMO_SYNC_1            0x55U
#define SEISMO_MAX_PAYLOAD       134U
#define SEISMO_MAX_FRAME         148U

enum {
    SEISMO_PKT_HEARTBEAT   = 0x01,
    SEISMO_PKT_STATUS      = 0x02,
    SEISMO_PKT_EVENT_START = 0x10,
    SEISMO_PKT_EVENT_DATA  = 0x11,
    SEISMO_PKT_EVENT_END   = 0x12
};

uint16_t Seismo_CRC16(const uint8_t *data, uint16_t length);
uint16_t Seismo_BuildFrame(uint8_t type,
                           const uint8_t *payload,
                           uint16_t payloadLength,
                           uint8_t *output,
                           uint16_t outputCapacity);

#endif
