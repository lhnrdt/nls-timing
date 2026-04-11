#!/usr/bin/env python3
"""
Validation script for NLS Timing dev tools.
Checks that recorder and replay server are properly configured.
"""

import json
import sys
from pathlib import Path

def check_recording_file(filepath):
    """Validate recording file structure."""
    print(f"\n📁 Checking recording file: {filepath}")
    
    if not Path(filepath).exists():
        print("   ⚠️  Recording file not found. Run recorder first:")
        print("   python3 tools/recorder.py nls_recording.json")
        return False
    
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"   ✗ Invalid JSON: {e}")
        return False
    
    if not isinstance(data, list):
        print(f"   ✗ Expected JSON array, got {type(data).__name__}")
        return False
    
    if len(data) == 0:
        print("   ⚠️  Recording file is empty")
        return False
    
    # Validate structure
    first_msg = data[0]
    if not isinstance(first_msg, dict):
        print(f"   ✗ Messages should be objects, got {type(first_msg).__name__}")
        return False
    
    if 'timestamp' not in first_msg or 'data' not in first_msg:
        print("   ✗ Message missing 'timestamp' or 'data' field")
        return False
    
    if not isinstance(first_msg['data'], dict):
        print(f"   ✗ Message data should be object, got {type(first_msg['data']).__name__}")
        return False
    
    print(f"   ✓ Valid recording with {len(data)} messages")
    print(f"   ✓ First message timestamp: {first_msg['timestamp']}")
    print(f"   ✓ First message PID: {first_msg['data'].get('PID', 'N/A')}")
    return True

def check_python_dependencies():
    """Check if required Python packages are installed."""
    print("\n📦 Checking Python dependencies...")
    
    try:
        import websockets
        print(f"   ✓ websockets: {websockets.__version__}")
        return True
    except ImportError:
        print("   ✗ websockets not installed")
        print("   Run: pip install websockets")
        return False

def check_files():
    """Check that all required files exist."""
    print("\n📄 Checking required files...")
    
    required_files = [
        'tools/recorder.py',
        'tools/replay.py',
        'tools/README.md',
        'index.html',
        'src/config.js',
    ]
    
    all_exist = True
    for filepath in required_files:
        if Path(filepath).exists():
            print(f"   ✓ {filepath}")
        else:
            print(f"   ✗ {filepath} - NOT FOUND")
            all_exist = False
    
    return all_exist

def main():
    print("=" * 50)
    print("NLS Timing Dev Tools Validation")
    print("=" * 50)
    
    checks = [
        ("Dependencies", check_python_dependencies),
        ("Required Files", check_files),
        ("Recording File", lambda: check_recording_file('nls_recording.json')),
    ]
    
    results = []
    for name, check_func in checks:
        try:
            result = check_func()
            results.append((name, result))
        except Exception as e:
            print(f"   ✗ Error: {e}")
            results.append((name, False))
    
    print("\n" + "=" * 50)
    print("Summary:")
    print("=" * 50)
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status:7} {name}")
    
    all_passed = all(r for _, r in results)
    
    if all_passed:
        print("\n✓ All checks passed! You're ready to go.")
        print("\nNext steps:")
        print("  1. Start replay server: python3 tools/replay.py nls_recording.json")
        print("  2. Update config.js to use: ws://localhost:9000/")
        print("  3. Open index.html in your browser")
    else:
        print("\n✗ Some checks failed. See above for details.")
        return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
