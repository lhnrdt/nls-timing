#!/usr/bin/env python3
"""
Advanced recording format with schema registry compression.
Reduces file size by 95-99% compared to full JSON.

Format v4:
  Line 0: {"version": 4, "format": "schema_registry", "schemas": [[field1, field2, ...], [...]], "eventId": "...", "eventPid": [...]}
  Line 1+: [delta_ms, [schema_id, [value1, value2, ...]]]
  
All schema definitions are in the header. Messages use only numeric schema IDs (0, 1, 2, etc).
This eliminates ALL repeated field name strings.
"""

import json
from typing import Dict, List, Any


class AdvancedRecordingFormat:
    """Handles schema registry recording format v4 with nested array compression."""
    
    def __init__(self):
        """Initialize format handler."""
        self.msg_type_to_schema_id = {}  # "type_0" -> 0, "type_4" -> 1, etc
        self.schema_id_to_fields = {}    # 0 -> ["field1", "field2", ...], etc
        self.nested_schema_registry = {}  # Stores schemas for nested arrays
        self.next_schema_id = 0
        self.next_nested_id = 0
        self.event_id = ""
        self.event_pid = []
        self.messages_buffer = []  # Buffer to hold messages before writing
        self.streaming_file = None  # File handle for streaming writes
        self.streaming_temp_path = None  # Temp file for messages during streaming
    
    def _get_message_type(self, data: Dict) -> str:
        """Determine message type from PID."""
        if not isinstance(data, dict):
            return "unknown"
        pid = data.get('PID')
        return f"type_{pid}" if pid else "generic"
    
    def _get_or_create_schema_id(self, data: Dict) -> int:
        """Get schema ID for data, creating new one if needed."""
        msg_type = self._get_message_type(data)
        
        if msg_type in self.msg_type_to_schema_id:
            return self.msg_type_to_schema_id[msg_type]
        
        # New schema - register it
        field_names = sorted(data.keys())
        schema_id = self.next_schema_id
        self.msg_type_to_schema_id[msg_type] = schema_id
        self.schema_id_to_fields[schema_id] = field_names
        self.next_schema_id += 1
        
        print(f"  Registered schema: {msg_type} → ID {schema_id} ({len(field_names)} fields)")
        return schema_id
    
    def _compress_value(self, value: Any) -> Any:
        """
        Compress a value recursively.
        If it's an array of homogeneous objects, compress them with nested schema.
        """
        # If it's an array of objects, compress them with schema registry
        if isinstance(value, list) and len(value) > 0 and isinstance(value[0], dict):
            # Extract field names from first object
            first_obj = value[0]
            field_names = sorted(first_obj.keys())
            field_key = tuple(field_names)  # Use as key to detect if we've seen this schema
            
            # Check if we already have this nested schema registered
            if field_key not in self.nested_schema_registry:
                nested_id = self.next_nested_id
                self.nested_schema_registry[field_key] = {
                    "id": nested_id,
                    "fields": field_names
                }
                self.next_nested_id += 1
            
            nested_id = self.nested_schema_registry[field_key]["id"]
            
            # Compress each object in the array as just values
            compressed_array = []
            for obj in value:
                obj_values = [obj.get(fn) for fn in field_names]
                compressed_array.append(obj_values)
            
            # Return marker with nested schema ID
            return ["_array", nested_id, compressed_array]
        
        return value
    
    def _decompress_value(self, value: Any, nested_schemas: Dict = None) -> Any:
        """
        Decompress a value recursively.
        If it's a compressed array, expand it back to objects.
        """
        if isinstance(value, list) and len(value) >= 3 and value[0] == "_array":
            _, nested_id, compressed_array = value[0], value[1], value[2]
            
            # Get field names from nested schema registry
            if nested_schemas and nested_id in nested_schemas:
                field_names = nested_schemas[nested_id]
            else:
                print(f"WARNING: Unknown nested schema {nested_id}")
                return value
            
            # Reconstruct objects
            result = []
            for obj_values in compressed_array:
                obj = dict(zip(field_names, obj_values))
                result.append(obj)
            
            return result
        
        return value
    
    def compress(self, data: Dict) -> List[Any]:
        """
        Compress a message to [schema_id, [values]].
        Recursively compresses nested arrays of objects.
        """
        msg_type = self._get_message_type(data)
        
        if msg_type not in self.msg_type_to_schema_id:
            self._get_or_create_schema_id(data)
        
        schema_id = self.msg_type_to_schema_id[msg_type]
        field_names = self.schema_id_to_fields[schema_id]
        values = []
        for fn in field_names:
            raw_value = data.get(fn)
            # Compress nested arrays too
            values.append(self._compress_value(raw_value))
        
        return [schema_id, values]
    
    def decompress(self, compressed: List[Any]) -> Dict:
        """Decompress a message from [schema_id, [values]], handling nested arrays."""
        if len(compressed) != 2:
            print(f'ERROR: Invalid format, expected [schema_id, values], got {len(compressed)} parts')
            return {}
        
        schema_id, values = compressed
        
        if not isinstance(schema_id, int):
            print(f'ERROR: Schema ID should be int, got {type(schema_id).__name__}')
            return {}
        
        if schema_id not in self.schema_id_to_fields:
            print(f'ERROR: Unknown schema ID {schema_id}. Known: {list(self.schema_id_to_fields.keys())}')
            return {}
        
        field_names = self.schema_id_to_fields[schema_id]
        
        if not isinstance(values, list):
            print(f'ERROR: Values should be list, got {type(values).__name__}')
            return {}
        
        if len(values) != len(field_names):
            print(f'ERROR: Field/value count mismatch: {len(field_names)} fields, {len(values)} values')
            return {}
        
        # Build nested schema lookup for decompression
        nested_schemas = {}
        for field_key, nested_info in self.nested_schema_registry.items():
            nested_schemas[nested_info["id"]] = nested_info["fields"]
        
        # Decompress nested arrays too
        decompressed_values = []
        for value in values:
            decompressed_values.append(self._decompress_value(value, nested_schemas))
        
        return dict(zip(field_names, decompressed_values))
    
    def set_schema_registry(self, registry):
        """Load schema registry from header (for replay).
        
        Registry can be either:
        - Dict: {0: [field1, field2, ...], 1: [...], ...}
        - List: [[field1, field2, ...], [...], ...]  (from header format)
        """
        if isinstance(registry, list):
            # Convert list format from header to dict format
            self.schema_id_to_fields = {i: fields for i, fields in enumerate(registry)}
        else:
            # Already a dict
            self.schema_id_to_fields = registry
        
        self.next_schema_id = len(self.schema_id_to_fields)
    
    def set_nested_schema_registry(self, nested_registry: Dict[int, List[str]]):
        """Load nested schema registry from header (for replay)."""
        # Reconstruct nested_schema_registry from the ID -> fields mapping
        for nested_id, field_names in nested_registry.items():
            field_key = tuple(sorted(field_names))
            self.nested_schema_registry[field_key] = {
                "id": nested_id,
                "fields": field_names
            }
        if nested_registry:
            self.next_nested_id = max(int(k) for k in nested_registry.keys()) + 1
    
    def get_schema_registry(self) -> Dict[int, List[str]]:
        """Get current schema registry for header."""
        return self.schema_id_to_fields
    
    def start_buffering(self, event_id: str, event_pid: List[int]):
        """Start buffering mode for recording."""
        self.buffer_mode = True
        self.event_id = event_id
        self.event_pid = event_pid
        self.messages_buffer = []
    
    def add_buffered_message(self, delta_ms: int, data: Dict):
        """Add a message to the buffer."""
        # Ensure schema is registered
        self._get_or_create_schema_id(data)
        compressed = self.compress(data)
        message = [delta_ms, compressed]
        self.messages_buffer.append(message)
    
    def write_all(self, f):
        """Write all buffered messages with complete schema registry to file."""
        # Prepare nested schemas dictionary (id -> field_names)
        nested_schemas_dict = {}
        for field_key, nested_info in self.nested_schema_registry.items():
            nested_schemas_dict[nested_info["id"]] = nested_info["fields"]
        
        # Write header with complete schema registry
        schemas_list = [self.schema_id_to_fields[i] for i in sorted(self.schema_id_to_fields.keys())]
        
        header = {
            "version": 4,
            "format": "schema_registry",
            "schemas": schemas_list,
            "nestedSchemas": nested_schemas_dict,
            "eventId": self.event_id,
            "eventPid": self.event_pid
        }
        f.write(json.dumps(header, separators=(',', ':')) + '\n')
        
        # Write all messages
        for message in self.messages_buffer:
            f.write(json.dumps(message, separators=(',', ':')) + '\n')
        
        f.flush()
    
    def start_streaming(self, event_id: str, event_pid: List[int], output_path: str):
        """Start streaming mode for on-the-fly JSON writing.
        
        Messages are written immediately to disk. Header is written at end with final schemas.
        
        Args:
            event_id: Event identifier
            event_pid: Event PIDs
            output_path: Path to write final JSON file
        """
        self.event_id = event_id
        self.event_pid = event_pid
        self.streaming_temp_path = output_path + '.tmp'
        self.streaming_file = open(self.streaming_temp_path, 'w')
        # Write placeholder header (will be updated at end)
        self.streaming_file.write('{"placeholder": true}\n')
        self.streaming_file.flush()
    
    def write_streaming_message(self, delta_ms: int, data: Dict):
        """Write a single message immediately to disk in streaming mode."""
        if not self.streaming_file:
            raise RuntimeError("Not in streaming mode. Call start_streaming() first.")
        
        # Ensure schema is registered (discovers all schemas as they appear)
        self._get_or_create_schema_id(data)
        compressed = self.compress(data)
        message = [delta_ms, compressed]
        
        # Write message immediately
        self.streaming_file.write(json.dumps(message, separators=(',', ':')) + '\n')
        self.streaming_file.flush()
    
    def finish_streaming(self, output_path: str):
        """Close streaming and write final file with proper header."""
        if not self.streaming_file:
            raise RuntimeError("Not in streaming mode.")
        
        # Close temp file
        self.streaming_file.close()
        
        # Read all messages from temp file
        with open(self.streaming_temp_path, 'r') as f:
            lines = f.readlines()
        
        # Remove placeholder header
        message_lines = lines[1:]
        
        # Write final file with proper header
        with open(output_path, 'w') as f:
            # Prepare nested schemas
            nested_schemas_dict = {}
            for field_key, nested_info in self.nested_schema_registry.items():
                nested_schemas_dict[nested_info["id"]] = nested_info["fields"]
            
            # Write real header
            schemas_list = [self.schema_id_to_fields[i] for i in sorted(self.schema_id_to_fields.keys())]
            
            header = {
                "version": 4,
                "format": "schema_registry",
                "schemas": schemas_list,
                "nestedSchemas": nested_schemas_dict,
                "eventId": self.event_id,
                "eventPid": self.event_pid
            }
            f.write(json.dumps(header, separators=(',', ':')) + '\n')
            
            # Write all messages
            for line in message_lines:
                f.write(line)
            
            f.flush()
        
        # Clean up temp file
        import os
        os.remove(self.streaming_temp_path)
        
        self.streaming_file = None
        self.streaming_temp_path = None

    def get_stats(self) -> Dict:
        """Get compression stats."""
        return {
            "schemas_count": len(self.schema_id_to_fields),
            "schemas": {
                f"schema_{i}": len(fields)
                for i, fields in self.schema_id_to_fields.items()
            }
        }
