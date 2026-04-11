# Replay Server Usage Guide

## Basic Usage

### Use newest recording automatically
```bash
python3 tools/replay.py
```
Automatically finds and plays the newest `.json` file in the `recordings/` directory.

### Specify a recording file
```bash
# By filename (looks in recordings/ folder)
python3 tools/replay.py my_race.json

# By full path
python3 tools/replay.py /path/to/recording.json

# By full path with recordings folder
python3 tools/replay.py recordings/event_20_20260411_125939.json
```

## Advanced Options

### Control playback speed
```bash
# Half speed (slow motion)
python3 tools/replay.py -s 0.5

# Double speed
python3 tools/replay.py -s 2.0

# 10x speed for testing
python3 tools/replay.py -s 10.0
```

### Change WebSocket port
```bash
# Run on port 8000 instead of default 9000
python3 tools/replay.py -p 8000

# Or with long option
python3 tools/replay.py --port 8000
```

### Combine options
```bash
# Use newest recording, 2x speed, custom port
python3 tools/replay.py -s 2.0 -p 8000

# Specific file with 1.5x speed
python3 tools/replay.py my_race.json -s 1.5
```

## Full Help
```bash
python3 tools/replay.py --help
```

## Examples

### Development workflow
```bash
# Terminal 1: Start recording
python3 tools/recorder.py

# Terminal 2: After recording, start replay (newest file, default settings)
python3 tools/replay.py

# Terminal 3: Open browser with overlay, toggle Dev Mode in settings
```

### Testing different scenarios
```bash
# Replay at 10x speed for quick testing
python3 tools/replay.py -s 10.0

# Replay at 0.1x speed for detailed analysis
python3 tools/replay.py -s 0.1

# Use specific recorded race at 2x speed
python3 tools/replay.py qualifying_round.json -s 2.0
```

### Multiple replay servers
```bash
# Server 1: Port 9000
python3 tools/replay.py race1.json

# Server 2: Port 9001 (in another terminal)
python3 tools/replay.py race2.json -p 9001
```

## File Selection Logic

1. **If filename provided**: Look in `recordings/` folder first, then try full path
2. **If no argument**: Find newest `.json` file in `recordings/` directory by modification time
3. **If not found**: Show error and exit

## Performance

- **Newest file detection**: O(n) where n = number of files
- **Decompression**: 80-99% faster than JSON due to schema compression
- **Replay**: Maintains original timing ±10ms (network dependent)
