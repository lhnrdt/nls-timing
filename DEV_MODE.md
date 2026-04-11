# Using Dev Mode with the Overlay

## Quick Start

### 1. Record WebSocket Data

```bash
cd tools
python3 recorder.py nls_recording.json
```

Wait for messages to arrive. You'll see status messages like:
```
[HH:MM:SS] Connecting to wss://livetiming.azurewebsites.net/...
[HH:MM:SS] ✓ Connected to WebSocket
[HH:MM:SS]   [1] Received (0.0s): {"eventId":"20","eventPid":[0,4],...
```

Press `Ctrl+C` to stop recording when you have enough data.

### 2. Start Replay Server

In another terminal:
```bash
cd tools
python3 replay.py nls_recording.json 1.0
```

You'll see:
```
Starting WebSocket replay server on ws://0.0.0.0:9000
Connect your app to: ws://localhost:9000
Server running. Waiting for clients...
```

### 3. Open the Overlay

Simply open the userscript in your browser (or open `index.html` for testing).

### 4. Enable Dev Mode

You'll see a "Settings" button in the overlay. Click it and check the "Dev Mode (Replay)" checkbox.

The overlay will:
- Disconnect from the live server
- Connect to the local replay server on `ws://localhost:9000`
- Start receiving recorded data

### 5. Control Playback Speed

Stop and restart the replay server with different speed multipliers:

```bash
# Slow-motion (0.5x speed)
python3 replay.py nls_recording.json 0.5

# Double speed
python3 replay.py nls_recording.json 2.0

# 3x speed for fast testing
python3 replay.py nls_recording.json 3.0
```

## Dev Mode Details

### What Happens When You Toggle Dev Mode

**Enable Dev Mode:**
- Config changes to use `ws://localhost:9000/`
- WebSocket connection is closed and re-established
- Overlay connects to replay server
- Status shows: 🔴 Using dev replay server

**Disable Dev Mode:**
- Config switches back to `wss://livetiming.azurewebsites.net/`
- WebSocket connection is closed and re-established
- Overlay connects to live server
- Status shows: 🟢 Using live server

### Settings Panel

The settings panel now has three options:

1. **Dev Mode (Replay)** - Toggle between live and replay servers
2. **Delay (s)** - Delay in seconds before updating overlays
3. **Dot size** - Size of position indicator on track map

### Browser Console

Monitor the connection in browser DevTools:

```javascript
// Open Console (F12)
// You'll see messages like:
// 📡 Using dev replay server: ws://localhost:9000/
// WS connecting ws://localhost:9000/
// WS connected, sending init {...}
```

## Troubleshooting

### "Checking Dev Mode but overlay is empty"

Make sure the replay server is running and showing "Client connected!":
```
$ python3 replay.py nls_recording.json
...
Client connected! Starting replay...
```

### "Dev mode toggle appears but no effect"

1. Open browser DevTools Console (F12)
2. Look for error messages
3. Check that replay server is running on localhost:9000
4. Verify nls_recording.json file exists and is valid

### "Recording file is empty or has errors"

Validate the file:
```bash
python3 tools/validate.py
```

This checks:
- Python dependencies
- File structure
- Recording format validity

## Configuration

### In `src/config.js`

```javascript
NLS.CONFIG = {
    devMode: false,           // Set to true for dev mode
    devServerUrl: 'ws://localhost:9000/',  // Dev server
    wsUrl: 'wss://livetiming.azurewebsites.net/',  // Live server
    // ... other config
}
```

Or toggle via JavaScript:
```javascript
// In browser console:
NLS.CONFIG.devMode = true;  // Enable dev mode
```

## Advanced Usage

### Manual WebSocket URL

You can manually set the WebSocket URL in the browser console:

```javascript
// Override the URL
NLS.CONFIG.devServerUrl = 'ws://192.168.1.100:9000/';
NLS.CONFIG.devMode = true;

// Reconnect
if (window.NLS.state.ws) {
    window.NLS.state.ws.close();
    window.NLS.state.ws = null;
    setTimeout(() => NLS.ensureConnection(), 500);
}
```

### Testing Specific Scenarios

Record a specific race or condition:
```bash
# Start recording when the race starts
python3 recorder.py race_start.json

# Stop when race ends
# Now replay it multiple times at different speeds for testing
python3 replay.py race_start.json 0.5
python3 replay.py race_start.json 2.0
```

