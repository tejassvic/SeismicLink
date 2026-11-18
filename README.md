# SeismoLink

**A distributed, embedded-to-cloud seismic monitoring and event-visualization system.**

SeismoLink is a multi-layer seismograph platform that captures ground vibration data at the edge, detects significant vibration events on an STM32-based sensor node, forwards waveform packets through an ESP32 Wi-Fi gateway, and stores and visualizes the resulting events through a Dockerized backend and web dashboard.

The repository contains the embedded firmware, gateway firmware, backend API and real-time transport, database, web interface, and a virtual-node simulator for demonstrations.


---

## Contents

- [System overview](#system-overview)
- [Architecture](#architecture)
- [Data flow](#data-flow)
- [Repository structure](#repository-structure)
- [Hardware](#hardware)
- [Embedded firmware](#embedded-firmware)
  - [STM32 sensor node](#stm32-sensor-node)
  - [ESP32 gateway](#esp32-gateway)
  - [UART packet protocol](#uart-packet-protocol)
- [Backend](#backend)
- [Database](#database)
- [Frontend dashboard](#frontend-dashboard)
- [Machine learning and infrastructure urgency](#machine-learning-and-infrastructure-urgency)
- [Virtual seismograph simulator](#virtual-seismograph-simulator)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Run with Docker Compose](#run-with-docker-compose)
- [Run the simulator](#run-the-simulator)
- [Run components locally](#run-components-locally)
- [Firmware setup and flashing](#firmware-setup-and-flashing)
- [API and real-time communication](#api-and-real-time-communication)
- [Monitoring and troubleshooting](#monitoring-and-troubleshooting)
- [Data integrity and limitations](#data-integrity-and-limitations)
- [Security notes](#security-notes)
- [Future development](#future-development)
- [Contributing](#contributing)
- [License](#license)

---

## System overview

SeismoLink is designed around distributed sensor nodes. Each physical node continuously samples acceleration, maintains a rolling pre-event buffer, and detects vibration activity locally. When an event is triggered, the firmware packages the pre-trigger and post-trigger waveform and sends it to a gateway.

The ESP32 gateway receives the binary stream over UART, validates and decodes frames, maintains network connectivity, synchronizes its clock, and forwards node telemetry and event samples to the server using Socket.IO.

The server accepts live node connections, stores node and event metadata in PostgreSQL, persists waveform data, performs baseline waveform analysis, and exposes data to the dashboard. The React dashboard provides the interface for viewing node status, events, logs, maps, and simulation-related views.

### Main components

| Layer | Component | Responsibility |
|---|---|---|
| Sensor | ADXL345 | Measures three-axis acceleration |
| Edge processing | STM32 NUCLEO-F446RE | Samples sensor data, filters signals, detects events, buffers waveforms |
| Network gateway | ESP32-WROOM-32 | UART frame parsing, Wi-Fi, time synchronization, Socket.IO transmission |
| API and real-time server | FastAPI + Python Socket.IO | Receives telemetry and event data, serves REST endpoints |
| Persistence | PostgreSQL 15 | Stores users, nodes, event metadata, infrastructure cache, and logs |
| Waveform storage | Docker volume | Stores waveform files separately from relational metadata |
| Web application | React + Vite + Leaflet | Displays monitoring information and map-based views |
| Demonstration | Python simulator | Generates repeatable virtual-node events |

---

## Architecture

```text
                 PHYSICAL SEISMOGRAPH NODE
        ┌─────────────────────────────────────┐
        │              ADXL345                │
        │       3-axis accelerometer          │
        └──────────────────┬──────────────────┘
                           │ I2C
                           ▼
        ┌─────────────────────────────────────┐
        │          STM32 NUCLEO-F446RE        │
        │                                     │
        │  Sensor acquisition / FIFO          │
        │  FreeRTOS tasks                     │
        │  Digital filtering                  │
        │  Vibration event detection          │
        │  Pre-trigger / post-trigger buffer  │
        │  Binary frame + CRC                 │
        └──────────────────┬──────────────────┘
                           │ UART
                           ▼
        ┌─────────────────────────────────────┐
        │            ESP32 Gateway            │
        │                                     │
        │  UART frame parser                  │
        │  CRC validation                     │
        │  Sample queue                       │
        │  Wi-Fi connectivity                 │
        │  NTP time synchronization           │
        │  Socket.IO client                   │
        └──────────────────┬──────────────────┘
                           │ Wi-Fi / Internet
                           │ Socket.IO over TLS
                           ▼
        ┌─────────────────────────────────────┐
        │        FastAPI + Socket.IO          │
        │                                     │
        │  Node and gateway management       │
        │  Telemetry and event ingestion     │
        │  Event association                 │
        │  Waveform analysis                 │
        │  REST API                          │
        └──────────────┬──────────────────────┘
                       │
             ┌─────────┴──────────┐
             ▼                    ▼
   ┌──────────────────┐  ┌────────────────────┐
   │   PostgreSQL     │  │  Waveform storage  │
   │                  │  │                    │
   │ Nodes            │  │ Event waveform     │
   │ Seismic events   │  │ files              │
   │ Users            │  │                    │
   │ System logs      │  │ Docker volume      │
   │ Infrastructure   │  │                    │
   └──────────────────┘  └────────────────────┘
             │
             ▼
   ┌─────────────────────────────────────────┐
   │          React Web Dashboard            │
   │                                         │
   │  Live monitoring                        │
   │  Node status                            │
   │  Event logs                             │
   │  Impact map                             │
   │  Simulation views                       │
   └─────────────────────────────────────────┘
```

The repository also contains a Python simulator that connects to the backend through the same Socket.IO event interface. It can be used to demonstrate the server and dashboard without connecting physical hardware.

---

## Data flow

### 1. Sensor acquisition

The ADXL345 measures acceleration along the X, Y, and Z axes. The STM32 communicates with the sensor over I2C and configures it for:

- 100 Hz output data rate.
- Full-resolution mode.
- ±2 g measurement range.
- Stream-mode FIFO operation.
- Data-ready and overrun interrupt sources.

The firmware reads samples from the sensor FIFO rather than relying only on slow periodic polling.

### 2. Signal processing

The STM32 firmware processes the acquired samples using digital filters. The filter implementation contains cascaded second-order Butterworth high-pass and low-pass sections, configured for a nominal 100 Hz sample rate:

- High-pass cutoff: 0.5 Hz.
- Low-pass cutoff: 20 Hz.

The filtering is performed independently for each axis. Raw sensor counts and filtered acceleration values are retained for event transmission.

### 3. Local event detection

The detector calculates a rolling vector RMS from the three acceleration axes. It establishes a noise baseline during an initial calibration period and adapts that baseline when vibration remains below the trigger threshold.

The implementation uses:

- A rolling RMS window.
- Initial noise-floor calibration.
- A threshold based on the learned noise level.
- A minimum trigger threshold.
- A multi-evaluation voting mechanism to reduce isolated false triggers.

When a trigger is confirmed, the node creates an event and preserves the buffered samples before the trigger as well as the samples collected after it.

### 4. Event capture

The current STM32 event configuration defines:

| Parameter | Firmware value |
|---|---:|
| Sampling frequency | 100 Hz |
| Sample interval | 10 ms |
| Pre-trigger samples | 1,000 |
| Post-trigger samples | 6,000 |
| Total nominal samples | 7,000 |
| Pre-trigger duration | 10 seconds |
| Post-trigger duration | 60 seconds |
| Nominal event duration | 70 seconds |
| Samples per data packet | 10 |

These values are firmware configuration values, not guaranteed real-world capture performance. Actual completeness depends on sensor, scheduling, queue capacity, UART throughput, and gateway/server availability.

### 5. Gateway transmission

The STM32 sends binary frames to the ESP32 over UART. The gateway:

1. Reads incoming UART bytes.
2. Reconstructs complete frames using the synchronization bytes and payload length.
3. Checks protocol version and CRC.
4. Decodes heartbeat, status, event-start, event-data, and event-end messages.
5. Queues samples temporarily while the network connection catches up.
6. Sends telemetry and event samples to the backend using Socket.IO.

The gateway maintains device uptime information even when network time has not synchronized. It uses NTP when available and carries time-quality metadata with event samples.

### 6. Backend ingestion and storage

The backend receives gateway and sensor events, validates their structure and node association, records event metadata, and persists waveform samples. It calculates basic waveform metrics and exposes stored information to the frontend.

### 7. Dashboard visualization

The frontend consumes backend data and presents node and event information through the web interface. Leaflet and React Leaflet are included for map-based visualization.

---

## Repository structure

```text
SeismoLink-main/
│
├── ESP32/
│   └── ESP32.ino
│
├── STM32/
│   ├── Core/
│   │   ├── Inc/
│   │   │   ├── adxl345.h
│   │   │   ├── seismo.h
│   │   │   ├── seismo_detector.h
│   │   │   ├── seismo_filter.h
│   │   │   ├── seismo_protocol.h
│   │   │   └── ...
│   │   ├── Src/
│   │   │   ├── adxl345.c
│   │   │   ├── freertos.c
│   │   │   ├── main.c
│   │   │   ├── seismo.c
│   │   │   ├── seismo_detector.c
│   │   │   ├── seismo_filter.c
│   │   │   ├── seismo_protocol.c
│   │   │   └── ...
│   │   └── Startup/
│   ├── Drivers/
│   ├── STM32.ioc
│   ├── STM32F446RETX_FLASH.ld
│   ├── STM32F446RETX_RAM.ld
│   └── ...
│
└── Server/
    ├── .env.example
    ├── docker-compose.yml
    ├── scripts/
    │   └── start_all.bat
    │
    ├── restapi/
    │   ├── main.py
    │   ├── database.py
    │   ├── requirements.txt
    │   ├── Dockerfile
    │   ├── seismo/
    │   │   ├── analysis.py
    │   │   └── security.py
    │   └── tests/
    │
    ├── frontend/
    │   ├── src/
    │   │   ├── components/
    │   │   ├── hooks/
    │   │   └── pages/
    │   ├── public/
    │   ├── package.json
    │   ├── Dockerfile
    │   └── nginx.conf
    │
    ├── simulator/
    │   ├── simulator.py
    │   ├── requirements.txt
    │   └── Dockerfile
    │
    └── training/
        ├── producer.py
        ├── train.py
        ├── predict.py
        ├── validator.py
        ├── complex_synthetic_urgency.csv
        ├── urgency_model.pkl
        └── label_encoders.pkl
```

### Directory responsibilities

- `STM32/`: STM32CubeIDE project and embedded C firmware.
- `ESP32/`: Arduino-compatible ESP32 gateway firmware.
- `Server/restapi/`: FastAPI application, Socket.IO server, database access, analysis, and security.
- `Server/frontend/`: React dashboard and map-based interface.
- `Server/simulator/`: Virtual seismograph nodes for repeatable demonstrations.
- `Server/training/`: Synthetic infrastructure urgency dataset generation, model training, prediction, and validation.
- `Server/docker-compose.yml`: Container orchestration for the database, backend, frontend, and optional simulator.

---

## Hardware

### Core hardware

| Component | Role |
|---|---|
| STM32 NUCLEO-F446RE | Main sensor-processing microcontroller |
| ADXL345 accelerometer | Three-axis vibration measurement |
| ESP32-WROOM-32 | Wi-Fi and server communication gateway |
| 18650 Li-ion battery pack | Portable power source |
| Battery protection and regulated power circuitry | Battery protection and stable supply rails |

The power system should be designed and tested for the actual current draw of the complete node, including the STM32, sensor, ESP32 radio peaks, and conversion losses. A regulated 5 V rail must have adequate transient-current capability; a converter's advertised rating alone does not establish that the complete power system is suitable.

### Sensor interface

The ADXL345 uses I2C in this firmware.

| ADXL345 pin | Connection |
|---|---|
| VCC | Compatible regulated supply for the breakout |
| GND | Common ground |
| SDA | STM32 I2C1 SDA |
| SCL | STM32 I2C1 SCL |
| CS | Set for I2C operation as required by the breakout |
| SDO | Selects the I2C address |
| INT1 | Optional/used according to interrupt wiring |
| INT2 | Optional |

The firmware expects the ADXL345 I2C address corresponding to `0x53` (7-bit address).

### STM32 and ESP32 UART

The firmware uses the STM32 UART connection to communicate with the ESP32 gateway. The project configuration and gateway source should be checked together before wiring or changing UART instances.

The ESP32 source currently configures:

| ESP32 signal | GPIO |
|---|---:|
| UART2 RX | GPIO 16 |
| UART2 TX | GPIO 17 |
| UART baud rate | 115200 |

Connect TX to RX and RX to TX, and connect grounds. Ensure the UART logic levels are compatible. Do not connect a 5 V UART signal directly to an ESP32 GPIO.

The STM32 source uses `huart1` for binary protocol frames and `huart2` for debug text. In the current CubeMX configuration, verify the corresponding STM32 pins and alternate-function settings before building.

---

## Embedded firmware

### STM32 sensor node

**Target board:** STM32 NUCLEO-F446RE  
**Development environment:** STM32CubeIDE  
**RTOS:** FreeRTOS  
**Sensor:** ADXL345  
**Sensor bus:** I2C1  
**Gateway link:** UART

The STM32 is responsible for time-sensitive acquisition and local event detection. This keeps the sensor sampling and trigger logic independent of Wi-Fi availability.

#### Main firmware modules

| File | Purpose |
|---|---|
| `adxl345.c/.h` | ADXL345 initialization, register access, FIFO reads, interrupt source |
| `seismo.c/.h` | Acquisition, processing, event buffering, packet transmission |
| `seismo_filter.c/.h` | Per-axis digital filtering |
| `seismo_detector.c/.h` | Rolling RMS noise estimation and trigger logic |
| `seismo_protocol.c/.h` | Binary frame construction and CRC-16 |
| `freertos.c` | RTOS initialization and task configuration |
| `main.c` | MCU peripheral initialization and application startup |

#### RTOS and acquisition design

The seismograph implementation separates acquisition and event processing into RTOS work. The source defines sample and event queues, a pre-trigger ring buffer, and event-capture state. The sensor data-ready path signals the sampling task, while processing and event transmission are handled outside the interrupt context.

The firmware tracks operational counters, including:

- Captured samples.
- I2C errors.
- Sample queue drops.
- Event queue drops.
- FIFO overruns.
- UART transmission errors.
- Last sample index.

These counters are useful when validating sustained acquisition and diagnosing dropped data.

#### Building the STM32 firmware

1. Install STM32CubeIDE and the required STM32 device support.
2. Open the `STM32/` project in STM32CubeIDE.
3. Confirm the board target is STM32F446RE.
4. Open `STM32.ioc` and verify the clock tree, I2C, UART, GPIO, interrupt, and FreeRTOS configuration.
5. Confirm the ADXL345 wiring and I2C address.
6. Build the project.
7. Connect the NUCLEO board through ST-LINK.
8. Flash and debug the firmware.
9. Inspect UART debug output and sensor/event counters.

Do not change the UART baud rate or peripheral assignment on only one side of the STM32-to-ESP32 connection.

### ESP32 gateway

**Target:** ESP32-WROOM-32  
**Development environment:** Arduino IDE or compatible ESP32 Arduino toolchain  
**Libraries used by the sketch:**

- WiFi
- Preferences
- SocketIOclient
- Arduino time support

The ESP32 acts as a protocol gateway rather than performing the primary sensor acquisition.

#### Gateway responsibilities

- Establish Wi-Fi connectivity.
- Read binary frames from the STM32 UART.
- Validate frame synchronization, length, version, and CRC.
- Maintain module identity in non-volatile Preferences storage.
- Generate a gateway boot identifier.
- Synchronize UTC time using NTP.
- Map STM32 uptime ticks to UTC when a valid clock mapping is available.
- Buffer outgoing samples while Socket.IO is temporarily unable to keep up.
- Transmit heartbeats, status, event metadata, and sample batches.
- Track received frames, CRC failures, invalid frames, sent samples, send errors, and queue drops.

#### Gateway configuration

Edit the configuration section near the top of `ESP32/ESP32.ino`:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

#define SERVER_HOST "your-server-hostname"
#define SERVER_PORT 443
#define SOCKET_PATH "/socket.io/?EIO=4"

#define STM32_RX_PIN 16
#define STM32_TX_PIN 17
#define STM32_BAUD 115200
```

Use a server hostname and port that match the deployment. The checked-in sketch contains network configuration values; replace any credentials or endpoints with your own before publishing or deploying.

The gateway's default module ID is configured in the sketch. The backend must have a corresponding registered node and matching authentication/identity configuration where required by the server implementation.

---

## UART packet protocol

The STM32 and ESP32 communicate using a binary framed protocol. The protocol is versioned and includes a CRC to detect corrupted frames.

### Frame layout

| Field | Size | Description |
|---|---:|---|
| Sync bytes | 2 bytes | `0xAA 0x55` |
| Version | 1 byte | Protocol version |
| Type | 1 byte | Packet type |
| Node ID | 2 bytes | Local node identifier |
| Sequence | 4 bytes | Transmit sequence number |
| Payload length | 2 bytes | Payload size |
| Payload | Variable | Packet-specific data |
| CRC | 2 bytes | CRC-16/CCITT-FALSE |

Multi-byte integer fields are little-endian. CRC-16/CCITT-FALSE is calculated over the version field through the final payload byte.

### Packet types

| Packet | Type | Purpose |
|---|---:|---|
| Heartbeat | `0x01` | Node uptime, sample index, event state, sensor health, TX errors |
| Status | `0x02` | Acquisition and queue statistics |
| Event start | `0x10` | Event identifier, trigger information, capture configuration |
| Event data | `0x11` | Batched raw and filtered XYZ samples |
| Event end | `0x12` | Event completion and transmission statistics |

The protocol version is currently `1`.

### Event-data payload

The event-data payload includes event identity and sample metadata, followed by sample records. The current STM32 implementation transmits ten samples per data packet. Each sample contains raw XYZ counts and filtered XYZ values in milligravity units.

The ESP32 parser must remain consistent with the STM32 frame definitions. If the protocol changes, update and test both firmware components together.

---

## Backend

**Location:** `Server/restapi/`  
**Framework:** FastAPI  
**Real-time transport:** Python Socket.IO  
**Database driver:** asyncpg  
**ASGI server:** Uvicorn

The backend provides REST endpoints for dashboard and administrative operations, while Socket.IO handles live gateway communication and sample/event ingestion.

### Main backend modules

| File | Responsibility |
|---|---|
| `main.py` | FastAPI application, Socket.IO server, REST routes, connection and event handling |
| `database.py` | PostgreSQL connection pool and schema initialization |
| `seismo/analysis.py` | Baseline waveform metrics |
| `seismo/security.py` | Password hashing, token creation, and token verification |
| `tests/` | Backend analysis and security tests |

### REST API

The API is versioned under `/api/v1/`. The root endpoint reports service information, and `/health` checks backend/database health.

Examples of implemented routes include:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Service information |
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/auth/login` | Admin authentication |
| `GET` | `/api/v1/nodes` | List registered nodes |
| `POST` | `/api/v1/nodes` | Register or update a node (admin) |
| `DELETE` | `/api/v1/nodes/{module_id}` | Delete a node (admin) |

Interactive API documentation is available at `/docs` when the backend is running.

The backend source contains additional endpoints. Use the live OpenAPI documentation at `/docs` as the authoritative route and request-schema reference for the version being deployed.

### Socket.IO communication

The backend exposes Socket.IO through the same ASGI application as FastAPI. The ESP32 gateway and Python simulator use named events for node registration/handshake, heartbeat, event lifecycle, and sample-batch ingestion.

The simulator demonstrates event names including:

- `gateway_hello`
- `sensor_heartbeat`
- `event_start`
- `sensor_data_batch`
- `event_end`

Use the implementation in `Server/restapi/main.py` as the source of truth for payload validation and acknowledgements. A successful client-side emit is not, by itself, proof that a complete waveform has been persisted; check the server acknowledgement and stored event/sample counts.

---

## Database

**Database:** PostgreSQL 15

The schema is initialized by the backend when it starts. The current schema defines the following main tables:

| Table | Purpose |
|---|---|
| `users` | Admin accounts and password hashes |
| `nodes` | Physical and simulated node registration, location, status, and last reading |
| `seismic_events` | Event identity, source, timestamps, sample counts, waveform path, and analysis |
| `infrastructure_cache` | Cached infrastructure records and location/category metadata |
| `system_logs` | System, node, and event-related logs |

Indexes are created for event detection time and event grouping. Waveform files are stored in a separate persistent Docker volume rather than being stored as large binary objects in the event metadata table.

### Persistence

Docker Compose defines two named volumes:

- `pgdata`: PostgreSQL database files.
- `waveform_data`: waveform files mounted at `/data/waveforms` inside the backend container.

These volumes survive ordinary container recreation. Removing volumes explicitly can permanently delete persisted data.

---

## Frontend dashboard

**Location:** `Server/frontend/`  
**Framework:** React 18  
**Build tool:** Vite  
**Routing:** React Router  
**Mapping:** Leaflet and React Leaflet  
**Real-time client:** Socket.IO Client  
**Styling:** Tailwind CSS and project CSS

The frontend is built as a single-page React application and is served through Nginx in the Docker deployment.

### Dashboard pages

The current source includes the following page components:

- `Home.jsx` — main dashboard view.
- `ImpactMap.jsx` — map-oriented impact view.
- `Logs.jsx` — log/event records.
- `Simulation.jsx` — simulation interface.
- `CapSimulation.jsx` — CAP simulation view.
- `DosAndDonts.jsx` — safety guidance.
- `LoadingScreen.jsx` — loading interface.
- `NotFound.jsx` — unknown-route handling.

Additional shared UI includes notification toasts and usage tracking.

### Frontend development

```bash
cd Server/frontend
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

The Docker deployment uses Nginx to serve the built frontend. Review `src/config.js`, `vite.config.js`, and the Nginx configuration when changing API or Socket.IO origins.

---

## Machine learning and infrastructure urgency

The repository contains a separate training workflow under `Server/training/`. It generates a dataset of infrastructure records associated with hypothetical seismic scenarios and trains a Random Forest classifier to assign infrastructure urgency levels.

This is an infrastructure-priority demonstration, not the model that performs the STM32's real-time vibration trigger detection.

### Dataset generation

`producer.py` generates `complex_synthetic_urgency.csv`.

The generator creates synthetic earthquake-like scenarios with values such as:

- Magnitude.
- Depth.
- Infrastructure category.
- Amenity type.
- Distance from the event location.
- Strong, empirical, and maximum radius-zone flags.
- Computed urgency score.
- Urgency label.

Infrastructure categories include hospitals, schools, government facilities, transport, utilities, and emergency facilities.

The urgency score is generated from a rule-based formula using proximity-zone bonus, magnitude, infrastructure criticality, and depth. Labels are assigned as Low, Medium, or High according to score thresholds.

**The generated dataset is synthetic.** Its labels are derived from the generator's scoring rules. A high test accuracy on this dataset would measure how well the model reproduces those rules; it would not establish real-world earthquake impact prediction accuracy.

### Model training

`train.py`:

1. Loads `complex_synthetic_urgency.csv`.
2. Encodes categorical columns using `LabelEncoder`.
3. Splits the records into training and test sets.
4. Trains a `RandomForestClassifier` with 100 estimators.
5. Prints classification metrics and accuracy.
6. Saves the model and encoders as joblib files.
7. Displays a confusion matrix.

Generated artifacts:

- `urgency_model.pkl`
- `label_encoders.pkl`

### Prediction

`predict.py` loads the saved model and encoders and provides single-record and bulk prediction helpers. Its input features include magnitude, depth, distance, infrastructure category, amenity type, and radius-zone flags.

The prediction script expects the model and encoder files to be present in its working directory.

### Validation

`validator.py` visualizes the synthetic dataset, including urgency-level distribution, urgency score versus magnitude, urgency score versus distance, category-level score distributions, and urgency by radius zone.

### Run the training workflow

```bash
cd Server/training

python -m venv .venv
```

Activate the environment:

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Install the required packages for the training scripts:

```bash
pip install pandas scikit-learn joblib matplotlib seaborn
```

Generate the dataset and train the model:

```bash
python producer.py
python train.py
python predict.py
```

Run the visual validation script:

```bash
python validator.py
```

Run these commands from `Server/training/`, because the scripts use relative file paths.

---

## Virtual seismograph simulator

The simulator is located in `Server/simulator/`. It creates three deterministic virtual nodes and sends a repeatable event to the backend through Socket.IO.

The simulator:

- Connects to the backend.
- Performs a gateway handshake.
- Sends node heartbeats.
- Generates a synthetic waveform with a quiet baseline and illustrative P- and S-arrival components.
- Sends event-start metadata.
- Transmits samples in batches.
- Sends event-end metadata.
- Checks backend acknowledgements and reports whether the expected samples were accepted.

The coordinates and waveform are illustrative demonstration data, not live sensor measurements or a real earthquake event.

The default simulator settings include:

| Setting | Default |
|---|---:|
| Nodes | 3 |
| Sample rate | 100 Hz |
| Sample count per node | 7,000 |
| Playback speed | 20× |
| Default Socket.IO URL | `http://backend:9001` |

The simulator uses the following default node IDs: `4101`, `4102`, and `4103`. The backend seeds matching demonstration nodes when `SEED_DEMO_NODES=true`.

---

## Requirements

### For the complete Docker deployment

- Docker Engine or Docker Desktop.
- Docker Compose plugin.
- A browser to access the dashboard.

### For embedded development

- STM32CubeIDE with STM32F4 device support.
- ST-LINK connection and drivers.
- ESP32 Arduino board support.
- ESP32 libraries used by the sketch, including `SocketIOclient`.

### For local backend development

- Python compatible with the pinned backend dependencies.
- PostgreSQL 15 or a running Compose database.
- Packages listed in `Server/restapi/requirements.txt`.

### For local frontend development

- Node.js and npm.
- Packages listed in `Server/frontend/package.json`.

### For model training

- Python.
- pandas
- scikit-learn
- joblib
- matplotlib
- seaborn

---

## Configuration

All server-side environment variables are configured in `Server/.env`.

Start by copying the example:

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Run the command from the `Server/` directory.

### Environment variables

| Variable | Purpose |
|---|---|
| `DB_NAME` | PostgreSQL database name |
| `DB_USER` | PostgreSQL username |
| `DB_PASSWORD` | PostgreSQL password |
| `ADMIN_USERNAME` | Initial admin username |
| `ADMIN_PASSWORD` | Initial admin password |
| `JWT_SECRET` | Secret used for authentication tokens |
| `OFFLINE_SECONDS` | Node-offline threshold |
| `SEED_DEMO_NODES` | Whether to seed demonstration nodes |
| `SIM_SPEED` | Simulator playback speed |
| `SIM_SAMPLE_COUNT` | Samples generated per simulated node |
| `EVENT_ASSOCIATION_WINDOW_SECONDS` | Event association time window |
| `INFRASTRUCTURE_DEFAULT_RADIUS_KM` | Default infrastructure proximity-search radius |

The example file also documents optional node-key variables for simulator configuration. Keep production credentials and secrets out of source control.

---

## Run with Docker Compose

Docker Compose is the recommended way to start the complete server stack.

### 1. Open the server directory

```bash
cd Server
```

### 2. Create the environment file

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3. Edit `.env`

At minimum, replace:

- `DB_PASSWORD`
- `ADMIN_PASSWORD`
- `JWT_SECRET`

Use unique, strong values before exposing the backend to a network.

### 4. Build and start the services

```bash
docker compose up -d --build
```

This starts:

- PostgreSQL.
- FastAPI + Socket.IO backend.
- React frontend served by Nginx.

The simulator is not started by the default Compose profile.

### 5. Open the application

| Service | Local address |
|---|---|
| Web dashboard | http://localhost:9000 |
| Backend root | http://localhost:9001/ |
| Backend health | http://localhost:9001/health |
| API documentation | http://localhost:9001/docs |
| Socket.IO endpoint | http://localhost:9001/socket.io/ |

### 6. View service status

```bash
docker compose ps
```

### 7. View logs

All services:

```bash
docker compose logs -f
```

Backend:

```bash
docker compose logs -f backend
```

Database:

```bash
docker compose logs -f db
```

Frontend:

```bash
docker compose logs -f frontend
```

### 8. Stop services

```bash
docker compose down
```

This stops and removes the containers and Compose network, while retaining named volumes.

To remove the database and waveform volumes as well:

```bash
docker compose down -v
```

**Warning:** `down -v` permanently deletes the persisted PostgreSQL data and waveform files.

### Windows helper script

The repository includes:

```text
Server/scripts/start_all.bat
```

Run it from Windows Explorer or a terminal to build and start the Compose stack. It runs `docker compose up -d --build` and prints the dashboard address.

---

## Run the simulator

The simulator is defined under the Compose `demo` profile.

With the default stack already running, execute:

```bash
cd Server
docker compose --profile demo run --rm simulator
```

Alternatively, start the demo profile as part of the stack:

```bash
docker compose --profile demo up -d --build
```

The simulator is configured to connect to the backend service by its Compose network hostname. It is intended for a backend running in the same Compose network.

To adjust playback, edit the `.env` values:

```env
SIM_SPEED=20
SIM_SAMPLE_COUNT=7000
```

The simulator is a demonstration source. Do not mix its records with physical sensor measurements when evaluating real-world performance.

---

## Run components locally

### Backend

Start PostgreSQL separately and configure the database connection variables. Then:

```bash
cd Server/restapi

python -m venv .venv
```

Activate the environment and install dependencies:

```bash
pip install -r requirements.txt
```

Run the application:

```bash
uvicorn main:socket_app --host 0.0.0.0 --port 9001 --reload
```

The backend expects its database to be reachable using the configured environment variables.

### Frontend

```bash
cd Server/frontend
npm install
npm run dev
```

Use the Vite development URL printed in the terminal. Confirm the frontend API and Socket.IO configuration points to the local backend.

### Simulator

```bash
cd Server/simulator

python -m venv .venv
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Set the backend Socket.IO URL to a host reachable from the simulator:

Windows PowerShell:

```powershell
$env:SOCKET_URL="http://localhost:9001"
python simulator.py
```

Linux/macOS:

```bash
SOCKET_URL=http://localhost:9001 python simulator.py
```

---

## API and real-time communication

### Health check

```bash
curl http://localhost:9001/health
```

A healthy response indicates that the API can communicate with PostgreSQL and that Socket.IO is enabled.

### Admin login

```bash
curl -X POST http://localhost:9001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"YOUR_ADMIN_PASSWORD\"}"
```

The response contains a bearer access token. Use the token for administrative routes.

### List nodes

```bash
curl http://localhost:9001/api/v1/nodes
```

### Register a node

```bash
curl -X POST http://localhost:9001/api/v1/nodes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d "{\"module_id\":5001,\"name\":\"Test Seismograph\",\"latitude\":30.3165,\"longitude\":78.0322,\"location_description\":\"Test location\",\"source\":\"physical\"}"
```

The registration endpoint returns the node authentication key when a node is first created. Store it securely. The implementation retains an existing node key when updating a node.

For the full API contract, use:

```text
http://localhost:9001/docs
```

---

## Monitoring and troubleshooting

### Check container health

```bash
docker compose ps
docker compose logs -f backend
```

If the backend does not become healthy, check database credentials, database readiness, and backend startup logs.

### Database connection errors

Verify that:

- The `db` service is running.
- `DB_NAME`, `DB_USER`, and `DB_PASSWORD` match.
- The backend uses the Compose service hostname `db`, not `localhost`, when running inside Compose.
- PostgreSQL has completed its health check.

### Frontend cannot reach the backend

Verify:

- The backend is reachable on port `9001`.
- The frontend API and Socket.IO URLs are correct for the environment.
- Nginx proxy configuration matches the deployed paths.
- Browser developer tools show no failed API requests or WebSocket connection errors.

### ESP32 cannot connect

Verify:

- Wi-Fi SSID and password.
- Server hostname and port.
- TLS certificate and endpoint configuration.
- Socket.IO path and Engine.IO version compatibility.
- Backend availability and node registration.
- Gateway authentication/handshake response.

### UART data is not received

Verify:

- STM32 TX is connected to ESP32 RX.
- STM32 RX is connected to ESP32 TX if bidirectional communication is required.
- Grounds are common.
- Both devices use 115200 baud.
- UART peripheral selection and pin alternate functions match the firmware.
- Logic levels are compatible.

### CRC or invalid-frame errors

Check that both devices use the same:

- Protocol version.
- Synchronization bytes.
- Payload-length interpretation.
- Little-endian field encoding.
- CRC-16/CCITT-FALSE implementation.
- Packet type and payload layout.

### ADXL345 initialization fails

Verify:

- Power and common ground.
- SDA/SCL wiring.
- I2C pull-ups and voltage compatibility.
- The breakout's CS and SDO configuration.
- The expected 7-bit I2C address (`0x53`).
- I2C1 pin configuration in CubeMX.

The ADXL345 device ID register should return `0xE5`.

### Sample queue drops or FIFO overruns

Check the STM32 status counters and ESP32 gateway statistics. Queue drops indicate that a producer is generating data faster than a consumer can process it, or that a queue is undersized for the current workload. FIFO overruns indicate that the sensor FIFO was not drained quickly enough.

Do not treat a successful connection as proof of lossless acquisition. Compare captured, transmitted, accepted, and persisted sample counts.

### NTP is not synchronized

The gateway is designed to continue waveform capture while waiting for time synchronization. Until time becomes valid, timestamps should be interpreted using the associated time-quality metadata and device uptime rather than assumed UTC timestamps.

---

## Data integrity and limitations

SeismoLink separates local detection, network transport, persistence, and visualization. Each layer has different failure modes.

### What the current implementation does

- Samples three-axis acceleration using an ADXL345.
- Uses sensor FIFO acquisition and RTOS-based firmware tasks.
- Applies digital filtering to the acceleration axes.
- Detects vibration events using rolling RMS and an adaptive noise baseline.
- Preserves a pre-trigger buffer and captures post-trigger samples.
- Uses framed UART packets with CRC checking between STM32 and ESP32.
- Uses Wi-Fi and Socket.IO for gateway-to-server transport.
- Tracks timing and synchronization quality.
- Stores node and event metadata in PostgreSQL.
- Persists waveform data in a separate storage volume.
- Calculates baseline RMS and peak waveform metrics in the backend.
- Includes a virtual-node simulator and a separate synthetic infrastructure urgency training workflow.

### What should not yet be claimed

The current code does not establish:

- Certified earthquake early-warning capability.
- Validated earthquake magnitude estimation.
- Reliable epicentre or hypocentre location from a single accelerometer node.
- A validated P-wave/S-wave arrival-time classifier.
- A trained seismic event classifier operating on real labeled waveforms.
- A validated ground-motion prediction or damage model.
- Real-world infrastructure damage probabilities.
- Guaranteed delivery under arbitrary network outages or queue saturation.

The backend waveform analysis explicitly reports that P/S picks are pending and that no validated P/S classifier is active. Its RMS and peak values are descriptive signal metrics, not earthquake magnitude.

Reliable event location requires multiple suitably distributed, synchronized stations and a validated association/travel-time method. Magnitude estimation requires appropriate sensor calibration, instrument response, site characterization, and a validated seismological method. Infrastructure impact assessment requires defensible ground-motion and exposure/vulnerability inputs.

### Testing recommendations

Before using the system for scientific or operational conclusions:

1. Calibrate the accelerometer and verify its orientation and mounting.
2. Measure the actual sampling interval and timing jitter.
3. Test the complete acquisition path under sustained load.
4. Quantify FIFO overruns, queue drops, UART errors, and gateway send failures.
5. Verify waveform sample counts after database/file persistence.
6. Test clock behavior during Wi-Fi loss and NTP resynchronization.
7. Compare signals against a calibrated reference instrument.
8. Build a labeled dataset from real seismic and non-seismic recordings.
9. Evaluate detection sensitivity, false-alarm rate, missed events, and timing error on held-out recordings.
10. Validate multi-station association and location separately from single-node event detection.

---

## Security notes

Before exposing SeismoLink beyond a trusted development network:

- Replace all example database and admin credentials.
- Generate a strong, unique JWT secret.
- Never commit `.env` files or Wi-Fi credentials.
- Keep node authentication keys private.
- Use HTTPS/WSS with valid certificates for public deployments.
- Restrict CORS origins to the actual frontend origin.
- Restrict administrative endpoints to authorized users.
- Avoid exposing PostgreSQL directly to the public internet.
- Back up both the PostgreSQL volume and waveform volume.
- Rotate credentials if they have been exposed in a repository or log.

The example Compose configuration is intended as a starting point and should be hardened for production. Review the backend's CORS, authentication, node handshake, and transport configuration before deployment.

---

## Future development

Potential next steps for the project include:

### Embedded and hardware
- Calibrate sensor offset, scale, noise floor, and orientation.
- Evaluate a lower-noise seismic-grade sensor for improved sensitivity.
- Add robust local storage or retransmission for extended network outages.
- Add watchdog and brownout recovery behavior.
- Characterize battery runtime and radio peak-current requirements.

### Seismic processing
- Validate trigger thresholds against real seismic and non-seismic recordings.
- Implement and validate P-wave and S-wave arrival picking.
- Associate detections across multiple physical stations.
- Estimate event location using station geometry and travel-time models.
- Add calibrated ground-motion metrics and uncertainty estimates.

### Data and machine learning
- Replace synthetic-only training and evaluation with real, labeled datasets where appropriate.
- Maintain strict separation between training, validation, and test events.
- Track model versions, data provenance, and evaluation metrics.
- Validate infrastructure urgency against defensible exposure and vulnerability data.
- Report uncertainty and avoid presenting model outputs as confirmed damage.

### Backend and dashboard
- Add role-based access controls and stronger node provisioning.
- Add waveform download and replay tools.
- Improve event grouping and multi-station visualization.
- Add monitoring for ingestion latency, persistence failures, and dropped samples.
- Add automated backups and retention policies.
- Add deployment health checks and integration tests.

---

## Contributing

Contributions, bug reports, and technical suggestions are welcome.

A useful contribution should include:

1. A clear description of the problem or proposed change.
2. The affected component (`STM32`, `ESP32`, or `Server`).
3. Reproduction steps for bugs.
4. Test results or logs where applicable.
5. Any protocol or database schema changes required by the update.

For changes to the STM32–ESP32 packet protocol, update both sides together and include compatibility tests. For backend changes, run the available tests:

```bash
cd Server/restapi
pytest
```

For frontend changes:

```bash
cd Server/frontend
npm run lint
npm run build
```

---

**SeismoLink — Distributed seismic sensing, edge event detection, and real-time monitoring.**
