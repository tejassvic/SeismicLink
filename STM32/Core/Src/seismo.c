#include "seismo.h"
#include "adxl345.h"
#include "seismo_filter.h"
#include "seismo_detector.h"
#include "seismo_protocol.h"
#include "cmsis_os.h"

#include <stdint.h>
#include <string.h>

extern UART_HandleTypeDef huart1;
extern UART_HandleTypeDef huart2;

#define SAMPLE_QUEUE_LENGTH       64U
#define EVENT_QUEUE_LENGTH        256U
#define PRETRIGGER_SAMPLES        1000U
#define POSTTRIGGER_SAMPLES       6000U
#define SAMPLES_PER_PACKET        10U
#define SAMPLE_INTERVAL_MS        10U
#define HEARTBEAT_PERIOD_MS       1000U
#define STATUS_PERIOD_MS          5000U
#define DATA_READY_FLAG           (1UL << 0)
#define EVENT_READY_FLAG          (1UL << 1)

typedef struct {
    uint32_t timestampMs;
    uint32_t sampleIndex;
    int16_t rawX, rawY, rawZ;
    int16_t filteredXmg, filteredYmg, filteredZmg;
} SeismoWireSample;

typedef struct {
    uint32_t eventId;
    uint32_t triggerIndex;
    uint32_t triggerTimestampMs;
    uint16_t triggerRmsMg;
    uint16_t thresholdMg;
} SeismoEventInfo;

static osMessageQueueId_t sampleQueue;
static osMessageQueueId_t eventQueue;
static osThreadId_t samplingTaskHandle;
static osThreadId_t eventTaskHandle;

static SeismoWireSample preRing[PRETRIGGER_SAMPLES];
static SeismoWireSample preSnapshot[PRETRIGGER_SAMPLES];
static uint16_t preWriteIndex = 0U;
static uint16_t preCount = 0U;

static volatile uint8_t eventActive = 0U;
static volatile uint8_t eventComplete = 0U;
static volatile uint8_t sensorHealthy = 0U;
static volatile uint32_t postRemaining = 0U;

static volatile uint32_t capturedCount = 0U;
static volatile uint32_t i2cErrorCount = 0U;
static volatile uint32_t sampleQueueDrops = 0U;
static volatile uint32_t eventQueueDrops = 0U;
static volatile uint32_t fifoOverruns = 0U;
static volatile uint32_t txErrors = 0U;
static volatile uint32_t lastSampleIndex = 0U;

static uint32_t nextEventId = 1U;
static SeismoEventInfo currentEvent;

static void SamplingTask(void *argument);
static void ProcessingTask(void *argument);
static void EventTask(void *argument);

static void DebugText(const char *text)
{
    (void)HAL_UART_Transmit(&huart2, (uint8_t *)text,
                            (uint16_t)strlen(text), 100U);
}

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

static void SendFrame(uint8_t type, const uint8_t *payload,
                      uint16_t payloadLength)
{
    uint8_t frame[SEISMO_MAX_FRAME];
    uint16_t length = Seismo_BuildFrame(type, payload, payloadLength,
                                        frame, sizeof(frame));
    if (length == 0U)
        return;

    if (HAL_UART_Transmit(&huart1, frame, length, 250U) != HAL_OK)
        txErrors++;
}

static void SendHeartbeat(void)
{
    uint8_t p[12] = {0};
    PutU32(&p[0], HAL_GetTick());
    PutU32(&p[4], lastSampleIndex);
    p[8] = eventActive ? 1U : 0U;
    p[9] = sensorHealthy ? 1U : 0U;
    PutU16(&p[10], (uint16_t)(txErrors > 65535U ? 65535U : txErrors));
    SendFrame(SEISMO_PKT_HEARTBEAT, p, sizeof(p));
}

static void SendStatus(void)
{
    uint8_t p[24];
    PutU32(&p[0], capturedCount);
    PutU32(&p[4], i2cErrorCount);
    PutU32(&p[8], sampleQueueDrops);
    PutU32(&p[12], eventQueueDrops);
    PutU32(&p[16], fifoOverruns);
    PutU32(&p[20], lastSampleIndex);
    SendFrame(SEISMO_PKT_STATUS, p, sizeof(p));
}

static void SendEventStart(const SeismoEventInfo *e)
{
    uint8_t p[24] = {0};
    PutU32(&p[0], e->eventId);
    PutU32(&p[4], e->triggerIndex);
    PutU32(&p[8], e->triggerTimestampMs);
    PutU16(&p[12], PRETRIGGER_SAMPLES);
    PutU32(&p[14], POSTTRIGGER_SAMPLES);
    PutU16(&p[18], 100U);
    PutU16(&p[20], e->triggerRmsMg);
    PutU16(&p[22], e->thresholdMg);
    SendFrame(SEISMO_PKT_EVENT_START, p, sizeof(p));
}

static void SendEventData(const SeismoWireSample *samples, uint8_t count)
{
    uint8_t p[SEISMO_MAX_PAYLOAD];
    uint16_t offset = 14U;

    PutU32(&p[0], currentEvent.eventId);
    PutU32(&p[4], samples[0].sampleIndex);
    PutU32(&p[8], samples[0].timestampMs);
    p[12] = count;
    p[13] = 1U; /* raw XYZ counts followed by filtered XYZ milligravity */

    for (uint8_t i = 0U; i < count; i++)
    {
        PutU16(&p[offset], (uint16_t)samples[i].rawX); offset += 2U;
        PutU16(&p[offset], (uint16_t)samples[i].rawY); offset += 2U;
        PutU16(&p[offset], (uint16_t)samples[i].rawZ); offset += 2U;
        PutU16(&p[offset], (uint16_t)samples[i].filteredXmg); offset += 2U;
        PutU16(&p[offset], (uint16_t)samples[i].filteredYmg); offset += 2U;
        PutU16(&p[offset], (uint16_t)samples[i].filteredZmg); offset += 2U;
    }

    SendFrame(SEISMO_PKT_EVENT_DATA, p, offset);
}

static void SendEventEnd(uint32_t transmittedSamples)
{
    uint8_t p[20] = {0};
    PutU32(&p[0], currentEvent.eventId);
    PutU32(&p[4], PRETRIGGER_SAMPLES + POSTTRIGGER_SAMPLES);
    PutU32(&p[8], (PRETRIGGER_SAMPLES + POSTTRIGGER_SAMPLES) *
                   SAMPLE_INTERVAL_MS);
    PutU16(&p[12], currentEvent.triggerRmsMg);
    p[14] = 0U; /* 0 = fixed 60-second post-trigger capture completed */
    p[15] = 0U;
    PutU32(&p[16], POSTTRIGGER_SAMPLES - transmittedSamples);
    SendFrame(SEISMO_PKT_EVENT_END, p, sizeof(p));
}

HAL_StatusTypeDef Seismo_Init(void)
{
    sampleQueue = osMessageQueueNew(SAMPLE_QUEUE_LENGTH,
                                    sizeof(ADXL345_Sample), NULL);
    eventQueue = osMessageQueueNew(EVENT_QUEUE_LENGTH,
                                   sizeof(SeismoWireSample), NULL);

    if ((sampleQueue == NULL) || (eventQueue == NULL))
        return HAL_ERROR;

    const osThreadAttr_t samplingAttr = {
        .name = "SamplingTask",
        .stack_size = 1024U,
        .priority = osPriorityHigh
    };
    const osThreadAttr_t processingAttr = {
        .name = "ProcessingTask",
        .stack_size = 2048U,
        .priority = osPriorityAboveNormal
    };
    const osThreadAttr_t eventAttr = {
        .name = "EventTask",
        .stack_size = 2048U,
        .priority = osPriorityNormal
    };

    samplingTaskHandle = osThreadNew(SamplingTask, NULL, &samplingAttr);
    if (samplingTaskHandle == NULL)
        return HAL_ERROR;

    if (osThreadNew(ProcessingTask, NULL, &processingAttr) == NULL)
        return HAL_ERROR;

    eventTaskHandle = osThreadNew(EventTask, NULL, &eventAttr);
    if (eventTaskHandle == NULL)
        return HAL_ERROR;

    DebugText("SEISMO protocol v1 ready; USART1 is binary link\r\n");
    return HAL_OK;
}

void Seismo_DataReadyISR(void)
{
    if (samplingTaskHandle != NULL)
        (void)osThreadFlagsSet(samplingTaskHandle, DATA_READY_FLAG);
}

static void SamplingTask(void *argument)
{
    (void)argument;
    ADXL345_Sample sample;
    uint8_t fifoCount = 0U;
    uint8_t interruptSource = 0U;

    for (;;)
    {
        (void)osThreadFlagsWait(DATA_READY_FLAG, osFlagsWaitAny, 100U);

        if (ADXL345_ReadInterruptSource(&interruptSource) == HAL_OK)
        {
            if ((interruptSource & 0x01U) != 0U)
                fifoOverruns++;
        }
        else
        {
            i2cErrorCount++;
            sensorHealthy = 0U;
        }

        for (;;)
        {
            if (ADXL345_ReadFifoCount(&fifoCount) != HAL_OK)
            {
                i2cErrorCount++;
                sensorHealthy = 0U;
                break;
            }
            if (fifoCount == 0U)
                break;

            uint32_t newestTimestamp = HAL_GetTick();

            for (uint8_t i = 0U; i < fifoCount; i++)
            {
                if (ADXL345_ReadFifoSample(&sample) != HAL_OK)
                {
                    i2cErrorCount++;
                    sensorHealthy = 0U;
                    break;
                }

                uint32_t behind = (uint32_t)(fifoCount - 1U - i);
                sample.timestamp_ms =
                    newestTimestamp - behind * SAMPLE_INTERVAL_MS;

                capturedCount++;
                if (osMessageQueuePut(sampleQueue, &sample, 0U, 0U) != osOK)
                    sampleQueueDrops++;
                else
                    sensorHealthy = 1U;
            }
        }
    }
}

static void ProcessingTask(void *argument)
{
    (void)argument;
    ADXL345_Sample input;
    SeismoWireSample sample;
    SeismoFilter filter;
    SeismoDetector detector;
    uint32_t sampleIndex = 0U;

    SeismoFilter_Init(&filter);
    SeismoDetector_Init(&detector);

    for (;;)
    {
        if (osMessageQueueGet(sampleQueue, &input, NULL, 100U) != osOK)
            continue;

        if (eventComplete != 0U)
        {
            eventComplete = 0U;
            SeismoDetector_Rearm(&detector);
        }

        sample.timestampMs = input.timestamp_ms;
        sample.sampleIndex = sampleIndex++;
        sample.rawX = input.rawX;
        sample.rawY = input.rawY;
        sample.rawZ = input.rawZ;
        sample.filteredXmg = SeismoFilter_Process(&filter, 0U, input.rawX);
        sample.filteredYmg = SeismoFilter_Process(&filter, 1U, input.rawY);
        sample.filteredZmg = SeismoFilter_Process(&filter, 2U, input.rawZ);
        lastSampleIndex = sample.sampleIndex;

        preRing[preWriteIndex] = sample;
        preWriteIndex = (uint16_t)((preWriteIndex + 1U) %
                                   PRETRIGGER_SAMPLES);
        if (preCount < PRETRIGGER_SAMPLES)
            preCount++;

        if (eventActive != 0U)
        {
            if (postRemaining > 0U)
            {
                if (osMessageQueuePut(eventQueue, &sample, 0U, 0U) != osOK)
                    eventQueueDrops++;
                postRemaining--;
            }
            continue;
        }

        if ((preCount == PRETRIGGER_SAMPLES) &&
            SeismoDetector_Push(&detector, sample.filteredXmg,
                                sample.filteredYmg, sample.filteredZmg))
        {
            uint16_t oldest = preWriteIndex;
            for (uint16_t i = 0U; i < PRETRIGGER_SAMPLES; i++)
                preSnapshot[i] =
                    preRing[(oldest + i) % PRETRIGGER_SAMPLES];

            currentEvent.eventId = nextEventId++;
            currentEvent.triggerIndex = sample.sampleIndex;
            currentEvent.triggerTimestampMs = sample.timestampMs;
            currentEvent.triggerRmsMg =
                (uint16_t)(detector.currentRmsMg > 65535.0f ?
                           65535.0f : detector.currentRmsMg);
            currentEvent.thresholdMg =
                (uint16_t)(detector.thresholdMg > 65535.0f ?
                           65535.0f : detector.thresholdMg);

            postRemaining = POSTTRIGGER_SAMPLES;
            eventActive = 1U;
            detector.triggered = 1U;
            (void)osThreadFlagsSet(eventTaskHandle, EVENT_READY_FLAG);
        }
    }
}

static void EventTask(void *argument)
{
    (void)argument;
    uint32_t lastHeartbeat = HAL_GetTick();
    uint32_t lastStatus = lastHeartbeat;

    for (;;)
    {
        uint32_t now = HAL_GetTick();

        if ((uint32_t)(now - lastHeartbeat) >= HEARTBEAT_PERIOD_MS)
        {
            lastHeartbeat = now;
            SendHeartbeat();
        }
        if ((uint32_t)(now - lastStatus) >= STATUS_PERIOD_MS)
        {
            lastStatus = now;
            SendStatus();
        }

        uint32_t flags = osThreadFlagsWait(EVENT_READY_FLAG,
                                           osFlagsWaitAny, 100U);

        /*
         * CMSIS-RTOS2 timeout/error values have high bits set and can
         * also contain EVENT_READY_FLAG in their low bits. Compare the
         * complete return value so a timeout can never start an event.
         */
        if (flags != EVENT_READY_FLAG)
            continue;

        SendEventStart(&currentEvent);

        /* Send the frozen 10-second pre-trigger history in chronological order. */
        for (uint16_t base = 0U; base < PRETRIGGER_SAMPLES;
             base += SAMPLES_PER_PACKET)
        {
            SendEventData(&preSnapshot[base], SAMPLES_PER_PACKET);

            now = HAL_GetTick();
            if ((uint32_t)(now - lastHeartbeat) >= HEARTBEAT_PERIOD_MS)
            {
                lastHeartbeat = now;
                SendHeartbeat();
            }
            if ((uint32_t)(now - lastStatus) >= STATUS_PERIOD_MS)
            {
                lastStatus = now;
                SendStatus();
            }
        }

        /* Then send the next 6,000 samples (60 seconds) as they arrive. */
        uint32_t transmittedPostSamples = 0U;
        SeismoWireSample batch[SAMPLES_PER_PACKET];
        uint8_t batchCount = 0U;

        for (;;)
        {
            if (osMessageQueueGet(eventQueue, &batch[batchCount],
                                  NULL, 50U) == osOK)
            {
                batchCount++;
                transmittedPostSamples++;

                if (batchCount == SAMPLES_PER_PACKET)
                {
                    SendEventData(batch, batchCount);
                    batchCount = 0U;
                }
            }
            else if ((postRemaining == 0U) &&
                     (osMessageQueueGetCount(eventQueue) == 0U))
            {
                break;
            }

            now = HAL_GetTick();
            if ((uint32_t)(now - lastHeartbeat) >= HEARTBEAT_PERIOD_MS)
            {
                lastHeartbeat = now;
                SendHeartbeat();
            }
            if ((uint32_t)(now - lastStatus) >= STATUS_PERIOD_MS)
            {
                lastStatus = now;
                SendStatus();
            }
        }

        if (batchCount > 0U)
            SendEventData(batch, batchCount);

        SendEventEnd(transmittedPostSamples);
        eventActive = 0U;
        eventComplete = 1U;
        DebugText("SEISMO event transfer complete\r\n");
    }
}
