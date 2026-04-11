#!/usr/bin/env python3
"""
Schema-based message compression for NLS recordings.

Reduces file size by:
1. Extracting field schemas from message structure
2. Storing messages as value arrays instead of objects
3. Detecting message types and using appropriate schemas
"""

from typing import Any, Dict, List


class SchemaCompressor:
    """Compresses messages using schema extraction."""
    
    def __init__(self):
        """Initialize compressor."""
        self.schemas = {}  # msg_type -> field_names
        self.next_schema_id = 0
    
    def _get_message_type(self, data: Dict) -> str:
        """Determine message type from PID or specific fields."""
        if isinstance(data, dict):
            # Use PID as type if available, otherwise use specific field markers
            pid = data.get('PID')
            if pid:
                return str(pid)
            
            # Fallback: use combination of top-level keys
            keys = tuple(sorted(data.keys()))
            return f"keys:{hash(keys) & 0xffff:04x}"
        
        return "unknown"
    
    def _extract_values(self, data: Dict, field_names: List[str]) -> List[Any]:
        """Extract values from data in field order."""
        values = []
        for field in field_names:
            parts = field.split('.')
            value = data
            
            # Navigate nested fields
            for part in parts:
                if isinstance(value, dict):
                    value = value.get(part)
                else:
                    value = None
                    break
            
            values.append(value)
        return values
    
    def _flatten_keys(self, data: Dict, prefix: str = '') -> List[str]:
        """Extract all leaf keys from nested dict."""
        keys = []
        for k, v in data.items():
            full_key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
            
            if isinstance(v, dict):
                # For nested dicts, include a few levels deep
                if prefix.count('.') < 2:  # Max nesting
                    keys.extend(self._flatten_keys(v, full_key))
            else:
                keys.append(full_key)
        
        return keys
    
    def register_schema(self, data: Dict) -> str:
        """
        Register a schema for a message type.
        Returns schema ID.
        """
        msg_type = self._get_message_type(data)
        
        if msg_type in self.schemas:
            return msg_type
        
        # Extract field names (non-nested for performance)
        field_names = list(data.keys())
        self.schemas[msg_type] = field_names
        
        return msg_type
    
    def compress_message(self, data: Dict) -> List[Any]:
        """
        Compress a message using schema.
        Returns [schema_id, values] or [null, data] if new schema.
        """
        msg_type = self._get_message_type(data)
        
        # Register schema if new
        if msg_type not in self.schemas:
            self.register_schema(data)
            # Return schema definition + values for first occurrence
            field_names = self.schemas[msg_type]
            values = self._extract_values(data, field_names)
            return [{'_schema': msg_type, '_fields': field_names}, values]
        
        # Compress using existing schema
        field_names = self.schemas[msg_type]
        values = self._extract_values(data, field_names)
        return [msg_type, values]
    
    def decompress_message(self, compressed: List[Any]) -> Dict:
        """Decompress a message from compressed format."""
        if len(compressed) != 2:
            return {}
        
        schema_id, values = compressed
        
        # Handle schema definition
        if isinstance(schema_id, dict) and '_schema' in schema_id:
            msg_type = schema_id['_schema']
            fields = schema_id['_fields']
            self.schemas[msg_type] = fields
            schema_id = msg_type
        
        # Reconstruct message
        if schema_id not in self.schemas:
            return {}
        
        field_names = self.schemas[schema_id]
        data = {}
        
        for field_name, value in zip(field_names, values):
            parts = field_name.split('.')
            
            # Set nested fields
            if len(parts) > 1:
                current = data
                for part in parts[:-1]:
                    if part not in current:
                        current[part] = {}
                    current = current[part]
                current[parts[-1]] = value
            else:
                data[field_name] = value
        
        return data
    
    def get_stats(self) -> Dict:
        """Get compression statistics."""
        return {
            'schemas_registered': len(self.schemas),
            'schemas': {
                msg_type: {
                    'fields': len(fields),
                    'field_names': fields
                }
                for msg_type, fields in self.schemas.items()
            }
        }
