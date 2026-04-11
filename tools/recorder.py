#!/usr/bin/env python3
"""
WebSocket Data Recorder - Schema-Based Format v3
Records all messages from the NLS timing WebSocket server for later replay.
Uses schema-based compression: 80-99% smaller than JSON (stores field names once).
"""

import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
import websockets

# Import schema compression
from advanced_format import AdvancedRecordingFormat

# Default WebSocket URL
WS_URL = "wss://livetiming.azurewebsites.net/"

# Configuration matching JavaScript
EVENT_ID = "20"
EVENT_PID = [0, 4]

# Recording metadata
RECORDER_VERSION = "3.0"
RECORDER_AGENT = "NLS Timing WebSocket Recorder (Schema v3)"


def log(message: str):
    """Log a message with timestamp."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")


def generate_output_path(custom_path: str = None) -> str:
    """
    Generate output path for recording file.
    Always uses .json extension with schema-based format v3.
    
    Args:
        custom_path: Custom file path or filename (optional)
    
    Returns:
        Full path to output file
    """
    # Create recordings directory
    recordings_dir = Path("recordings")
    recordings_dir.mkdir(exist_ok=True)
    
    # If custom path is provided and doesn't contain path separators, treat as filename
    if custom_path and "/" not in custom_path and "\\" not in custom_path:
        # Ensure .json extension
        if not custom_path.endswith('.json'):
            custom_path = custom_path + '.json'
        return str(recordings_dir / custom_path)
    
    # If custom path is provided with path separators, use as-is
    if custom_path:
        if not custom_path.endswith('.json'):
            custom_path = custom_path + '.json'
        return custom_path
    
    # Generate auto-named file: event_ID_YYYYMMDD_HHMMSS.json
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    filename = f"event_{EVENT_ID}_{timestamp}.json"
    return str(recordings_dir / filename)


async def record_websocket(ws_url: str, output_file: str):
    """
    Connect to WebSocket and record all messages with timestamps.
    Uses schema-based compression (v3 format).

    Args:
        ws_url: WebSocket URL to connect to
        output_file: Path to save recorded data
    """
    start_time = None
    message_count = 0
    last_log_time = None
    last_timestamp = 0
    formatter = AdvancedRecordingFormat()

    try:
        log(f"Connecting to {ws_url}...")
        async with websockets.connect(ws_url) as websocket:
            log("✓ Connected to WebSocket")
            log(f"Writing to: {output_file}")
            log("Format: Schema registry v4 (95-99% compression)")
            start_time = datetime.now()
            last_log_time = start_time

            # Send initialization message (same as JavaScript)
            init_message = {
                "eventId": EVENT_ID,
                "eventPid": EVENT_PID,
                "clientLocalTime": int(datetime.now().timestamp() * 1000)
            }
            await websocket.send(json.dumps(init_message))
            log(f"✓ Sent init message: eventId={EVENT_ID}, eventPid={EVENT_PID}")

            # Start streaming mode - file created instantly with placeholder
            formatter.start_streaming(EVENT_ID, EVENT_PID, output_file)
            log(f"✓ File created instantly: {output_file}")
            log("✓ Streaming messages to disk in real-time...")
            log("Waiting for messages...\n")

            try:
                async for message in websocket:
                    elapsed = (datetime.now() - start_time).total_seconds()
                    
                    # Parse the message as JSON object
                    try:
                        data_obj = json.loads(message)
                    except json.JSONDecodeError:
                        data_obj = {"raw": message}
                    
                    # Calculate delta from last timestamp (in milliseconds for precision)
                    timestamp_ms = int(elapsed * 1000)
                    delta_ms = timestamp_ms - last_timestamp
                    last_timestamp = timestamp_ms
                    
                    # If data is an array (leaderboard), wrap it properly for schema
                    if isinstance(data_obj, list):
                        data_obj = {"data": data_obj}
                    
                    # Stream this message to disk immediately
                    formatter.write_streaming_message(delta_ms, data_obj)
                    message_count += 1

                    # Periodic status updates
                    now = datetime.now()
                    if (now - last_log_time).total_seconds() >= 5:
                        msg_preview = message[:60] if len(message) > 60 else message
                        log(f"  [{message_count}] {elapsed:.1f}s | Messages buffered | {msg_preview}...")
                        last_log_time = now
                    else:
                        # Quick progress indicator without timestamp
                        sys.stdout.write(f"\r  [{message_count}] messages buffered...")
                        sys.stdout.flush()

            except KeyboardInterrupt:
                print()  # New line after progress indicator
                log("⚠ Interrupted by user, finalizing recording...")
                await websocket.close()
                log(f"✓ WebSocket closed. Finalizing {message_count} recorded messages...")

    except Exception as e:
        log(f"✗ Error: {e}")
        return False
    finally:
        # Finalize streaming and write header with all schemas
        if message_count > 0:
            try:
                formatter.finish_streaming(output_file)
                log("✓ File finalized with complete schema registry")
            except IOError as e:
                log(f"✗ Error finalizing file: {e}")
                return False

    if message_count > 0:
        file_size = Path(output_file).stat().st_size / (1024 * 1024)
        stats = formatter.get_stats()
        log(f"✓ Successfully saved {message_count} messages ({file_size:.2f}MB) to {output_file}")
        log(f"  Schemas registered: {stats['schemas_count']}")
        return True
    else:
        log("⚠ No messages recorded")
        return False


def main():
    """Entry point for the recorder."""
    custom_path = sys.argv[1] if len(sys.argv) > 1 else None
    output_file = generate_output_path(custom_path)

    print("=" * 60)
    print("NLS Timing WebSocket Recorder")
    print("=" * 60)
    log(f"Output file: {output_file}")
    log("Press Ctrl+C to stop gracefully")
    print()

    try:
        asyncio.run(record_websocket(WS_URL, output_file))
    except KeyboardInterrupt:
        print()
        log("✓ Recording saved and closed gracefully")
    except Exception as e:
        log(f"✗ Fatal error: {e}")
        sys.exit(1)

    print()
    print("=" * 60)


if __name__ == "__main__":
    main()
