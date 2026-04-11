# Development Setup Guide

## Recording/Replay System

The recording and replay system captures real WebSocket data from the NLS timing server for offline development and testing.

### File Structure

**Recording file** (`nls_recording.json`):
```
[
  {
    "timestamp": 0.025828,      ← Elapsed seconds since start
    "data": { ... }             ← Parsed JSON WebSocket message
  },
  {
    "timestamp": 0.080058,
    "data": { ... }
  }
]
```

### Setup Steps

1. **Install dependencies:**
   ```bash
   cd tools
   pip install websockets
   ```

2. **Record data from live server:**
   ```bash
   cd tools
   python3 recorder.py nls_recording.json
   ```
   Wait for data to arrive. Press `Ctrl+C` to stop recording.

3. **Start replay server:**
   ```bash
   cd tools
   python3 replay.py nls_recording.json 1.0
   ```
   Server will start on `ws://localhost:9000` and wait for clients.

4. **Update config for dev mode:**
   In `src/config.js`, add this setting to the top:
   ```javascript
   // For development: use local replay server
   const DEV_MODE = true;  // Set to false for production
   
   wsUrl: DEV_MODE ? 'ws://localhost:9000/' : 'wss://livetiming.azurewebsites.net/',
   ```

5. **Open the overlay:**
   - Open `index.html` in your browser
   - The overlay will connect to the replay server
   - Data will be displayed as if from the live server

### Replay Speed Control

The replay server supports speed multipliers:
```bash
python3 replay.py nls_recording.json 0.5   # Half speed
python3 replay.py nls_recording.json 1.0   # Real-time (default)
python3 replay.py nls_recording.json 2.0   # Double speed
```

### Key Features

✓ **Exact Protocol Matching**: Recorder sends the same init message as JavaScript  
✓ **TIMESYNC Response**: Replay server responds with matching TIMESYNC message  
✓ **Proper JSON Serialization**: All data sent as JSON strings, not escaped  
✓ **Timing Preserved**: Messages replay with original timing between events  
✓ **Format Flexibility**: Supports both simple array and metadata-wrapped formats  

### Troubleshooting

**"Connection refused" error:**
- Make sure replay server is running on localhost:9000
- Check that the config.js wsUrl points to the correct server

**"No messages" in overlay:**
- Verify nls_recording.json file exists and has valid JSON
- Check browser console for WebSocket connection errors
- Ensure the replay server is running and shows client connection message

**Messages sent too fast/slow:**
- Adjust the speed multiplier in the replay command
- Check the replay server logs for timing information

