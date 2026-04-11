#!/usr/bin/env python3
import json
from tools.advanced_format import AdvancedRecordingFormat

# Create test data - 130-driver leaderboard
leaderboard = []
for i in range(130):
    leaderboard.append({
        "NAME": f"Driver{i}",
        "SPEED": 200 + i,
        "GAP": i * 0.5,
        "INTERVAL": 0.1 * i,
        "LAPS": i % 50,
        "POS": i + 1,
    })

data = {
    "PID": 0,
    "data": leaderboard
}

formatter = AdvancedRecordingFormat()
formatter.start_buffering("test", [0])
formatter.add_buffered_message(16, data)

# Write to file
with open('/tmp/test_nested.json', 'w') as f:
    formatter.write_all(f)

# Read and verify
with open('/tmp/test_nested.json', 'r') as f:
    lines = f.readlines()

header = json.loads(lines[0])
msg = json.loads(lines[1])

print(f"Header nested schemas: {len(header.get('nestedSchemas', {}))}")
if 'nestedSchemas' in header:
    print(f"  First nested schema fields: {header['nestedSchemas'].get('0', [])[:3]}")

print(f"Message size: {len(lines[1])} bytes")
print(f"Message format: {msg}")

# Try decompression
formatter2 = AdvancedRecordingFormat()
formatter2.set_schema_registry(header['schemas'])
if 'nestedSchemas' in header:
    nested_registry = {}
    for nid_str, fields in header['nestedSchemas'].items():
        nested_registry[int(nid_str)] = fields
    formatter2.set_nested_schema_registry(nested_registry)
    print(f"Set nested registry with {len(nested_registry)} schemas")

decomp = formatter2.decompress(msg[1])
print(f"Decompressed data field type: {type(decomp.get('data'))}")
if isinstance(decomp.get('data'), list):
    print(f"Number of drivers: {len(decomp['data'])}")
    print(f"First driver: {decomp['data'][0]}")
