#!/usr/bin/env python3
"""
Convert recordings between compact JSON and MessagePack formats.
Useful for converting old format to new optimized format.
"""

import json
import sys
from pathlib import Path

try:
    import msgpack
    HAS_MSGPACK = True
except ImportError:
    HAS_MSGPACK = False


def convert_json_to_msgpack(input_file: str, output_file: str) -> bool:
    """Convert compact JSON to MessagePack format."""
    if not HAS_MSGPACK:
        print("Error: msgpack not installed")
        print("Install with: pip install msgpack")
        return False
    
    try:
        print(f"Converting {input_file} → {output_file}")
        
        # Read JSON
        with open(input_file, 'r') as f:
            lines = f.readlines()
        
        if not lines:
            print("Error: Empty file")
            return False
        
        # Parse header and messages
        header = json.loads(lines[0])
        messages = []
        
        for line in lines[1:]:
            if line.strip():
                msg_entry = json.loads(line)
                if isinstance(msg_entry, list) and len(msg_entry) == 2:
                    delta_ms, data = msg_entry
                    messages.append([delta_ms, data])
        
        # Write MessagePack
        with open(output_file, 'wb') as f:
            msgpack.pack(header, f)
            for msg in messages:
                msgpack.pack(msg, f)
        
        input_size = Path(input_file).stat().st_size
        output_size = Path(output_file).stat().st_size
        ratio = (1 - output_size / input_size) * 100
        
        print("✓ Converted successfully")
        print(f"  Input:  {input_size / 1024:.1f} KB")
        print(f"  Output: {output_size / 1024:.1f} KB")
        print(f"  Saved:  {ratio:.1f}%")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False


def convert_msgpack_to_json(input_file: str, output_file: str) -> bool:
    """Convert MessagePack to compact JSON format."""
    if not HAS_MSGPACK:
        print("Error: msgpack not installed")
        return False
    
    try:
        print(f"Converting {input_file} → {output_file}")
        
        # Read MessagePack
        with open(input_file, 'rb') as f:
            unpacker = msgpack.Unpacker(f, raw=False)
            items = list(unpacker)
        
        if not items:
            print("Error: Empty file")
            return False
        
        # Parse header and messages
        header = items[0]
        
        # Write JSON
        with open(output_file, 'w') as f:
            f.write(json.dumps(header, separators=(',', ':')) + '\n')
            for item in items[1:]:
                if isinstance(item, list) and len(item) == 2:
                    f.write(json.dumps(item, separators=(',', ':')) + '\n')
        
        input_size = Path(input_file).stat().st_size
        output_size = Path(output_file).stat().st_size
        
        print("✓ Converted successfully")
        print(f"  Input:  {input_size / 1024:.1f} KB")
        print(f"  Output: {output_size / 1024:.1f} KB")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False


def main():
    """Convert recording format."""
    if len(sys.argv) < 2:
        print("Usage:")
        print(f"  {sys.argv[0]} <input_file> [output_file]")
        print()
        print("Converts between compact JSON and MessagePack formats.")
        print("Output format is determined by file extension:")
        print("  .json    → Compact JSON (newline-delimited)")
        print("  .msgpack → MessagePack binary format")
        print()
        print("Examples:")
        print(f"  {sys.argv[0]} recording.json recording.msgpack")
        print(f"  {sys.argv[0]} recording.msgpack recording.json")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    if len(sys.argv) > 2:
        output_file = sys.argv[2]
    else:
        # Auto-generate output filename
        path = Path(input_file)
        if input_file.endswith('.json'):
            output_file = str(path.with_suffix('.msgpack'))
        elif input_file.endswith('.msgpack'):
            output_file = str(path.with_suffix('.json'))
        else:
            print("Error: Cannot determine output format from filename")
            print("Please specify output file explicitly")
            sys.exit(1)
    
    if not Path(input_file).exists():
        print(f"Error: File not found: {input_file}")
        sys.exit(1)
    
    if input_file.endswith('.json'):
        success = convert_json_to_msgpack(input_file, output_file)
    elif input_file.endswith('.msgpack'):
        success = convert_msgpack_to_json(input_file, output_file)
    else:
        print("Error: Unsupported file format")
        print("Supported: .json, .msgpack")
        sys.exit(1)
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
