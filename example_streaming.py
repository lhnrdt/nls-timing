#!/usr/bin/env python3
"""
Example: On-the-fly JSON streaming with automatic schema discovery.

This demonstrates writing compressed JSON messages as they arrive,
without buffering everything in memory first.
"""

from tools.advanced_format import AdvancedRecordingFormat
import time


def example_streaming_recording():
    """Simulate real-time recording with streaming writes."""
    
    formatter = AdvancedRecordingFormat()
    output_file = "/tmp/streaming_example.json"
    
    # Start streaming mode
    print("Starting streaming recording...")
    formatter.start_streaming("race_session_001", [0, 1, 2], output_file)
    
    # Simulate messages arriving over time
    # Each message is written to disk immediately
    
    print("Recording messages...")
    for i in range(10):
        # Simulate different message types
        if i % 3 == 0:
            # Leaderboard update (PID 0)
            leaderboard = []
            for driver in range(5):
                leaderboard.append({
                    "NAME": f"Driver{driver}",
                    "SPEED": 200 + driver,
                    "GAP": i * 0.5,
                    "POS": driver + 1
                })
            data = {
                "PID": 0,
                "data": leaderboard
            }
        else:
            # Timing update (PID 1)
            data = {
                "PID": 1,
                "time_ms": 1000 + i * 100,
                "current_leader": f"Driver{i % 5}"
            }
        
        # Write this message immediately to disk
        formatter.write_streaming_message(16, data)
        
        # Simulate some delay (in real recording, this would be network I/O)
        print(f"  Message {i+1}: Written to disk")
        time.sleep(0.01)
    
    print("Recording complete. Finalizing file...")
    # When done, write final file with header and all messages
    formatter.finish_streaming(output_file)
    
    print("✓ Streaming complete: {output_file}".replace("{output_file}", output_file))
    
    # Show file contents
    import json
    with open(output_file, 'r') as f:
        lines = f.readlines()
    
    print("File stats:")
    print(f"  Total lines: {len(lines)}")
    print(f"  File size: {sum(len(line) for line in lines)} bytes")
    
    # Show header
    header = json.loads(lines[0])
    print("Header:")
    print(f"  Schemas: {len(header['schemas'])}")
    print(f"  Nested schemas: {len(header.get('nestedSchemas', {}))}")
    
    print("First message (line 2):")
    msg1 = json.loads(lines[1])
    print(f"  Delta: {msg1[0]}ms")
    print(f"  Schema ID: {msg1[1][0]}")


if __name__ == "__main__":
    example_streaming_recording()
