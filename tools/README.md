# NLS Timing WebSocket Tools

Tools for recording and replaying WebSocket data from the NLS timing server for development and testing.

## Setup

Install required dependencies:

```bash
pip install websockets
```

## Usage

### Recording Data

Capture live data from the NLS timing server:

```bash
python3 recorder.py [output_file.json]
```

**Output Format:** JSON array with the following structure:
```json
[
  {
    "timestamp": 0.025828,
    "data": {
      "eventId": "20",
      "eventPid": [0, 4],
      "clientLocalTime": 1775903741142,
      "PID": "LTS_TIMESYNC",
      "serverLocalTime": 1775903741187
    }
  },
  {
    "timestamp": 0.080058,
    "data": {
      "PID": "0",
      "RECNUM": "0",
      ...
    }
  }
]
```

- `timestamp`: Elapsed seconds since recording started
- `data`: Parsed JSON object from the WebSocket message

Example:
```bash
python3 recorder.py nls_recording.json
```

The script will connect to the WebSocket server and record all incoming messages with timestamps. Press `Ctrl+C` to stop.

**Output:** A JSON file containing an array of message objects:
```json
[
  {
    "timestamp": 0.5,
    "data": "message content..."
  },
  {
    "timestamp": 1.2,
    "data": "message content..."
  }
]
```

### Replaying Data

Start a local WebSocket server that replays recorded data:

```bash
python3 replay.py [input_file.json] [speed]
```

Examples:
```bash
# Real-time replay (1x speed)
python3 replay.py nls_recording.json

# Half speed (0.5x)
python3 replay.py nls_recording.json 0.5

# Double speed (2x)
python3 replay.py nls_recording.json 2.0
```

The replay server:
- Starts on `ws://localhost:9000`
- Waits for a client to connect
- Responds to the client's initialization message with a TIMESYNC message
- Replays recorded messages with original timing (adjusted by speed multiplier)
- Properly serializes all data as JSON strings

## Quick Start

1. **Record live data:**
   ```bash
   cd tools
   python3 recorder.py nls_recording.json
   ```
   Wait for messages to arrive, then `Ctrl+C` to stop.

2. **Start replay server in another terminal:**
   ```bash
   cd tools
   python3 replay.py nls_recording.json 1.0
   ```

3. **Update your config to use localhost:**
   In `config.js`, change:
   ```javascript
   wsUrl: 'ws://localhost:9000/'
   ```

4. **Open the overlay:**
   Open `index.html` in your browser. It will connect to the replay server and show the recorded data.

## File Format Details

The recording file is a JSON array where each element contains:
- `timestamp`: Decimal seconds elapsed since recording started
- `data`: The actual WebSocket message as a parsed JSON object

All WebSocket messages from the server are recorded with their exact structure preserved.

### Development Workflow

1. **Record** live race data when available:
   ```bash
   python3 recorder.py my_race.json
   ```

2. **Update** the config to use the replay server instead of the live server:
   - Edit `src/config.js` and change `wsUrl` to `'ws://localhost:9000/'`

3. **Start** the replay server:
   ```bash
   python3 replay.py my_race.json
   ```

4. **Open** `index.html` in your browser - it will connect to the local replay server

5. **Develop** without needing a real race running!

### Tips

- Record multiple race sessions to build a library of test data
- Use different speed multipliers to test UI responsiveness
- The replay server automatically restarts playback when a new client connects
- You can have multiple clients connected simultaneously
