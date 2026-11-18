
#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <SocketIOclient.h>
#include <time.h>
#include <sys/time.h>
#include <esp_system.h>

// ============================================================
// WIFI CONFIGURATION
// ============================================================

// const char* WIFI_SSID = "T4G";
// const char* WIFI_PASSWORD = "admin@123";
const char* WIFI_SSID = "Galaxy S21 FE 5G 4e5e";
const char* WIFI_PASSWORD = "xofs0704";
// ============================================================
// SOCKET.IO SERVER
// ============================================================

#define SERVER_HOST "api.tejassvi.dev"
#define SERVER_PORT 443
// #define SERVER_HOST "192.168.1.61"
// #define SERVER_PORT 9001


#define SOCKET_PATH "/socket.io/?EIO=4"

// ============================================================
// STM32 UART
// ============================================================

#define STM32_RX_PIN 16
#define STM32_TX_PIN 17
#define STM32_BAUD 115200
#define UART_RX_BUFFER 4096

// ============================================================
// STM32 PROTOCOL
// ============================================================

#define PROTOCOL_VERSION 1
#define MAX_PAYLOAD 134
#define MAX_FRAME 148

#define PKT_HEARTBEAT  0x01
#define PKT_STATUS     0x02
#define PKT_EVENT_START 0x10
#define PKT_EVENT_DATA  0x11
#define PKT_EVENT_END   0x12

#define DEFAULT_MODULE_ID 0x00001001UL

// ============================================================
// OBJECTS
// ============================================================

HardwareSerial STM32Serial(2);
SocketIOclient socketIO;
Preferences preferences;

// ============================================================
// MODULE ID
// ============================================================

uint32_t moduleId = DEFAULT_MODULE_ID;

// ============================================================
// CONNECTION STATE
// ============================================================

bool wifiStarted = false;
bool socketStarted = false;
bool socketConnected = false;

uint32_t lastWiFiAttempt = 0;
bool wasWifiConnected = false;
bool ntpConfigured = false;
uint32_t lastNtpWaitPrint = 0;
bool ntpSyncReported = false;

// Unique identifier for this ESP32 power-on session.
char gatewayBootId[17] = {0};

// STM32 uptime <-> UTC mapping, refreshed by each valid heartbeat.
bool haveHeartbeatTick = false;
uint32_t lastHeartbeatRawTick = 0;
uint64_t latestStm32ExtendedMs = 0;
bool utcMappingValid = false;
int64_t latestUtcOffsetMs = 0;
uint32_t lastHeartbeatRxMillis = 0;

// ============================================================
// UART PARSER
// ============================================================

uint8_t frameBuffer[MAX_FRAME];

uint16_t framePosition = 0;
uint16_t expectedFrameLength = 0;

// ============================================================
// STATISTICS
// ============================================================

uint32_t receivedBytes = 0;
uint32_t validFrames = 0;
uint32_t crcErrors = 0;
uint32_t invalidFrames = 0;

uint32_t sentSamples = 0;
uint32_t sendErrors = 0;
uint32_t queueDrops = 0;

// ============================================================
// EVENT STATE
// ============================================================

uint32_t currentEventId = 0;
uint32_t eventSamplesReceived = 0;
uint32_t eventPacketsReceived = 0;

// ============================================================
// SAMPLE QUEUE
//
// Stores samples temporarily while Socket.IO catches up.
// 1024 samples = approximately 10.24 seconds at 100 Hz.
// ============================================================

#define SAMPLE_QUEUE_CAPACITY 1024

struct SampleRecord {
    uint32_t eventId;
    uint32_t sampleIndex;
    uint32_t timestampMs;

    int16_t rawX;
    int16_t rawY;
    int16_t rawZ;

    int16_t filteredX;
    int16_t filteredY;
    int16_t filteredZ;

    uint64_t unixTimeMs;
    bool timeSynced;
    uint8_t timeQualityCode;
};

SampleRecord sampleQueue[SAMPLE_QUEUE_CAPACITY];

uint16_t queueHead = 0;
uint16_t queueTail = 0;
uint16_t queueCount = 0;

// A single event uses a frozen clock offset so an NTP clock correction
// cannot introduce a timestamp jump in the middle of its waveform.
bool eventTimeSynced = false;
int64_t eventUtcOffsetMs = 0;
uint64_t eventTriggerExtendedMs = 0;
uint64_t eventDetectedUnixMs = 0;
uint64_t eventCaptureStartUnixMs = 0;
uint64_t eventLastSampleUnixMs = 0;
bool eventHasSampleTime = false;
char eventTimeQuality[32] = "unsynchronized";
uint8_t eventTimeQualityCode = 0; // 0=unsynchronized, 1=heartbeat map, 2=event anchor
uint32_t eventHeartbeatMappingAgeMs = 0xFFFFFFFFUL;

// ============================================================
// LITTLE ENDIAN HELPERS
// ============================================================

uint16_t readU16(const uint8_t* p) {
    return (uint16_t)p[0] |
           ((uint16_t)p[1] << 8);
}

uint32_t readU32(const uint8_t* p) {
    return (uint32_t)p[0] |
           ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

int16_t readI16(const uint8_t* p) {
    return (int16_t)readU16(p);
}

// ============================================================
// CRC-16/CCITT-FALSE
// ============================================================

uint16_t calculateCRC16(
    const uint8_t* data,
    uint16_t length
) {
    uint16_t crc = 0xFFFF;

    for (uint16_t i = 0; i < length; i++) {
        crc ^= (uint16_t)data[i] << 8;

        for (uint8_t bit = 0; bit < 8; bit++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }

    return crc;
}

// ============================================================
// NTP / UTC CLOCK HELPERS
// ============================================================

// Treat the clock as synchronized only after it has reached a plausible
// post-2024 Unix epoch. Until then, UTC fields are sent as 0 with
// time_synced=false; device uptime is always retained.
bool isTimeSynced() {
    return time(nullptr) >= 1704067200;
}

uint64_t getUnixTimeMs() {
    if (!isTimeSynced()) {
        return 0;
    }

    struct timeval tv;
    gettimeofday(&tv, nullptr);

    return (uint64_t)tv.tv_sec * 1000ULL +
           (uint64_t)tv.tv_usec / 1000ULL;
}

void startNTP() {
    // Keep the ESP32 system clock in UTC. Convert to IST only in the UI.
    configTzTime(
        "UTC0",
        "pool.ntp.org",
        "time.google.com",
        "time.cloudflare.com"
    );

    ntpConfigured = true;
    Serial.println("[NTP] Synchronization started (UTC)");
}

void updateNTPStatus() {
    if (isTimeSynced()) {
        if (!ntpSyncReported) {
            ntpSyncReported = true;
            Serial.printf(
                "[NTP] Clock synchronized. Unix time: %llu ms\n",
                (unsigned long long)getUnixTimeMs()
            );
        }
    } else if (millis() - lastNtpWaitPrint >= 5000) {
        lastNtpWaitPrint = millis();
        Serial.println("[NTP] Waiting for time synchronization; waveform capture continues");
    }
}

void createGatewayBootId() {
    uint32_t high = esp_random();
    uint32_t low = esp_random();

    snprintf(
        gatewayBootId,
        sizeof(gatewayBootId),
        "%08lX%08lX",
        (unsigned long)high,
        (unsigned long)low
    );

    Serial.printf("[GATEWAY] Boot ID: %s\n", gatewayBootId);
}

// Extend a 32-bit STM32 millisecond tick to the epoch nearest a known
// 64-bit STM32 uptime reference. This handles the ~49.7-day uint32 wrap.
uint64_t extendTickNearReference(uint32_t rawTick, uint64_t referenceMs) {
    const uint64_t WRAP = 0x100000000ULL;
    const uint64_t HALF_WRAP = 0x80000000ULL;

    uint64_t candidate = (referenceMs & ~(WRAP - 1ULL)) | rawTick;

    if (candidate + HALF_WRAP < referenceMs) {
        candidate += WRAP;
    } else if (candidate > referenceMs + HALF_WRAP && candidate >= WRAP) {
        candidate -= WRAP;
    }

    return candidate;
}

uint64_t mapRawStm32TickToUnixMs(uint32_t rawTick, int64_t offsetMs) {
    uint64_t extendedTick = haveHeartbeatTick
        ? extendTickNearReference(rawTick, latestStm32ExtendedMs)
        : (uint64_t)rawTick;

    int64_t mapped = (int64_t)extendedTick + offsetMs;
    return mapped > 0 ? (uint64_t)mapped : 0;
}

const char* currentTimeQuality() {
    if (!isTimeSynced()) return "unsynchronized";
    if (WiFi.status() == WL_CONNECTED) return "ntp_clock";
    return "ntp_holdover";
}

const char* eventTimeQualityName(uint8_t code) {
    switch (code) {
        case 1: return "ntp_heartbeat_map";
        case 2: return "ntp_event_anchor";
        default: return "unsynchronized";
    }
}

// ============================================================
// MODULE ID STORAGE
// ============================================================

void setupModuleID() {

    preferences.begin("seismo", false);

    if (!preferences.isKey("module_id")) {
        preferences.putUInt(
            "module_id",
            DEFAULT_MODULE_ID
        );
    }

    moduleId = preferences.getUInt(
        "module_id",
        DEFAULT_MODULE_ID
    );

    preferences.end();

    Serial.printf(
        "[MODULE] ID: 0x%08lX\n",
        (unsigned long)moduleId
    );
}

// ============================================================
// SOCKET.IO EVENT SENDER
// ============================================================

bool sendNamedEvent(
    const char* eventName,
    const char* json
) {
    if (!socketConnected) {
        return false;
    }

    char packet[768];

    int length = snprintf(
        packet,
        sizeof(packet),
        "[\"%s\",%s]",
        eventName,
        json
    );

    if (length <= 0 || length >= sizeof(packet)) {
        return false;
    }

    bool queued = socketIO.sendEVENT(packet);

    if (!queued) {
        Serial.printf("[SOCKET TX FAILED] event=%s\n", eventName);
    }

    return queued;
}

// ============================================================
// SOCKET.IO CALLBACK
// ============================================================

void socketEvent(
    socketIOmessageType_t type,
    uint8_t* payload,
    size_t length
) {

    switch (type) {

        case sIOtype_CONNECT:

            // In Links2004 SocketIOclient, this callback is raised when the
            // underlying WebSocket transport connects. For Socket.IO v3/v4,
            // explicitly join the default namespace before emitting events.
            socketConnected = false;
            Serial.println("\n[WEBSOCKET] Transport connected; joining Socket.IO namespace...");

            if (socketIO.send(sIOtype_CONNECT, "")) {
                // Default namespace CONNECT must be encoded as 40 (not 40/).
                // TCP preserves ordering, so subsequent EVENT packets follow it.
                socketConnected = true;
                Serial.println("[SOCKET.IO] Default namespace CONNECT packet sent (40)");

                char json[224];
                snprintf(
                    json,
                    sizeof(json),
                    "{\"module_id\":%lu,"
                    "\"gateway_boot_id\":\"%s\","
                    "\"protocol_version\":1,"
                    "\"firmware\":\"ESP32-Gateway-V3-NTP\"}",
                    (unsigned long)moduleId,
                    gatewayBootId
                );

                sendNamedEvent("gateway_hello", json);
            } else {
                Serial.println("[SOCKET.IO] Failed to send namespace CONNECT packet");
            }

            break;

        case sIOtype_DISCONNECT:

            socketConnected = false;

            Serial.println(
                "[SOCKET.IO] Disconnected"
            );

            break;

        case sIOtype_ERROR:

            Serial.println(
                "[SOCKET.IO] Server error"
            );

            if (payload && length) {
                Serial.write(payload, length);
                Serial.println();
            }

            break;

        default:
            break;
    }
}

// ============================================================
// WIFI CONNECTION
// ============================================================

void startWiFi() {

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    WiFi.begin(
        WIFI_SSID,
        WIFI_PASSWORD
    );

    wifiStarted = true;
    lastWiFiAttempt = millis();

    Serial.println("[WIFI] Connecting...");
}

void maintainWiFi() {

    if (WiFi.status() != WL_CONNECTED) {
        if (wasWifiConnected) {
            wasWifiConnected = false;
            ntpConfigured = false;
            Serial.println("[WIFI] Link lost; ESP32 clock will continue in holdover");
        }

        if (socketStarted) {
            socketIO.disconnect();
            socketStarted = false;
            socketConnected = false;
        }

        if (millis() - lastWiFiAttempt >= 10000) {
            lastWiFiAttempt = millis();
            Serial.println("[WIFI] Reconnecting...");

            if (!wifiStarted) {
                startWiFi();
            } else {
                WiFi.reconnect();
            }
        }

        return;
    }

    if (!wasWifiConnected) {
        wasWifiConnected = true;
        ntpConfigured = false;
        Serial.println("\n[WIFI] Connected!");
        Serial.print("[WIFI] IP: ");
        Serial.println(WiFi.localIP());
    }

    if (!ntpConfigured) {
        startNTP();
    }

    if (!socketStarted) {
        Serial.println("[SOCKET.IO] Starting secure connection...");

        socketIO.onEvent(socketEvent);
        socketIO.setReconnectInterval(5000);

        socketIO.beginSSL(
            SERVER_HOST,
            SERVER_PORT,
            SOCKET_PATH,
            ""
        );

        // socketIO.begin(SERVER_HOST, SERVER_PORT, "/socket.io/?EIO=4");

        socketStarted = true;
    }
}

// ============================================================
// HEARTBEAT
// ============================================================

void handleHeartbeat(const uint8_t* p) {

    uint32_t tick = readU32(&p[0]);
    uint32_t sampleIndex = readU32(&p[4]);

    uint8_t eventActive = p[8];
    uint8_t sensorHealthy = p[9];
    uint16_t txErrors = readU16(&p[10]);

    // Extend STM32's 32-bit uptime counter, including its rollover.
    if (!haveHeartbeatTick) {
        latestStm32ExtendedMs = tick;
        haveHeartbeatTick = true;
    } else {
        uint32_t delta = tick - lastHeartbeatRawTick;
        if (delta < 0x80000000UL) {
            latestStm32ExtendedMs += delta;
        }
    }

    lastHeartbeatRawTick = tick;
    lastHeartbeatRxMillis = millis();

    uint64_t nowUtcMs = getUnixTimeMs();
    if (nowUtcMs != 0) {
        // This is an approximate offset: it includes UART/firmware delivery
        // latency. Sample index remains the authoritative sample ordering.
        latestUtcOffsetMs = (int64_t)nowUtcMs - (int64_t)latestStm32ExtendedMs;
        utcMappingValid = true;
    }

    uint64_t mappedUtcMs = 0;
    if (utcMappingValid) {
        int64_t mapped = (int64_t)latestStm32ExtendedMs + latestUtcOffsetMs;
        if (mapped > 0) mappedUtcMs = (uint64_t)mapped;
    }

    char json[384];
    snprintf(
        json,
        sizeof(json),
        "{"
        "\"module_id\":%lu,"
        "\"gateway_boot_id\":\"%s\","
        "\"timestamp_ms\":%lu,"
        "\"device_uptime_ms\":%lu,"
        "\"unix_time_ms\":%llu,"
        "\"time_synced\":%s,"
        "\"time_quality\":\"%s\","
        "\"sample_index\":%lu,"
        "\"event_active\":%u,"
        "\"sensor_healthy\":%u,"
        "\"tx_errors\":%u"
        "}",
        (unsigned long)moduleId,
        gatewayBootId,
        (unsigned long)tick,
        (unsigned long)tick,
        (unsigned long long)mappedUtcMs,
        mappedUtcMs ? "true" : "false",
        currentTimeQuality(),
        (unsigned long)sampleIndex,
        eventActive,
        sensorHealthy,
        txErrors
    );

    sendNamedEvent("sensor_heartbeat", json);
}

// ============================================================
// STATUS
// ============================================================

void handleStatus(const uint8_t* p) {

    uint32_t captured = readU32(&p[0]);
    uint32_t i2cErrors = readU32(&p[4]);
    uint32_t sampleDrops = readU32(&p[8]);
    uint32_t eventDrops = readU32(&p[12]);
    uint32_t fifoOverruns = readU32(&p[16]);
    uint32_t lastSample = readU32(&p[20]);

    char json[480];
    uint64_t nowUtcMs = getUnixTimeMs();

    snprintf(
        json,
        sizeof(json),
        "{"
        "\"module_id\":%lu,"
        "\"gateway_boot_id\":\"%s\","
        "\"unix_time_ms\":%llu,"
        "\"time_synced\":%s,"
        "\"time_quality\":\"%s\","
        "\"captured\":%lu,"
        "\"i2c_errors\":%lu,"
        "\"sample_drops\":%lu,"
        "\"event_drops\":%lu,"
        "\"fifo_overruns\":%lu,"
        "\"last_sample_index\":%lu"
        "}",
        (unsigned long)moduleId,
        gatewayBootId,
        (unsigned long long)nowUtcMs,
        nowUtcMs ? "true" : "false",
        currentTimeQuality(),
        (unsigned long)captured,
        (unsigned long)i2cErrors,
        (unsigned long)sampleDrops,
        (unsigned long)eventDrops,
        (unsigned long)fifoOverruns,
        (unsigned long)lastSample
    );

    sendNamedEvent(
        "sensor_status",
        json
    );

    Serial.printf(
        "[STATUS] Captured=%lu I2C=%lu FIFO=%lu\n",
        (unsigned long)captured,
        (unsigned long)i2cErrors,
        (unsigned long)fifoOverruns
    );
}

// ============================================================
// EVENT START
// ============================================================

void handleEventStart(const uint8_t* p) {

    currentEventId = readU32(&p[0]);

    uint32_t triggerIndex = readU32(&p[4]);
    uint32_t triggerTime = readU32(&p[8]);

    uint16_t preSamples = readU16(&p[12]);
    uint32_t postSamples = readU32(&p[14]);

    uint16_t sampleRate = readU16(&p[18]);
    uint16_t triggerRms = readU16(&p[20]);
    uint16_t threshold = readU16(&p[22]);

    eventSamplesReceived = 0;
    eventPacketsReceived = 0;
    eventHasSampleTime = false;
    eventLastSampleUnixMs = 0;

    // Freeze the latest NTP-to-STM32 mapping for this entire event.
    // If a heartbeat mapping is stale/unavailable but NTP is valid, anchor
    // approximately at event-start reception and label that lower-quality map.
    eventHeartbeatMappingAgeMs = haveHeartbeatTick
        ? millis() - lastHeartbeatRxMillis
        : 0xFFFFFFFFUL;

    eventTriggerExtendedMs = haveHeartbeatTick
        ? extendTickNearReference(triggerTime, latestStm32ExtendedMs)
        : (uint64_t)triggerTime;

    uint64_t nowUtcMs = getUnixTimeMs();
    eventTimeSynced = (nowUtcMs != 0);
    eventUtcOffsetMs = 0;
    eventDetectedUnixMs = 0;
    eventCaptureStartUnixMs = 0;

    if (eventTimeSynced && utcMappingValid && eventHeartbeatMappingAgeMs <= 5000) {
        eventUtcOffsetMs = latestUtcOffsetMs;
        eventTimeQualityCode = 1;
        snprintf(eventTimeQuality, sizeof(eventTimeQuality), "ntp_heartbeat_map");
    } else if (eventTimeSynced) {
        eventUtcOffsetMs = (int64_t)nowUtcMs - (int64_t)eventTriggerExtendedMs;
        eventTimeQualityCode = 2;
        snprintf(eventTimeQuality, sizeof(eventTimeQuality), "ntp_event_anchor");
    } else {
        eventTimeSynced = false;
        eventTimeQualityCode = 0;
        snprintf(eventTimeQuality, sizeof(eventTimeQuality), "unsynchronized");
    }

    if (eventTimeSynced) {
        int64_t detected = (int64_t)eventTriggerExtendedMs + eventUtcOffsetMs;
        if (detected > 0) eventDetectedUnixMs = (uint64_t)detected;

        uint64_t preTriggerMs = sampleRate
            ? ((uint64_t)preSamples * 1000ULL) / sampleRate
            : 0;

        if (eventDetectedUnixMs > preTriggerMs) {
            eventCaptureStartUnixMs = eventDetectedUnixMs - preTriggerMs;
        }
    }

    char json[640];

    snprintf(
        json,
        sizeof(json),
        "{"
        "\"module_id\":%lu,"
        "\"gateway_boot_id\":\"%s\","
        "\"event_id\":%lu,"
        "\"trigger_index\":%lu,"
        "\"trigger_timestamp_ms\":%lu,"
        "\"detected_at_unix_ms\":%llu,"
        "\"capture_started_at_unix_ms\":%llu,"
        "\"time_synced\":%s,"
        "\"time_quality\":\"%s\","
        "\"heartbeat_mapping_age_ms\":%lu,"
        "\"pre_samples\":%u,"
        "\"post_samples\":%lu,"
        "\"sample_rate_hz\":%u,"
        "\"trigger_rms_mg\":%u,"
        "\"threshold_mg\":%u"
        "}",
        (unsigned long)moduleId,
        gatewayBootId,
        (unsigned long)currentEventId,
        (unsigned long)triggerIndex,
        (unsigned long)triggerTime,
        (unsigned long long)eventDetectedUnixMs,
        (unsigned long long)eventCaptureStartUnixMs,
        eventTimeSynced ? "true" : "false",
        eventTimeQuality,
        (unsigned long)eventHeartbeatMappingAgeMs,
        preSamples,
        (unsigned long)postSamples,
        sampleRate,
        triggerRms,
        threshold
    );

    sendNamedEvent("event_start", json);

    Serial.printf(
        "\n[EVENT START] ID=%lu Module=%08lX UTC=%llu Synced=%s Quality=%s\n",
        (unsigned long)currentEventId,
        (unsigned long)moduleId,
        (unsigned long long)eventDetectedUnixMs,
        eventTimeSynced ? "yes" : "no",
        eventTimeQuality
    );
}

// ============================================================
// SAMPLE QUEUE
// ============================================================

void enqueueSample(const SampleRecord& sample) {

    if (queueCount >= SAMPLE_QUEUE_CAPACITY) {
        queueDrops++;
        return;
    }

    sampleQueue[queueHead] = sample;

    queueHead = (
        queueHead + 1
    ) % SAMPLE_QUEUE_CAPACITY;

    queueCount++;
}

// ============================================================
// EVENT DATA
// ============================================================

void handleEventData(
    const uint8_t* p,
    uint16_t length
) {

    if (length < 14) {
        invalidFrames++;
        return;
    }

    uint32_t eventId = readU32(&p[0]);
    uint32_t firstSample = readU32(&p[4]);
    uint32_t firstTimestamp = readU32(&p[8]);

    uint8_t sampleCount = p[12];
    uint8_t format = p[13];

    if (format != 1 ||
        sampleCount == 0 ||
        sampleCount > 10 ||
        length != (uint16_t)(14 + sampleCount * 12)) {

        invalidFrames++;
        return;
    }

    if (currentEventId == 0 ||
        eventId != currentEventId) {

        invalidFrames++;
        return;
    }

    for (uint8_t i = 0; i < sampleCount; i++) {

        const uint8_t* s = &p[14 + i * 12];

        SampleRecord sample;

        sample.eventId = eventId;
        sample.sampleIndex = firstSample + i;
        sample.timestampMs = firstTimestamp + i * 10;

        sample.rawX = readI16(&s[0]);
        sample.rawY = readI16(&s[2]);
        sample.rawZ = readI16(&s[4]);

        sample.filteredX = readI16(&s[6]);
        sample.filteredY = readI16(&s[8]);
        sample.filteredZ = readI16(&s[10]);

        sample.timeSynced = eventTimeSynced;
        sample.timeQualityCode = eventTimeQualityCode;
        sample.unixTimeMs = 0;

        if (eventTimeSynced) {
            uint64_t extendedSampleTick = extendTickNearReference(
                sample.timestampMs,
                eventTriggerExtendedMs
            );

            int64_t mappedUtc = (int64_t)extendedSampleTick + eventUtcOffsetMs;
            if (mappedUtc > 0) {
                sample.unixTimeMs = (uint64_t)mappedUtc;
                eventLastSampleUnixMs = sample.unixTimeMs;
                eventHasSampleTime = true;
            } else {
                sample.timeSynced = false;
            }
        }

        enqueueSample(sample);
    }

    eventSamplesReceived += sampleCount;
    eventPacketsReceived++;
}

// ============================================================
// FORWARD QUEUED SAMPLES TO SOCKET.IO
// ============================================================

void forwardQueuedSamples(uint8_t maxPerLoop) {

    if (!socketConnected) {
        return;
    }

    uint8_t processed = 0;

    while (queueCount > 0 &&
           processed < maxPerLoop) {

        const SampleRecord& s = sampleQueue[queueTail];

        char json[560];

        float xG = s.filteredX / 1000.0f;
        float yG = s.filteredY / 1000.0f;
        float zG = s.filteredZ / 1000.0f;

        snprintf(
            json,
            sizeof(json),
            "{"
            "\"module_id\":%lu,"
            "\"gateway_boot_id\":\"%s\","
            "\"event_id\":%lu,"
            "\"sample_index\":%lu,"
            "\"timestamp_ms\":%lu,"
            "\"device_uptime_ms\":%lu,"
            "\"unix_time_ms\":%llu,"
            "\"time_synced\":%s,"
            "\"time_quality\":\"%s\","
            "\"raw_x\":%d,"
            "\"raw_y\":%d,"
            "\"raw_z\":%d,"
            "\"x_g\":%.3f,"
            "\"y_g\":%.3f,"
            "\"z_g\":%.3f"
            "}",
            (unsigned long)moduleId,
            gatewayBootId,
            (unsigned long)s.eventId,
            (unsigned long)s.sampleIndex,
            (unsigned long)s.timestampMs,
            (unsigned long)s.timestampMs,
            (unsigned long long)s.unixTimeMs,
            s.timeSynced ? "true" : "false",
            eventTimeQualityName(s.timeQualityCode),
            s.rawX,
            s.rawY,
            s.rawZ,
            xG,
            yG,
            zG
        );

        if (!sendNamedEvent(
                "sensor_data",
                json
            )) {

            sendErrors++;
            break;
        }

        queueTail = (
            queueTail + 1
        ) % SAMPLE_QUEUE_CAPACITY;

        queueCount--;

        sentSamples++;
        processed++;
    }
}

// ============================================================
// EVENT END
// ============================================================

void handleEventEnd(const uint8_t* p) {

    uint32_t eventId = readU32(&p[0]);
    uint32_t totalSamples = readU32(&p[4]);
    uint32_t durationMs = readU32(&p[8]);

    uint16_t triggerRms = readU16(&p[12]);
    uint8_t reason = p[14];
    uint32_t missingSamples = readU32(&p[16]);

    char json[480];

    snprintf(
        json,
        sizeof(json),
        "{"
        "\"module_id\":%lu,"
        "\"gateway_boot_id\":\"%s\","
        "\"event_id\":%lu,"
        "\"total_samples\":%lu,"
        "\"duration_ms\":%lu,"
        "\"trigger_rms_mg\":%u,"
        "\"end_reason\":%u,"
        "\"missing_samples\":%lu,"
        "\"received_samples\":%lu,"
        "\"capture_ended_at_unix_ms\":%llu,"
        "\"time_synced\":%s,"
        "\"time_quality\":\"%s\""
        "}",
        (unsigned long)moduleId,
        gatewayBootId,
        (unsigned long)eventId,
        (unsigned long)totalSamples,
        (unsigned long)durationMs,
        triggerRms,
        reason,
        (unsigned long)missingSamples,
        (unsigned long)eventSamplesReceived,
        (unsigned long long)eventLastSampleUnixMs,
        eventTimeSynced ? "true" : "false",
        eventTimeQuality
    );

    sendNamedEvent("event_end", json);

    Serial.printf(
        "\n[EVENT END] ID=%lu Total=%lu Received=%lu EndUTC=%llu TimeSynced=%s\n",
        (unsigned long)eventId,
        (unsigned long)totalSamples,
        (unsigned long)eventSamplesReceived,
        (unsigned long long)eventLastSampleUnixMs,
        eventTimeSynced ? "yes" : "no"
    );

    currentEventId = 0;
}

// ============================================================
// FRAME PROCESSOR
// ============================================================

void processFrame(const uint8_t* frame) {

    uint8_t version = frame[2];
    uint8_t type = frame[3];

    uint16_t payloadLength = readU16(&frame[10]);

    const uint8_t* p = &frame[12];

    if (version != PROTOCOL_VERSION) {
        invalidFrames++;
        return;
    }

    validFrames++;

    switch (type) {

        case PKT_HEARTBEAT:

            if (payloadLength == 12)
                handleHeartbeat(p);
            else
                invalidFrames++;

            break;

        case PKT_STATUS:

            if (payloadLength == 24)
                handleStatus(p);
            else
                invalidFrames++;

            break;

        case PKT_EVENT_START:

            if (payloadLength == 24)
                handleEventStart(p);
            else
                invalidFrames++;

            break;

        case PKT_EVENT_DATA:

            handleEventData(p, payloadLength);
            break;

        case PKT_EVENT_END:

            if (payloadLength == 20)
                handleEventEnd(p);
            else
                invalidFrames++;

            break;

        default:
            invalidFrames++;
            break;
    }
}

// ============================================================
// UART BYTE PARSER
// ============================================================

void resetParser() {

    framePosition = 0;
    expectedFrameLength = 0;
}

void parseByte(uint8_t b) {

    if (framePosition == 0) {

        if (b == 0xAA) {
            frameBuffer[framePosition++] = b;
        }

        return;
    }

    if (framePosition == 1) {

        if (b == 0x55) {
            frameBuffer[framePosition++] = b;
        }
        else if (b == 0xAA) {
            frameBuffer[0] = 0xAA;
        }
        else {
            resetParser();
        }

        return;
    }

    if (framePosition >= MAX_FRAME) {

        invalidFrames++;
        resetParser();

        return;
    }

    frameBuffer[framePosition++] = b;

    if (framePosition == 12) {

        uint16_t payloadLength =
            readU16(&frameBuffer[10]);

        if (payloadLength > MAX_PAYLOAD) {

            invalidFrames++;
            resetParser();

            return;
        }

        expectedFrameLength = 14 + payloadLength;
    }

    if (expectedFrameLength > 0 &&
        framePosition == expectedFrameLength) {

        uint16_t payloadLength =
            readU16(&frameBuffer[10]);

        uint16_t calculatedCRC =
            calculateCRC16(
                &frameBuffer[2],
                10 + payloadLength
            );

        uint16_t receivedCRC =
            readU16(
                &frameBuffer[12 + payloadLength]
            );

        if (calculatedCRC == receivedCRC) {

            processFrame(frameBuffer);

        } else {

            crcErrors++;
        }

        resetParser();
    }
}

// ============================================================
// SETUP
// ============================================================

void setup() {

    Serial.begin(115200);

    delay(500);

    Serial.println("\n====================================");
    Serial.println("    SEISMOGRAPH ESP32 GATEWAY V3");
    Serial.println("====================================");

    setupModuleID();
    createGatewayBootId();

    // Configure UART receive buffer before begin.
    STM32Serial.setRxBufferSize(UART_RX_BUFFER);

    STM32Serial.begin(
        STM32_BAUD,
        SERIAL_8N1,
        STM32_RX_PIN,
        STM32_TX_PIN
    );

    Serial.println("[UART] STM32 receiver initialized");

    startWiFi();

    Serial.println("[SYSTEM] Initialization complete");
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {

    // Keep Socket.IO alive.
    if (socketStarted) {
        socketIO.loop();
    }

    // Maintain Wi-Fi, NTP and Socket.IO connections.
    maintainWiFi();
    updateNTPStatus();

    // Receive STM32 bytes without lengthy logging.
    while (STM32Serial.available() > 0) {

        uint8_t b = STM32Serial.read();

        receivedBytes++;

        parseByte(b);
    }

    // Forward a limited number per iteration.
    // This leaves time for UART reception and socketIO.loop().
    forwardQueuedSamples(5);

    if (socketStarted) {
        socketIO.loop();
    }

    // Periodic diagnostics.
    static uint32_t lastStats = 0;

    if (millis() - lastStats >= 5000) {

        lastStats = millis();

        Serial.println("\n========== GATEWAY STATISTICS ==========");

        Serial.printf(
            "WiFi:            %s\n",
            WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected"
        );

        Serial.printf(
            "Socket.IO:       %s\n",
            socketConnected ? "Connected" : "Disconnected"
        );

        Serial.printf(
            "Module ID:       %08lX\n",
            (unsigned long)moduleId
        );

        Serial.printf(
            "Received Bytes:  %lu\n",
            (unsigned long)receivedBytes
        );

        Serial.printf(
            "Valid Frames:    %lu\n",
            (unsigned long)validFrames
        );

        Serial.printf(
            "CRC Errors:      %lu\n",
            (unsigned long)crcErrors
        );

        Serial.printf(
            "Invalid Frames:  %lu\n",
            (unsigned long)invalidFrames
        );

        Serial.printf(
            "Samples Sent:    %lu\n",
            (unsigned long)sentSamples
        );

        Serial.printf(
            "Send Errors:     %lu\n",
            (unsigned long)sendErrors
        );

        Serial.printf(
            "Queue Drops:     %lu\n",
            (unsigned long)queueDrops
        );

        Serial.printf(
            "Queue Pending:   %u\n",
            queueCount
        );

        Serial.println("========================================\n");
    }
}
