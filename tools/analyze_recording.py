#!/usr/bin/env python3
"""
Analyze recording files to estimate compression potential.
"""

import json
import sys
from pathlib import Path
from collections import defaultdict


def analyze_json_recording(filepath: str, sample_size: int = 100):
    """Analyze JSON recording to estimate compression potential."""
    print(f"Analyzing {filepath}...")
    
    try:
        with open(filepath, 'r') as f:
            lines = f.readlines()
        
        if len(lines) < 2:
            print("File too small")
            return
        
        # Parse header
        header = json.loads(lines[0])
        print(f"\nHeader: {header}")
        
        # Analyze message structure
        message_types = defaultdict(int)
        field_counts = defaultdict(int)
        total_fields = 0
        sample_msgs = []
        
        for i, line in enumerate(lines[1:sample_size+1]):
            if not line.strip():
                continue
            
            msg_entry = json.loads(line)
            if isinstance(msg_entry, list) and len(msg_entry) == 2:
                delta_ms, data = msg_entry
                
                if isinstance(data, dict):
                    msg_type = data.get('PID', 'unknown')
                    message_types[msg_type] += 1
                    
                    field_count = len(data)
                    field_counts[msg_type] = field_count
                    total_fields += field_count
                    
                    if len(sample_msgs) < 5:
                        sample_msgs.append((msg_type, len(data), list(data.keys())))
        
        # Calculate statistics
        print("\nMessage Types Found:")
        for msg_type, count in sorted(message_types.items(), key=lambda x: -x[1]):
            field_count = field_counts[msg_type]
            print(f"  {msg_type}: {count} messages, {field_count} fields each")
        
        print("\nSample Messages (first 5):")
        for msg_type, field_count, fields in sample_msgs:
            print(f"  {msg_type} ({field_count} fields): {', '.join(fields[:3])}...")
        
        # Estimate compression
        total_lines = len(lines)
        avg_line_length = sum(len(line) for line in lines[1:]) / max(1, len(lines) - 1)
        
        print("\nFile Statistics:")
        print(f"  Total messages: {total_lines - 1}")
        print(f"  Average line length: {avg_line_length:.0f} bytes")
        print(f"  Total file size: {Path(filepath).stat().st_size / 1024:.1f} KB")
        
        # Estimate schema compression
        unique_types = len(message_types)
        avg_fields = total_fields / max(1, sample_size)
        
        # Rough estimation:
        # - Current: ~avg_line_length bytes per message
        # - Compressed: ~20 bytes delta + ~4 bytes per value (conservative)
        #   Plus ~200 bytes per schema definition
        
        estimated_per_msg = 20 + (avg_fields * 4)
        estimated_schema_overhead = unique_types * 200
        current_total = sum(len(line) for line in lines[1:])
        estimated_total = (total_lines - 1) * estimated_per_msg + estimated_schema_overhead
        
        compression_ratio = (1 - estimated_total / current_total) * 100
        
        print("\nSchema Compression Estimate:")
        print(f"  Unique message types: {unique_types}")
        print(f"  Average fields per message: {avg_fields:.1f}")
        print(f"  Current size: {current_total / 1024:.1f} KB")
        print(f"  Estimated compressed: {estimated_total / 1024:.1f} KB")
        print(f"  Potential savings: {compression_ratio:.1f}%")
        
    except Exception as e:
        print(f"Error analyzing: {e}")


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python3 analyze_recording.py <recording_file>")
        print()
        print("Analyzes recording structure to estimate compression potential")
        sys.exit(1)
    
    filepath = sys.argv[1]
    
    if not Path(filepath).exists():
        print(f"Error: File not found: {filepath}")
        sys.exit(1)
    
    sample_size = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    
    analyze_json_recording(filepath, sample_size)


if __name__ == '__main__':
    main()
